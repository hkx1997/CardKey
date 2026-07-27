# 数据库迁移

## 在线更新如何带上迁移

1. 本目录全部 `*.sql` 由 `embed.go` 的 `//go:embed *.sql` **编译进** `cardkey` 二进制。  
2. 管理端「一键更新」只下载/替换 Linux 二进制并重启。  
3. 进程启动时 `db.MigrateFS(migrations.FS)` **自动**执行 `schema_migrations` 中尚未记录的文件。  
4. 因此：**不要**假设 Docker 镜像里旧的 `/app/migrations` 目录会跟着一键更新变新；**以嵌入内容为准**。

## 新增迁移

```text
00N_short_description.sql   # N 递增，只追加，不改历史文件
```

- 幂等优先（`IF NOT EXISTS` / 可重复的 `ALTER` 需谨慎）。  
- 发版前：`go build ./cmd/cardkey`，确认 embed 无报错。  
- 发版：`bash scripts/release.sh`（会把含新 SQL 的二进制传到 GitHub Release）。

## 查看状态

管理端「系统更新」面板，或：

```http
GET /api/v1/admin/system/info
```

字段：`migrationsEmbedded`、`migrationsBundled`、`migrationsApplied`。
