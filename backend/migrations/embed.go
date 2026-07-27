package migrations

import "embed"

// FS 将 SQL 迁移嵌入二进制，确保「在线只换可执行文件」时仍能跑新迁移。
//
//go:embed *.sql
var FS embed.FS
