package app

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/cardkey/cardkey/internal/domain"
	"github.com/cardkey/cardkey/internal/pkg/apperr"
	"github.com/google/uuid"
)

// ListCategories 列表：用物化 unused_count + 单次 cards 聚合子查询，避免 JOIN 放大。
// light=true 时不拉巨大 icon data URL、不聚合 used/total（筛选下拉用）。
func (a *App) ListCategories(ctx context.Context) ([]domain.Category, error) {
	return a.listCategories(ctx, false)
}

// ListCategoriesLight 筛选下拉：id/name/slug/prefix/enabled/unused_count，无大图。
func (a *App) ListCategoriesLight(ctx context.Context) ([]domain.Category, error) {
	return a.listCategories(ctx, true)
}

func (a *App) listCategories(ctx context.Context, light bool) ([]domain.Category, error) {
	if light {
		rows, err := a.Pool.Query(ctx, `
			SELECT c.id, c.name, c.slug, c.code_prefix, c.description, c.enabled, c.sort_order,
			       c.icon_kind,
			       CASE
			         WHEN c.icon_kind = 'image' AND length(c.icon_value) > 256 THEN ''
			         ELSE c.icon_value
			       END,
			       c.created_at,
			       COALESCE(c.unused_count, 0)
			FROM categories c
			ORDER BY c.sort_order, c.created_at`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []domain.Category
		for rows.Next() {
			var c domain.Category
			var created time.Time
			var unused int
			if err := rows.Scan(&c.ID, &c.Name, &c.Slug, &c.CodePrefix, &c.Description, &c.Enabled, &c.SortOrder,
				&c.Icon.Kind, &c.Icon.Value, &created, &unused); err != nil {
				return nil, err
			}
			c.CreatedAt = formatTS(created)
			c.UnusedCount = &unused
			z := 0
			c.CardCount = &z
			c.UsedCount = &z
			out = append(out, c)
		}
		if out == nil {
			out = []domain.Category{}
		}
		return out, nil
	}

	// 完整列表：仅读物化计数，禁止扫 cards
	rows, err := a.Pool.Query(ctx, `
		SELECT c.id, c.name, c.slug, c.code_prefix, c.description, c.enabled, c.sort_order,
		       c.icon_kind, c.icon_value, c.created_at,
		       COALESCE(c.unused_count, 0),
		       COALESCE(c.card_count, 0),
		       COALESCE(c.used_count, 0)
		FROM categories c
		ORDER BY c.sort_order, c.created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Category
	for rows.Next() {
		var c domain.Category
		var created time.Time
		var unused, cardCount, used int
		if err := rows.Scan(&c.ID, &c.Name, &c.Slug, &c.CodePrefix, &c.Description, &c.Enabled, &c.SortOrder,
			&c.Icon.Kind, &c.Icon.Value, &created, &unused, &cardCount, &used); err != nil {
			return nil, err
		}
		c.CreatedAt = formatTS(created)
		c.UnusedCount = &unused
		c.CardCount = &cardCount
		c.UsedCount = &used
		out = append(out, c)
	}
	if out == nil {
		out = []domain.Category{}
	}
	return out, nil
}

func (a *App) getCategoryRow(ctx context.Context, id string) (domain.Category, error) {
	var c domain.Category
	var created time.Time
	var unused, cardCount, used int
	err := a.Pool.QueryRow(ctx, `
		SELECT c.id, c.name, c.slug, c.code_prefix, c.description, c.enabled, c.sort_order,
		       c.icon_kind, c.icon_value, c.created_at,
		       COALESCE(c.unused_count, 0), COALESCE(c.card_count, 0), COALESCE(c.used_count, 0)
		FROM categories c WHERE c.id=$1`, id).
		Scan(&c.ID, &c.Name, &c.Slug, &c.CodePrefix, &c.Description, &c.Enabled, &c.SortOrder,
			&c.Icon.Kind, &c.Icon.Value, &created, &unused, &cardCount, &used)
	if err != nil {
		return domain.Category{}, apperr.NotFound("类别不存在")
	}
	c.CreatedAt = formatTS(created)
	c.UnusedCount = &unused
	c.CardCount = &cardCount
	c.UsedCount = &used
	return c, nil
}

func (a *App) CreateCategory(ctx context.Context, name, slug, prefix, desc string, icon domain.CategoryIcon, actor, ip string) (domain.Category, error) {
	name = strings.TrimSpace(name)
	slug = strings.ToLower(strings.TrimSpace(slug))
	prefix = strings.ToUpper(strings.TrimSpace(prefix))
	if name == "" || slug == "" || prefix == "" {
		return domain.Category{}, apperr.Validation("名称、Slug、前缀必填")
	}
	if icon.Kind == "" {
		icon = domain.CategoryIcon{Kind: "lucide", Value: "ticket"}
	}
	var sort int
	_ = a.Pool.QueryRow(ctx, `SELECT COALESCE(MAX(sort_order),0)+1 FROM categories`).Scan(&sort)
	id := uuid.NewString()
	var created time.Time
	if icon.Value == "" {
		icon.Value = "ticket"
	}
	if icon.Kind == "image" && len(icon.Value) > 512*1024 {
		return domain.Category{}, apperr.Validation("图标图片过大，请压缩到 200KB 以内")
	}
	err := a.Pool.QueryRow(ctx, `
		INSERT INTO categories(id, name, slug, code_prefix, description, enabled, sort_order, icon_kind, icon_value)
		VALUES($1,$2,$3,$4,$5,true,$6,$7,$8)
		RETURNING created_at`, id, name, slug, prefix, desc, sort, icon.Kind, icon.Value).Scan(&created)
	if err != nil {
		msg := strings.ToLower(err.Error())
		if strings.Contains(msg, "duplicate") || strings.Contains(msg, "unique") {
			return domain.Category{}, apperr.Conflict("Slug 或前缀已存在")
		}
		if strings.Contains(msg, "value too long") || strings.Contains(msg, "character varying") {
			return domain.Category{}, apperr.Validation("图标数据过长：请升级到最新版或选择图标库（勿用超大 data URL）。若已升级仍失败请重启容器以应用数据库迁移。")
		}
		return domain.Category{}, err
	}
	a.invalidateCategorySlugCache()
	a.Audit(ctx, "admin", actor, "create_category", "category:"+id, name+" ("+prefix+")", ip)
	z := 0
	return domain.Category{
		ID: id, Name: name, Slug: slug, CodePrefix: prefix, Description: desc,
		Enabled: true, SortOrder: sort, Icon: icon, CardCount: &z, UnusedCount: &z, UsedCount: &z,
		CreatedAt: formatTS(created),
	}, nil
}

func (a *App) UpdateCategory(ctx context.Context, id string, name, desc *string, enabled *bool, sort *int, icon *domain.CategoryIcon, actor, ip string) (domain.Category, error) {
	cur, err := a.getCategoryRow(ctx, id)
	if err != nil {
		return domain.Category{}, err
	}
	if name != nil {
		cur.Name = strings.TrimSpace(*name)
	}
	if desc != nil {
		cur.Description = *desc
	}
	if enabled != nil {
		cur.Enabled = *enabled
	}
	if sort != nil {
		cur.SortOrder = *sort
	}
	if icon != nil {
		cur.Icon = *icon
	}
	_, err = a.Pool.Exec(ctx, `
		UPDATE categories SET name=$1, description=$2, enabled=$3, sort_order=$4,
		icon_kind=$5, icon_value=$6, updated_at=now() WHERE id=$7`,
		cur.Name, cur.Description, cur.Enabled, cur.SortOrder, cur.Icon.Kind, cur.Icon.Value, id)
	if err != nil {
		msg := strings.ToLower(err.Error())
		if strings.Contains(msg, "value too long") || strings.Contains(msg, "character varying") {
			return domain.Category{}, apperr.Validation("图标数据过长：请重启/升级应用以应用 icon_value TEXT 迁移，或改用图标库")
		}
		return domain.Category{}, err
	}
	a.invalidateCategorySlugCache()
	a.Audit(ctx, "admin", actor, "update_category", "category:"+id, cur.Name, ip)
	return cur, nil
}

// DeleteCategory 删除类别。
// 规则：存在兑换/已使用卡密（交易数据）时禁止删除，只能停用；
// 无交易数据时允许硬删除，并级联清理未使用/已禁用卡密与空批次。
func (a *App) DeleteCategory(ctx context.Context, id, actor, ip string) error {
	var name string
	var used int
	var redeems int
	err := a.Pool.QueryRow(ctx, `
		SELECT c.name,
		       (SELECT COUNT(*) FROM cards WHERE category_id=c.id AND status='used'),
		       (SELECT COUNT(*) FROM redeem_records WHERE category_id=c.id)
		FROM categories c WHERE c.id=$1`, id).Scan(&name, &used, &redeems)
	if err != nil {
		return apperr.NotFound("类别不存在")
	}
	if used > 0 || redeems > 0 {
		return apperr.Conflict("该类别已有兑换记录，无法删除，只能停用")
	}

	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `DELETE FROM cards WHERE category_id=$1 AND status <> 'used'`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM batches WHERE category_id=$1`, id); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `DELETE FROM categories WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("类别不存在")
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	a.invalidateCategorySlugCache()
	a.Audit(ctx, "admin", actor, "delete_category", "category:"+id, name, ip)
	return nil
}

// FindCategoryBySlug 兑换热路径：不读 icon_value（可能是超大 data URL）。
func (a *App) FindCategoryBySlug(ctx context.Context, slug string) (domain.Category, error) {
	return a.findCategoryBySlug(ctx, slug, false)
}

// FindCategoryBySlugFull 管理端需要图标时用。
func (a *App) FindCategoryBySlugFull(ctx context.Context, slug string) (domain.Category, error) {
	return a.findCategoryBySlug(ctx, slug, true)
}

func (a *App) findCategoryBySlug(ctx context.Context, slug string, withIcon bool) (domain.Category, error) {
	slug = strings.TrimSpace(slug)
	if slug == "" {
		return domain.Category{}, apperr.NotFound("类别不存在")
	}
	// 进程缓存 30s（兑换热路径）
	if !withIcon {
		if v, ok := catSlugCache.Load(slug); ok {
			e := v.(catSlugCacheEntry)
			if time.Since(e.at) < 30*time.Second {
				return e.c, nil
			}
		}
	}
	var c domain.Category
	var created time.Time
	var err error
	if withIcon {
		err = a.Pool.QueryRow(ctx, `
			SELECT id, name, slug, code_prefix, description, enabled, sort_order, icon_kind, icon_value, created_at
			FROM categories WHERE slug=$1`, slug).
			Scan(&c.ID, &c.Name, &c.Slug, &c.CodePrefix, &c.Description, &c.Enabled, &c.SortOrder,
				&c.Icon.Kind, &c.Icon.Value, &created)
	} else {
		err = a.Pool.QueryRow(ctx, `
			SELECT id, name, slug, code_prefix, description, enabled, sort_order, icon_kind, created_at
			FROM categories WHERE slug=$1`, slug).
			Scan(&c.ID, &c.Name, &c.Slug, &c.CodePrefix, &c.Description, &c.Enabled, &c.SortOrder,
				&c.Icon.Kind, &created)
		c.Icon.Value = ""
	}
	if err != nil {
		return domain.Category{}, apperr.NotFound("类别不存在")
	}
	c.CreatedAt = formatTS(created)
	if !withIcon {
		catSlugCache.Store(slug, catSlugCacheEntry{c: c, at: time.Now()})
	}
	return c, nil
}

type catSlugCacheEntry struct {
	c  domain.Category
	at time.Time
}

var catSlugCache sync.Map

func (a *App) invalidateCategorySlugCache() {
	catSlugCache.Range(func(k, _ any) bool {
		catSlugCache.Delete(k)
		return true
	})
	// 类别名/图标/启停会影响公开 /public/config 与库存列表
	a.invalidatePublicFacingCaches(context.Background())
}
