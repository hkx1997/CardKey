package db

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	return ConnectWithPool(ctx, url, 20, 2)
}

func ConnectWithPool(ctx context.Context, url string, maxConns, minConns int32) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	if maxConns < 1 {
		maxConns = 20
	}
	if minConns < 0 {
		minConns = 0
	}
	if minConns > maxConns {
		minConns = maxConns
	}
	cfg.MaxConns = maxConns
	cfg.MinConns = minConns
	cfg.MaxConnLifetime = time.Hour
	cfg.MaxConnIdleTime = 15 * time.Minute
	cfg.HealthCheckPeriod = time.Minute
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

// MigrateFS 按文件名排序执行 *.sql（幂等：schema_migrations 记录）。
func MigrateFS(ctx context.Context, pool *pgxpool.Pool, fsys fs.FS) error {
	_, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			filename TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`)
	if err != nil {
		return err
	}
	entries, err := fs.ReadDir(fsys, ".")
	if err != nil {
		return fmt.Errorf("read migrations fs: %w", err)
	}
	var files []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			files = append(files, e.Name())
		}
	}
	sort.Strings(files)
	for _, name := range files {
		var exists bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE filename=$1)`, name).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		body, err := fs.ReadFile(fsys, name)
		if err != nil {
			return err
		}
		tx, err := pool.Begin(ctx)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, string(body)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("migrate %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations(filename) VALUES($1)`, name); err != nil {
			_ = tx.Rollback(ctx)
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
	}
	return nil
}

// Migrate 从磁盘目录执行迁移（开发 / 兼容 MIGRATIONS_DIR）。
func Migrate(ctx context.Context, pool *pgxpool.Pool, migrationsDir string) error {
	if migrationsDir == "" {
		return fmt.Errorf("migrations dir empty")
	}
	return MigrateFS(ctx, pool, os.DirFS(migrationsDir))
}

// EnsureSchemaHotfixes 对已装库做幂等补丁（嵌入迁移未跟上时的兜底）。
// 例如：旧库 icon_value 仍是 VARCHAR(128)，上传图标 data URL 会 INTERNAL_ERROR。
func EnsureSchemaHotfixes(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `
		DO $$
		BEGIN
		  IF EXISTS (
		    SELECT 1 FROM information_schema.columns
		    WHERE table_schema = 'public' AND table_name = 'categories'
		      AND column_name = 'icon_value' AND data_type = 'character varying'
		  ) THEN
		    ALTER TABLE categories ALTER COLUMN icon_value TYPE TEXT;
		  END IF;
		END $$;
	`)
	return err
}

// DirFS 将目录转为 fs.FS；目录无效时返回错误。
func DirFS(dir string) (fs.FS, error) {
	st, err := os.Stat(dir)
	if err != nil || !st.IsDir() {
		return nil, fmt.Errorf("migrations dir not found: %s", dir)
	}
	return os.DirFS(dir), nil
}

// ResolveMigrationsDir 兼容旧路径探测。
func ResolveMigrationsDir(explicit string) string {
	if explicit != "" {
		if st, err := os.Stat(explicit); err == nil && st.IsDir() {
			return explicit
		}
	}
	for _, c := range []string{"migrations", "backend/migrations", filepath.Join("..", "migrations")} {
		if st, err := os.Stat(c); err == nil && st.IsDir() {
			return c
		}
	}
	return ""
}
