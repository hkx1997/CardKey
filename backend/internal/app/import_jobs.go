package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/cardkey/cardkey/internal/domain"
	"github.com/cardkey/cardkey/internal/pkg/apperr"
	"github.com/google/uuid"
)

// ImportJob 异步导入任务投影。
type ImportJob struct {
	ID           string `json:"id"`
	CategoryID   string `json:"categoryId"`
	Status       string `json:"status"`
	TotalLines   int    `json:"totalLines"`
	DoneLines    int    `json:"doneLines"`
	SuccessCount int    `json:"successCount"`
	ErrorCount   int    `json:"errorCount"`
	ErrorReport  string `json:"errorReport,omitempty"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
}

// EnqueueImportJob 创建异步导入任务（大文本不阻塞请求）。
func (a *App) EnqueueImportJob(ctx context.Context, categoryID, raw string, typ domain.CardType, batchName, note, actor string) (ImportJob, error) {
	typ = normalizeCardType(typ)
	if domain.IsBinaryCardType(typ) {
		return ImportJob{}, apperr.Validation("批量导入仅支持文本类")
	}
	var exists bool
	if err := a.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM categories WHERE id=$1)`, categoryID).Scan(&exists); err != nil || !exists {
		return ImportJob{}, apperr.Validation("类别无效")
	}
	lines := 0
	for _, line := range strings.Split(raw, "\n") {
		if strings.TrimSpace(line) != "" {
			lines++
		}
	}
	if lines == 0 {
		return ImportJob{}, apperr.Validation("请输入导入内容")
	}
	id := uuid.NewString()
	var created, updated time.Time
	err := a.Pool.QueryRow(ctx, `
		INSERT INTO import_jobs(id, category_id, batch_name, note, card_type, raw_text, status, total_lines, created_by)
		VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8)
		RETURNING created_at, updated_at`,
		id, categoryID, batchName, note, typ, raw, lines, actor).Scan(&created, &updated)
	if err != nil {
		return ImportJob{}, err
	}
	// 异步立即尝试处理
	go func() {
		cctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		_ = a.RunImportJob(cctx, id)
	}()
	return ImportJob{
		ID: id, CategoryID: categoryID, Status: "pending",
		TotalLines: lines, CreatedAt: formatTS(created), UpdatedAt: formatTS(updated),
	}, nil
}

// GetImportJob 查询任务进度。
func (a *App) GetImportJob(ctx context.Context, id string) (ImportJob, error) {
	var j ImportJob
	var created, updated time.Time
	err := a.Pool.QueryRow(ctx, `
		SELECT id::text, category_id::text, status, total_lines, done_lines, success_count, error_count,
			COALESCE(error_report,''), created_at, updated_at
		FROM import_jobs WHERE id=$1::uuid`, id).Scan(
		&j.ID, &j.CategoryID, &j.Status, &j.TotalLines, &j.DoneLines, &j.SuccessCount, &j.ErrorCount,
		&j.ErrorReport, &created, &updated)
	if err != nil {
		return j, apperr.NotFound("导入任务不存在")
	}
	j.CreatedAt = formatTS(created)
	j.UpdatedAt = formatTS(updated)
	return j, nil
}

// ProcessPendingImportJobs 处理后台 pending 任务。
func (a *App) ProcessPendingImportJobs(ctx context.Context, limit int) {
	if limit < 1 {
		limit = 2
	}
	rows, err := a.Pool.Query(ctx, `
		SELECT id::text FROM import_jobs WHERE status='pending' ORDER BY created_at LIMIT $1`, limit)
	if err != nil {
		return
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	for _, id := range ids {
		_ = a.RunImportJob(ctx, id)
	}
}

// RunImportJob 执行导入（幂等：仅 pending 可跑）。
func (a *App) RunImportJob(ctx context.Context, jobID string) error {
	var categoryID, raw, batchName, note, typStr, status string
	err := a.Pool.QueryRow(ctx, `
		SELECT category_id::text, raw_text, batch_name, note, card_type, status
		FROM import_jobs WHERE id=$1::uuid`, jobID).
		Scan(&categoryID, &raw, &batchName, &note, &typStr, &status)
	if err != nil {
		return err
	}
	if status != "pending" && status != "running" {
		return nil
	}
	_, _ = a.Pool.Exec(ctx, `UPDATE import_jobs SET status='running', updated_at=now() WHERE id=$1::uuid`, jobID)
	res, err := a.ImportCards(ctx, categoryID, raw, domain.CardType(typStr), batchName, note, "import-job", "")
	if err != nil {
		_, _ = a.Pool.Exec(ctx, `
			UPDATE import_jobs SET status='failed', error_report=$2, updated_at=now(), finished_at=now()
			WHERE id=$1::uuid`, jobID, err.Error())
		return err
	}
	total := 0
	if t, ok := res["total"].(int); ok {
		total = t
	}
	_, _ = a.Pool.Exec(ctx, `
		UPDATE import_jobs SET status='success', done_lines=$2, success_count=$2, error_count=0,
			updated_at=now(), finished_at=now(), raw_text=''
		WHERE id=$1::uuid`, jobID, total)
	return nil
}

// ListImportJobs 最近任务。
func (a *App) ListImportJobs(ctx context.Context, limit int) ([]ImportJob, error) {
	if limit < 1 || limit > 50 {
		limit = 20
	}
	rows, err := a.Pool.Query(ctx, `
		SELECT id::text, category_id::text, status, total_lines, done_lines, success_count, error_count,
			COALESCE(error_report,''), created_at, updated_at
		FROM import_jobs ORDER BY created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ImportJob
	for rows.Next() {
		var j ImportJob
		var created, updated time.Time
		if err := rows.Scan(&j.ID, &j.CategoryID, &j.Status, &j.TotalLines, &j.DoneLines, &j.SuccessCount, &j.ErrorCount,
			&j.ErrorReport, &created, &updated); err != nil {
			return nil, err
		}
		j.CreatedAt = formatTS(created)
		j.UpdatedAt = formatTS(updated)
		out = append(out, j)
	}
	if out == nil {
		out = []ImportJob{}
	}
	return out, nil
}

// fmt for audit silence
var _ = fmt.Sprintf
