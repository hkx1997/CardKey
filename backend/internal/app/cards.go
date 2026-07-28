package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/cardkey/cardkey/internal/crypto"
	"github.com/cardkey/cardkey/internal/domain"
	"github.com/cardkey/cardkey/internal/pkg/apperr"
	"github.com/cardkey/cardkey/internal/pkg/paging"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/sync/errgroup"
)

// ListCards 支持 page/OFFSET 与 keyset cursor（cursor 优先，避免深翻页扫 OFFSET）。
// wantExact=true 时强制精确 COUNT；筛选条件下默认跳过 COUNT 仅用 hasMore。
func (a *App) ListCards(ctx context.Context, page, pageSize int, status, q, categorySlug, batchID, cursor string, wantExact bool) (domain.PageResult[domain.Card], error) {
	page, pageSize = paging.Normalize(page, pageSize, 10, 100)
	where := []string{"1=1"}
	args := []any{}
	i := 1
	if status != "" && status != "all" {
		where = append(where, fmt.Sprintf("cards.status=$%d", i))
		args = append(args, status)
		i++
	}
	if q != "" {
		where = append(where, fmt.Sprintf("(cards.code ILIKE $%d OR cards.note ILIKE $%d)", i, i))
		args = append(args, "%"+q+"%")
		i++
	}
	needCatJoin := categorySlug != ""
	if needCatJoin {
		where = append(where, fmt.Sprintf("cat.slug=$%d", i))
		args = append(args, categorySlug)
		i++
	}
	if batchID != "" {
		where = append(where, fmt.Sprintf("cards.batch_id=$%d", i))
		args = append(args, batchID)
		i++
	}
	useKeyset := false
	if cur, ok := decodeListCursor(cursor); ok {
		frag, cargs := keysetPredicate("cards", cur, i)
		where = append(where, frag)
		args = append(args, cargs...)
		i += len(cargs)
		useKeyset = true
	}
	wsql := strings.Join(where, " AND ")

	unfiltered := status == "" || status == "all"
	unfiltered = unfiltered && q == "" && categorySlug == "" && batchID == ""

	countArgs := append([]any{}, args...)
	// keyset 条件不应进 COUNT（COUNT 针对整筛选集）
	countWhere := wsql
	if useKeyset {
		// 重建不含 cursor 的 where 做 count
		cw := []string{"1=1"}
		cargs := []any{}
		ci := 1
		if status != "" && status != "all" {
			cw = append(cw, fmt.Sprintf("cards.status=$%d", ci))
			cargs = append(cargs, status)
			ci++
		}
		if q != "" {
			cw = append(cw, fmt.Sprintf("(cards.code ILIKE $%d OR cards.note ILIKE $%d)", ci, ci))
			cargs = append(cargs, "%"+q+"%")
			ci++
		}
		if needCatJoin {
			cw = append(cw, fmt.Sprintf("cat.slug=$%d", ci))
			cargs = append(cargs, categorySlug)
			ci++
		}
		if batchID != "" {
			cw = append(cw, fmt.Sprintf("cards.batch_id=$%d", ci))
			cargs = append(cargs, batchID)
		}
		countWhere = strings.Join(cw, " AND ")
		countArgs = cargs
	}

	// 多取 1 行判断 HasMore
	fetchN := pageSize + 1
	var listArgs []any
	if useKeyset {
		listArgs = append(append([]any{}, args...), fetchN)
	} else {
		listArgs = append(append([]any{}, args...), fetchN, paging.Offset(page, pageSize))
	}

	// 筛选列表默认不做精确 COUNT（大表 + ILIKE 很贵）；无筛选或 wantExact 才算
	doCount := unfiltered || wantExact

	var total int
	totalExact := true
	var items []domain.Card
	var itemTimes []time.Time
	g, gctx := errgroup.WithContext(ctx)
	if doCount {
		g.Go(func() error {
			n, exact, err := a.smartCount(gctx, "cards", filterKey(status, q, categorySlug, batchID), unfiltered, 8000, func() (int, error) {
				var countSQL string
				if needCatJoin {
					countSQL = `SELECT COUNT(*) FROM cards JOIN categories cat ON cat.id=cards.category_id WHERE ` + countWhere
				} else {
					countSQL = `SELECT COUNT(*) FROM cards WHERE ` + countWhere
				}
				var n int
				err := a.Pool.QueryRow(gctx, countSQL, countArgs...).Scan(&n)
				return n, err
			})
			if err != nil {
				return err
			}
			total, totalExact = n, exact
			return nil
		})
	} else {
		totalExact = false
		total = 0
	}
	g.Go(func() error {
		var sql string
		if useKeyset {
			sql = fmt.Sprintf(`
				SELECT cards.id, cards.category_id, cat.slug, cat.name, cards.code, cards.type, cards.status,
				       cards.batch_id, b.name, cards.note, cards.expires_at, cards.used_at, cards.used_ip::text, cards.created_at,
				       COALESCE(cards.content_filename,''), COALESCE(cards.content_mime,''), COALESCE(cards.content_size,0)
				FROM cards
				JOIN categories cat ON cat.id=cards.category_id
				LEFT JOIN batches b ON b.id=cards.batch_id
				WHERE %s
				ORDER BY cards.created_at DESC, cards.id DESC
				LIMIT $%d`, wsql, i)
		} else {
			sql = fmt.Sprintf(`
				SELECT cards.id, cards.category_id, cat.slug, cat.name, cards.code, cards.type, cards.status,
				       cards.batch_id, b.name, cards.note, cards.expires_at, cards.used_at, cards.used_ip::text, cards.created_at,
				       COALESCE(cards.content_filename,''), COALESCE(cards.content_mime,''), COALESCE(cards.content_size,0)
				FROM cards
				JOIN categories cat ON cat.id=cards.category_id
				LEFT JOIN batches b ON b.id=cards.batch_id
				WHERE %s
				ORDER BY cards.created_at DESC, cards.id DESC
				LIMIT $%d OFFSET $%d`, wsql, i, i+1)
		}
		rows, err := a.Pool.Query(gctx, sql, listArgs...)
		if err != nil {
			return err
		}
		defer rows.Close()
		out := []domain.Card{}
		times := []time.Time{}
		for rows.Next() {
			var c domain.Card
			var created time.Time
			var exp, used *time.Time
			var usedIP *string
			var bid, bname *string
			if err := rows.Scan(&c.ID, &c.CategoryID, &c.CategorySlug, &c.CategoryName, &c.Code, &c.Type, &c.Status,
				&bid, &bname, &c.Note, &exp, &used, &usedIP, &created,
				&c.Filename, &c.Mime, &c.Size); err != nil {
				return err
			}
			c.BatchID = bid
			c.BatchName = bname
			c.ExpiresAt = domain.PtrTime(exp)
			c.UsedAt = domain.PtrTime(used)
			c.UsedIP = usedIP
			c.CreatedAt = formatTS(created)
			c.Filename, c.Mime, c.Size = fillContentMeta(c.Type, c.Filename, c.Mime, c.Size)
			out = append(out, c)
			times = append(times, created)
		}
		items = out
		itemTimes = times
		return nil
	})
	if err := g.Wait(); err != nil {
		return domain.PageResult[domain.Card]{}, err
	}
	if items == nil {
		items = []domain.Card{}
	}
	// 裁剪 + next cursor
	hasMore := len(items) > pageSize
	if hasMore {
		items = items[:pageSize]
		itemTimes = itemTimes[:pageSize]
	}
	next := ""
	if hasMore && len(items) > 0 {
		next = encodeListCursor(itemTimes[len(itemTimes)-1], items[len(items)-1].ID)
	}
	// 若无 hasMore 但 total 已知，校正
	if !hasMore && totalExact && page*pageSize < total {
		// OFFSET 模式可能 total 更大但本页未满（删数据）——以 hasMore 为准
	}
	return domain.PageResult[domain.Card]{
		Items: items, Total: total, Page: page, PageSize: pageSize,
		TotalExact: totalExact, HasMore: hasMore, NextCursor: next,
	}, nil
}

func (a *App) GetCard(ctx context.Context, id string, reveal bool, actor, ip string) (domain.Card, error) {
	var c domain.Card
	var enc, nonce []byte
	var created time.Time
	var exp, used *time.Time
	var usedIP *string
	var batchID, batchName *string
	var storageKey, storageBackend string
	err := a.Pool.QueryRow(ctx, `
		SELECT cards.id, cards.category_id, cat.slug, cat.name, cards.code, cards.type, cards.status,
		       cards.batch_id, b.name, cards.note, cards.expires_at, cards.used_at, cards.used_ip::text, cards.created_at,
		       cards.content_enc, cards.content_nonce,
		       COALESCE(cards.content_filename,''), COALESCE(cards.content_mime,''), COALESCE(cards.content_size,0),
		       COALESCE(cards.storage_key,''), COALESCE(cards.storage_backend,'')
		FROM cards
		JOIN categories cat ON cat.id=cards.category_id
		LEFT JOIN batches b ON b.id=cards.batch_id
		WHERE cards.id=$1`, id).Scan(
		&c.ID, &c.CategoryID, &c.CategorySlug, &c.CategoryName, &c.Code, &c.Type, &c.Status,
		&batchID, &batchName, &c.Note, &exp, &used, &usedIP, &created, &enc, &nonce,
		&c.Filename, &c.Mime, &c.Size, &storageKey, &storageBackend)
	if err != nil {
		return c, apperr.NotFound("卡密不存在")
	}
	c.BatchID = batchID
	c.BatchName = batchName
	c.ExpiresAt = domain.PtrTime(exp)
	c.UsedAt = domain.PtrTime(used)
	c.UsedIP = usedIP
	c.CreatedAt = formatTS(created)
	c.Filename, c.Mime, c.Size = fillContentMeta(c.Type, c.Filename, c.Mime, c.Size)
	if reveal {
		raw, err := a.DecryptBytes(enc, nonce)
		if err != nil {
			return c, apperr.Internal("解密失败")
		}
		if storageBackend == "local" && storageKey != "" {
			if obj, e := a.LoadObject(storageKey); e == nil {
				raw = obj
			}
		}
		if c.Size == 0 {
			c.Size = int64(len(raw))
		}
		content, encName := packPayloadForAPI(c.Type, raw, c.Filename, c.Mime, c.Size)
		c.Content = &content
		c.ContentEncoding = encName
		a.Audit(ctx, "admin", actor, "reveal_content", "card:"+id, "查看卡密内容", ip)
	}
	return c, nil
}

func (a *App) CreateCard(ctx context.Context, categoryID, content string, typ domain.CardType, note string, batchID *string, actor, ip string) (domain.Card, error) {
	return a.CreateCardWithPayload(ctx, CreateCardPayload{
		CategoryID: categoryID,
		Type:       typ,
		Content:    content,
		Note:       note,
		BatchID:    batchID,
	}, actor, ip)
}

func (a *App) CreateCardWithPayload(ctx context.Context, in CreateCardPayload, actor, ip string) (domain.Card, error) {
	var prefix string
	if err := a.Pool.QueryRow(ctx, `SELECT code_prefix FROM categories WHERE id=$1`, in.CategoryID).Scan(&prefix); err != nil {
		return domain.Card{}, apperr.Validation("类别无效")
	}
	raw, typ, filename, mime, err := resolveCreateBytes(in)
	if err != nil {
		return domain.Card{}, err
	}
	code, err := a.uniqueCode(ctx, in.CategoryID, prefix)
	if err != nil {
		return domain.Card{}, err
	}
	// 文本默认文件名带编码
	if domain.IsTextCardType(typ) && (in.Filename == "" || filename == "content.txt" || filename == "content.json") {
		filename = defaultFilename(typ, code)
	}
	storageKey, storageBackend := "", ""
	size := int64(len(raw))
	// 大文件可选落盘（OBJECT_STORAGE_DIR），DB 存占位密文 + storage_key
	if a.ObjectStorageEnabled() && domain.IsBinaryCardType(typ) && len(raw) > 64*1024 {
		key, e := a.StoreObject(in.CategoryID, raw, filename)
		if e == nil {
			storageKey, storageBackend = key, "local"
			raw = []byte("stored:" + key) // 占位，解密时走 LoadObject
		}
	}
	enc, nonce, err := a.EncryptBytes(raw)
	if err != nil {
		return domain.Card{}, apperr.Internal("加密失败")
	}
	id := uuid.NewString()
	var created time.Time
	err = a.Pool.QueryRow(ctx, `
		INSERT INTO cards(id, category_id, code, content_enc, content_nonce, type, batch_id, status, note,
		                  content_filename, content_mime, content_size, storage_key, storage_backend)
		VALUES($1,$2,$3,$4,$5,$6,$7,'unused',$8,$9,$10,$11,$12,$13) RETURNING created_at`,
		id, in.CategoryID, code, enc, nonce, typ, in.BatchID, in.Note, filename, mime, size, storageKey, storageBackend).Scan(&created)
	if err != nil {
		return domain.Card{}, err
	}
	a.bumpCardStats(ctx, in.CategoryID, 1, 0, 1)
	a.Audit(ctx, "admin", actor, "create_card", "card:"+id, fmt.Sprintf("创建 %s type=%s size=%d", code, typ, size), ip)
	return domain.Card{
		ID: id, CategoryID: in.CategoryID, Code: code, Type: typ, Status: domain.StatusUnused,
		BatchID: in.BatchID, Note: in.Note, CreatedAt: formatTS(created),
		Filename: filename, Mime: mime, Size: size,
	}, nil
}

func (a *App) uniqueCode(ctx context.Context, categoryID, prefix string) (string, error) {
	for i := 0; i < 8; i++ {
		code, err := crypto.GenerateCode(prefix)
		if err != nil {
			return "", err
		}
		var exists bool
		if err := a.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM cards WHERE category_id=$1 AND code=$2)`, categoryID, code).Scan(&exists); err != nil {
			return "", err
		}
		if !exists {
			return code, nil
		}
	}
	return "", apperr.Internal("编码生成冲突")
}

func (a *App) ImportCards(ctx context.Context, categoryID, raw string, typ domain.CardType, batchName, note, actor, ip string) (map[string]any, error) {
	return a.importCards(ctx, categoryID, raw, typ, batchName, note, actor, ip, "")
}

// importCards 可选 jobID：异步任务时每 chunk 回写 done_lines。
func (a *App) importCards(ctx context.Context, categoryID, raw string, typ domain.CardType, batchName, note, actor, ip, jobID string) (map[string]any, error) {
	typ = normalizeCardType(typ)
	if domain.IsBinaryCardType(typ) {
		return nil, apperr.Validation("批量导入仅支持文本类（text/txt/json/account）；文件请单条上传")
	}
	var cat domain.Category
	var created time.Time
	err := a.Pool.QueryRow(ctx, `
		SELECT id, name, slug, code_prefix, description, enabled, sort_order, icon_kind, icon_value, created_at
		FROM categories WHERE id=$1`, categoryID).
		Scan(&cat.ID, &cat.Name, &cat.Slug, &cat.CodePrefix, &cat.Description, &cat.Enabled, &cat.SortOrder,
			&cat.Icon.Kind, &cat.Icon.Value, &created)
	if err != nil {
		return nil, apperr.Validation("类别无效")
	}
	cat.CreatedAt = formatTS(created)
	lines := []string{}
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			lines = append(lines, line)
		}
	}
	if len(lines) == 0 {
		return nil, apperr.Validation("请输入导入内容")
	}
	if typ == "" {
		typ = domain.TypeText
	}

	var batch *domain.Batch
	var batchID *string
	if strings.TrimSpace(batchName) != "" {
		bid := uuid.NewString()
		var bcreated time.Time
		err = a.Pool.QueryRow(ctx, `
			INSERT INTO batches(id, category_id, name, note) VALUES($1,$2,$3,$4) RETURNING created_at`,
			bid, categoryID, batchName, note).Scan(&bcreated)
		if err != nil {
			return nil, err
		}
		batch = &domain.Batch{
			ID: bid, CategoryID: categoryID, CategoryName: cat.Name, Name: batchName, Note: note,
			CardCount: len(lines), UnusedCount: len(lines), CreatedAt: formatTS(bcreated),
		}
		batchID = &batch.ID
	}

	// 分批：预生成编码（一次 ANY 查重）+ CopyFrom 批量入库
	chunk := 500
	if jobID != "" {
		chunk = 100
	}
	codes := make([]string, 0, len(lines))
	reportProgress := func(done int) {
		if jobID == "" {
			return
		}
		_, _ = a.Pool.Exec(ctx, `
			UPDATE import_jobs SET done_lines=$2, success_count=$2, updated_at=now()
			WHERE id=$1::uuid AND status='running'`, jobID, done)
	}
	mime := defaultMimeForType(typ)
	for i := 0; i < len(lines); i += chunk {
		end := i + chunk
		if end > len(lines) {
			end = len(lines)
		}
		chunkLines := lines[i:end]
		need := len(chunkLines)
		genCodes, err := a.allocateUniqueCodes(ctx, categoryID, cat.CodePrefix, need)
		if err != nil {
			return nil, err
		}
		// 加密并组行
		rows := make([][]any, 0, need)
		for j, content := range chunkLines {
			code := genCodes[j]
			enc, nonce, err := a.EncryptContent(content)
			if err != nil {
				return nil, err
			}
			fn := defaultFilename(typ, code)
			sz := int64(len(content))
			var bid any
			if batchID != nil {
				bid = *batchID
			}
			rows = append(rows, []any{
				categoryID, code, enc, nonce, string(typ), bid, "unused", note, fn, mime, sz,
			})
			codes = append(codes, code)
		}
		// COPY 一次写入（失败则 Batch 回退）
		_, err = a.Pool.CopyFrom(ctx,
			pgx.Identifier{"cards"},
			[]string{
				"category_id", "code", "content_enc", "content_nonce", "type", "batch_id",
				"status", "note", "content_filename", "content_mime", "content_size",
			},
			pgx.CopyFromRows(rows),
		)
		if err != nil {
			if err2 := a.insertCardsBatch(ctx, categoryID, typ, batchID, note, chunkLines, genCodes); err2 != nil {
				return nil, fmt.Errorf("import copy: %w; batch fallback: %v", err, err2)
			}
		}
		reportProgress(len(codes))
	}
	a.bumpCardStats(ctx, categoryID, len(codes), 0, len(codes))
	a.Audit(ctx, "admin", actor, "import", "category:"+categoryID, fmt.Sprintf("导入 %d 条 → %s", len(codes), cat.Name), ip)
	return map[string]any{
		"batch":    batch,
		"codes":    codes,
		"total":    len(codes),
		"category": cat,
	}, nil
}

// allocateUniqueCodes 内存生成 + 一次 ANY 查重，避免逐行 EXISTS。
func (a *App) allocateUniqueCodes(ctx context.Context, categoryID, prefix string, n int) ([]string, error) {
	if n < 1 {
		return nil, nil
	}
	out := make([]string, 0, n)
	local := make(map[string]struct{}, n*2)
	for attempt := 0; attempt < 20 && len(out) < n; attempt++ {
		need := n - len(out)
		// 多生成一些候选，降低冲突轮次
		candN := need*2 + 8
		cands := make([]string, 0, candN)
		for len(cands) < candN {
			code, err := crypto.GenerateCode(prefix)
			if err != nil {
				return nil, err
			}
			if _, ok := local[code]; ok {
				continue
			}
			local[code] = struct{}{}
			cands = append(cands, code)
		}
		// 一次查库：已存在的编码
		rows, err := a.Pool.Query(ctx, `
			SELECT code FROM cards WHERE category_id=$1 AND code = ANY($2)`, categoryID, cands)
		if err != nil {
			return nil, err
		}
		exist := map[string]struct{}{}
		for rows.Next() {
			var c string
			if rows.Scan(&c) == nil {
				exist[c] = struct{}{}
			}
		}
		rows.Close()
		for _, c := range cands {
			if _, bad := exist[c]; bad {
				continue
			}
			out = append(out, c)
			if len(out) >= n {
				break
			}
		}
	}
	if len(out) < n {
		return nil, apperr.Internal("编码生成冲突过多，请重试")
	}
	return out[:n], nil
}

// insertCardsBatch CopyFrom 失败时的 Batch 回退；codes 与 contents 等长。
func (a *App) insertCardsBatch(ctx context.Context, categoryID string, typ domain.CardType, batchID *string, note string, contents, codes []string) error {
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	b := &pgx.Batch{}
	mime := defaultMimeForType(typ)
	for i, content := range contents {
		code := codes[i]
		enc, nonce, err := a.EncryptContent(content)
		if err != nil {
			return err
		}
		fn := defaultFilename(typ, code)
		sz := int64(len(content))
		b.Queue(`
			INSERT INTO cards(category_id, code, content_enc, content_nonce, type, batch_id, status, note,
			                  content_filename, content_mime, content_size)
			VALUES($1,$2,$3,$4,$5,$6,'unused',$7,$8,$9,$10)`,
			categoryID, code, enc, nonce, typ, batchID, note, fn, mime, sz)
	}
	br := tx.SendBatch(ctx, b)
	for range contents {
		if _, err := br.Exec(); err != nil {
			_ = br.Close()
			return err
		}
	}
	if err := br.Close(); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (a *App) uniqueCodeTx(ctx context.Context, tx pgx.Tx, categoryID, prefix string) (string, error) {
	for i := 0; i < 8; i++ {
		code, err := crypto.GenerateCode(prefix)
		if err != nil {
			return "", err
		}
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM cards WHERE category_id=$1 AND code=$2)`, categoryID, code).Scan(&exists); err != nil {
			return "", err
		}
		if !exists {
			return code, nil
		}
	}
	return "", apperr.Internal("编码生成冲突")
}

func (a *App) BatchAction(ctx context.Context, ids []string, action, actor, ip string) (int, error) {
	if len(ids) == 0 {
		return 0, apperr.Validation("未选择卡密")
	}
	act, err := domain.NormalizeBatchAction(action)
	if err != nil {
		return 0, apperr.Validation(err.Error())
	}
	switch act {
	case domain.BatchDisable:
		// 按类别统计将减少的 unused
		rows, _ := a.Pool.Query(ctx, `
			SELECT category_id::text, COUNT(*)::int FROM cards
			WHERE id = ANY($1) AND status='unused' GROUP BY category_id`, ids)
		type pair struct{ id string; n int }
		var bumps []pair
		if rows != nil {
			for rows.Next() {
				var p pair
				_ = rows.Scan(&p.id, &p.n)
				bumps = append(bumps, p)
			}
			rows.Close()
		}
		tag, err := a.Pool.Exec(ctx, `
			UPDATE cards SET status=$1, updated_at=now()
			WHERE id = ANY($2) AND status = 'unused'`, domain.StatusDisabled, ids)
		if err != nil {
			return 0, err
		}
		n := int(tag.RowsAffected())
		for _, p := range bumps {
			a.bumpCardStats(ctx, p.id, 0, 0, -p.n)
		}
		a.Audit(ctx, "admin", actor, "batch_disable", "cards", fmt.Sprintf("禁用 %d 条", n), ip)
		return n, nil
	case domain.BatchEnable, domain.BatchRestore:
		// 分别统计 used / disabled 以便 used_count 正确
		type pair struct{ id string; n int }
		var fromUsed, fromDis []pair
		if rows, _ := a.Pool.Query(ctx, `
			SELECT category_id::text, COUNT(*)::int FROM cards
			WHERE id = ANY($1) AND status='used' GROUP BY category_id`, ids); rows != nil {
			for rows.Next() {
				var p pair
				_ = rows.Scan(&p.id, &p.n)
				fromUsed = append(fromUsed, p)
			}
			rows.Close()
		}
		if rows, _ := a.Pool.Query(ctx, `
			SELECT category_id::text, COUNT(*)::int FROM cards
			WHERE id = ANY($1) AND status='disabled' GROUP BY category_id`, ids); rows != nil {
			for rows.Next() {
				var p pair
				_ = rows.Scan(&p.id, &p.n)
				fromDis = append(fromDis, p)
			}
			rows.Close()
		}
		tag, err := a.Pool.Exec(ctx, `
			UPDATE cards SET
				status = 'unused',
				used_at = NULL,
				used_ip = NULL,
				updated_at = now(),
				version = version + 1
			WHERE id = ANY($1) AND status IN ('disabled', 'used')`, ids)
		if err != nil {
			return 0, err
		}
		n := int(tag.RowsAffected())
		for _, p := range fromUsed {
			a.bumpCardStats(ctx, p.id, 0, -p.n, p.n)
		}
		for _, p := range fromDis {
			a.bumpCardStats(ctx, p.id, 0, 0, p.n)
		}
		a.Audit(ctx, "admin", actor, "batch_enable", "cards",
			fmt.Sprintf("启用/复原 %d 条（含已兑换复原）", n), ip)
		return n, nil
	case domain.BatchDelete:
		type pair struct{ id string; n int }
		var unusedB, disB []pair
		if rows, _ := a.Pool.Query(ctx, `
			SELECT category_id::text, COUNT(*)::int FROM cards
			WHERE id = ANY($1) AND status='unused' GROUP BY category_id`, ids); rows != nil {
			for rows.Next() {
				var p pair
				_ = rows.Scan(&p.id, &p.n)
				unusedB = append(unusedB, p)
			}
			rows.Close()
		}
		if rows, _ := a.Pool.Query(ctx, `
			SELECT category_id::text, COUNT(*)::int FROM cards
			WHERE id = ANY($1) AND status='disabled' GROUP BY category_id`, ids); rows != nil {
			for rows.Next() {
				var p pair
				_ = rows.Scan(&p.id, &p.n)
				disB = append(disB, p)
			}
			rows.Close()
		}
		tag, err := a.Pool.Exec(ctx, `
			DELETE FROM cards
			WHERE id = ANY($1) AND status IN ('unused', 'disabled')`, ids)
		if err != nil {
			return 0, err
		}
		n := int(tag.RowsAffected())
		for _, p := range unusedB {
			a.bumpCardStats(ctx, p.id, -p.n, 0, -p.n)
		}
		for _, p := range disB {
			a.bumpCardStats(ctx, p.id, -p.n, 0, 0)
		}
		a.Audit(ctx, "admin", actor, "batch_delete", "cards", fmt.Sprintf("删除 %d 条", n), ip)
		return n, nil
	default:
		return 0, apperr.Validation("无效操作：支持 enable / disable / delete / restore")
	}
}

// DeleteBatch 删除空批次（无卡密）或仅含可删卡密的批次。
// 若批次内存在已兑换/过期卡密则拒绝。
func (a *App) DeleteBatch(ctx context.Context, id, actor, ip string) error {
	var name string
	var blocked int
	err := a.Pool.QueryRow(ctx, `
		SELECT b.name,
		       (SELECT COUNT(*) FROM cards c WHERE c.batch_id=b.id AND c.status IN ('used','expired'))
		FROM batches b WHERE b.id=$1`, id).Scan(&name, &blocked)
	if err != nil {
		return apperr.NotFound("批次不存在")
	}
	if blocked > 0 {
		return apperr.Conflict("批次内存在已兑换/过期卡密，无法删除")
	}
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM cards WHERE batch_id=$1 AND status IN ('unused','disabled')`, id); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `DELETE FROM batches WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("批次不存在")
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	a.Audit(ctx, "admin", actor, "delete_batch", "batch:"+id, name, ip)
	return nil
}

// maxExportCodes 单次导出上限，防止一次拉爆内存。
const maxExportCodes = 100_000

// exportCardsWhere 构建导出/流式导出共用 WHERE。
func exportCardsWhere(status, q, categorySlug, batchID string, ids []string) (wsql string, args []any, err error) {
	where := []string{"1=1"}
	args = []any{}
	i := 1
	if len(ids) > 0 {
		ph := make([]string, 0, len(ids))
		for _, id := range ids {
			id = strings.TrimSpace(id)
			if id == "" {
				continue
			}
			ph = append(ph, fmt.Sprintf("$%d", i))
			args = append(args, id)
			i++
		}
		if len(ph) == 0 {
			return "", nil, apperr.Validation("未选择任何卡密")
		}
		where = append(where, "cards.id IN ("+strings.Join(ph, ",")+")")
	} else {
		if status != "" && status != "all" {
			where = append(where, fmt.Sprintf("cards.status=$%d", i))
			args = append(args, status)
			i++
		}
		if q != "" {
			where = append(where, fmt.Sprintf("(cards.code ILIKE $%d OR cards.note ILIKE $%d)", i, i))
			args = append(args, "%"+q+"%")
			i++
		}
		if categorySlug != "" {
			where = append(where, fmt.Sprintf("cat.slug=$%d", i))
			args = append(args, categorySlug)
			i++
		}
		if batchID != "" {
			where = append(where, fmt.Sprintf("cards.batch_id=$%d", i))
			args = append(args, batchID)
			i++
		}
	}
	return strings.Join(where, " AND "), args, nil
}

// ExportCardCodes 导出卡密编码（一行一个）。ids 非空时仅导出指定 ID，否则按筛选条件。
func (a *App) ExportCardCodes(ctx context.Context, status, q, categorySlug, batchID string, ids []string, actor, ip string) ([]string, error) {
	wsql, args, err := exportCardsWhere(status, q, categorySlug, batchID, ids)
	if err != nil {
		return nil, err
	}
	var total int
	countSQL := `SELECT COUNT(*) FROM cards JOIN categories cat ON cat.id=cards.category_id WHERE ` + wsql
	if err := a.Pool.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, err
	}
	if total == 0 {
		return nil, apperr.Validation("没有可导出的卡密")
	}
	if total > maxExportCodes {
		return nil, apperr.Validation(fmt.Sprintf("导出数量超过上限 %d，请缩小筛选范围", maxExportCodes))
	}

	sql := `
		SELECT cards.code
		FROM cards
		JOIN categories cat ON cat.id=cards.category_id
		WHERE ` + wsql + `
		ORDER BY cards.created_at DESC`
	rows, err := a.Pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	codes := make([]string, 0, total)
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return nil, err
		}
		codes = append(codes, code)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	a.auditExport(ctx, len(codes), batchID, len(ids) > 0, actor, ip)
	return codes, nil
}

// StreamExportCardCodes 流式写出编码（一行一个），避免大导出整表进内存。
// beforeWrite 在开始写出前调用（可写 Content-Length/X-Export-Total 头）；onCount 每条进度。
func (a *App) StreamExportCardCodes(
	ctx context.Context,
	w interface{ Write([]byte) (int, error) },
	status, q, categorySlug, batchID string,
	ids []string,
	actor, ip string,
	beforeWrite func(total int) error,
	onCount func(n, total int),
) (int, error) {
	wsql, args, err := exportCardsWhere(status, q, categorySlug, batchID, ids)
	if err != nil {
		return 0, err
	}
	var total int
	countSQL := `SELECT COUNT(*) FROM cards JOIN categories cat ON cat.id=cards.category_id WHERE ` + wsql
	if err := a.Pool.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return 0, err
	}
	if total == 0 {
		return 0, apperr.Validation("没有可导出的卡密")
	}
	if total > maxExportCodes {
		return 0, apperr.Validation(fmt.Sprintf("导出数量超过上限 %d，请缩小筛选范围", maxExportCodes))
	}
	if beforeWrite != nil {
		if err := beforeWrite(total); err != nil {
			return 0, err
		}
	}
	sql := `
		SELECT cards.code
		FROM cards
		JOIN categories cat ON cat.id=cards.category_id
		WHERE ` + wsql + `
		ORDER BY cards.created_at DESC`
	rows, err := a.Pool.Query(ctx, sql, args...)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return n, err
		}
		if _, err := w.Write([]byte(code + "\n")); err != nil {
			return n, err
		}
		n++
		if onCount != nil {
			onCount(n, total)
		}
	}
	if err := rows.Err(); err != nil {
		return n, err
	}
	a.auditExport(ctx, n, batchID, len(ids) > 0, actor, ip)
	return n, nil
}

func (a *App) auditExport(ctx context.Context, count int, batchID string, byIDs bool, actor, ip string) {
	detail := fmt.Sprintf("count=%d", count)
	if batchID != "" {
		detail += " batch=" + batchID
	}
	if byIDs {
		detail += " mode=ids"
	} else {
		detail += " mode=filter"
	}
	a.Audit(ctx, "admin", actor, "export_cards", "cards", detail, ip)
}

// ExportBatchCardCodes 按批次导出全部卡密编码。
func (a *App) ExportBatchCardCodes(ctx context.Context, batchID, actor, ip string) (codes []string, batchName string, err error) {
	err = a.Pool.QueryRow(ctx, `SELECT name FROM batches WHERE id=$1`, batchID).Scan(&batchName)
	if err != nil {
		return nil, "", apperr.NotFound("批次不存在")
	}
	codes, err = a.ExportCardCodes(ctx, "", "", "", batchID, nil, actor, ip)
	if err != nil {
		return nil, batchName, err
	}
	return codes, batchName, nil
}

// ListBatches 服务端分页；先取页内批次再聚合卡数。
func (a *App) ListBatches(ctx context.Context, categorySlug string, page, pageSize int) (domain.PageResult[domain.Batch], error) {
	page, pageSize = paging.Normalize(page, pageSize, 10, 100)
	args := []any{}
	filter := ""
	if categorySlug != "" {
		filter = ` AND cat.slug=$1`
		args = append(args, categorySlug)
	}
	var total int
	countSQL := `
		SELECT COUNT(*) FROM batches b
		JOIN categories cat ON cat.id=b.category_id
		WHERE 1=1` + filter
	_ = a.Pool.QueryRow(ctx, countSQL, args...).Scan(&total)

	listArgs := append(append([]any{}, args...), pageSize+1, paging.Offset(page, pageSize))
	// $ for limit: if category filter then $2 $3 else $1 $2
	limIdx := len(args) + 1
	offIdx := len(args) + 2
	sql := fmt.Sprintf(`
		WITH page AS (
			SELECT b.id, b.category_id, cat.name AS category_name, b.name, b.note, b.created_at
			FROM batches b
			JOIN categories cat ON cat.id=b.category_id
			WHERE 1=1%s
			ORDER BY b.created_at DESC
			LIMIT $%d OFFSET $%d
		)
		SELECT p.id, p.category_id, p.category_name, p.name, p.note, p.created_at,
		       COALESCE(agg.card_count, 0), COALESCE(agg.unused_count, 0)
		FROM page p
		LEFT JOIN (
			SELECT c.batch_id,
			       COUNT(*)::int AS card_count,
			       COUNT(*) FILTER (WHERE c.status='unused')::int AS unused_count
			FROM cards c
			WHERE c.batch_id IN (SELECT id FROM page)
			GROUP BY c.batch_id
		) agg ON agg.batch_id = p.id
		ORDER BY p.created_at DESC`, filter, limIdx, offIdx)
	rows, err := a.Pool.Query(ctx, sql, listArgs...)
	if err != nil {
		return domain.PageResult[domain.Batch]{}, err
	}
	defer rows.Close()
	out := []domain.Batch{}
	for rows.Next() {
		var b domain.Batch
		var created time.Time
		if err := rows.Scan(&b.ID, &b.CategoryID, &b.CategoryName, &b.Name, &b.Note, &created, &b.CardCount, &b.UnusedCount); err != nil {
			return domain.PageResult[domain.Batch]{}, err
		}
		b.CreatedAt = formatTS(created)
		out = append(out, b)
	}
	hasMore := len(out) > pageSize
	if hasMore {
		out = out[:pageSize]
	}
	if !hasMore && total > page*pageSize {
		hasMore = page*pageSize < total
	}
	return domain.PageResult[domain.Batch]{
		Items: out, Total: total, Page: page, PageSize: pageSize,
		TotalExact: true, HasMore: hasMore,
	}, nil
}
