package app

import (
	"context"
	"strings"
	"time"

	"github.com/cardkey/cardkey/internal/domain"
	"github.com/cardkey/cardkey/internal/pkg/apperr"
	"github.com/google/uuid"
)

func (a *App) ListCategories(ctx context.Context) ([]domain.Category, error) {
	rows, err := a.Pool.Query(ctx, `
		SELECT c.id, c.name, c.slug, c.code_prefix, c.description, c.enabled, c.sort_order,
		       c.icon_kind, c.icon_value, c.created_at,
		       COUNT(cards.id) AS card_count,
		       COUNT(cards.id) FILTER (WHERE cards.status='unused') AS unused_count,
		       COUNT(cards.id) FILTER (WHERE cards.status='used') AS used_count
		FROM categories c
		LEFT JOIN cards ON cards.category_id = c.id
		GROUP BY c.id
		ORDER BY c.sort_order, c.created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Category
	for rows.Next() {
		var c domain.Category
		var created time.Time
		var cardCount, unused, used int
		if err := rows.Scan(&c.ID, &c.Name, &c.Slug, &c.CodePrefix, &c.Description, &c.Enabled, &c.SortOrder,
			&c.Icon.Kind, &c.Icon.Value, &created, &cardCount, &unused, &used); err != nil {
			return nil, err
		}
		c.CreatedAt = formatTS(created)
		c.CardCount = &cardCount
		c.UnusedCount = &unused
		c.UsedCount = &used
		out = append(out, c)
	}
	if out == nil {
		out = []domain.Category{}
	}
	return out, nil
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
	// 旧库 icon_value 若仍是 VARCHAR(128)，长 data URL 会炸；给出可操作提示（热修复应已扩成 TEXT）
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
	a.Audit(ctx, "admin", actor, "create_category", "category:"+id, name+" ("+prefix+")", ip)
	z := 0
	return domain.Category{
		ID: id, Name: name, Slug: slug, CodePrefix: prefix, Description: desc,
		Enabled: true, SortOrder: sort, Icon: icon, CardCount: &z, UnusedCount: &z, UsedCount: &z,
		CreatedAt: formatTS(created),
	}, nil
}

func (a *App) UpdateCategory(ctx context.Context, id string, name, desc *string, enabled *bool, sort *int, icon *domain.CategoryIcon, actor, ip string) (domain.Category, error) {
	cats, err := a.ListCategories(ctx)
	if err != nil {
		return domain.Category{}, err
	}
	var cur *domain.Category
	for i := range cats {
		if cats[i].ID == id {
			cur = &cats[i]
			break
		}
	}
	if cur == nil {
		return domain.Category{}, apperr.NotFound("类别不存在")
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
	a.Audit(ctx, "admin", actor, "update_category", "category:"+id, cur.Name, ip)
	return *cur, nil
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

	// 无交易数据时可能仍有 unused/disabled 库存，一并清理
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
	a.Audit(ctx, "admin", actor, "delete_category", "category:"+id, name, ip)
	return nil
}

func (a *App) FindCategoryBySlug(ctx context.Context, slug string) (domain.Category, error) {
	var c domain.Category
	var created time.Time
	err := a.Pool.QueryRow(ctx, `
		SELECT id, name, slug, code_prefix, description, enabled, sort_order, icon_kind, icon_value, created_at
		FROM categories WHERE slug=$1`, slug).
		Scan(&c.ID, &c.Name, &c.Slug, &c.CodePrefix, &c.Description, &c.Enabled, &c.SortOrder,
			&c.Icon.Kind, &c.Icon.Value, &created)
	if err != nil {
		return c, apperr.New(400, "CATEGORY_INVALID", "类别无效或已关闭")
	}
	c.CreatedAt = formatTS(created)
	return c, nil
}
