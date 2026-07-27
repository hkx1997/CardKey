# CardKey

自托管高并发卡密兑换平台：公开兑换端 + 管理端 + HTTP API。

[![Go](https://img.shields.io/badge/Go-1.22+-00ADD8)](https://go.dev/)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)](https://www.postgresql.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 功能概览

- **公开兑换**：按类别 Tab、单码/批量兑换、结果 ZIP 导出
- **卡密管理**：创建、批量导入、启用/禁用/删除、批次
- **类别隔离**：独立编码前缀；无交易可删，有记录仅停用
- **API 密钥**：固定兑换密钥 + 自定义 Key（吊销/删除/轮换）
- **首次安装向导**：对齐 sub2api，Web 端创建管理员
- **运维**：健康检查、指标、可选在线更新（二进制模式）

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 · Vite · Tailwind 4 · TanStack Query |
| 后端 | Go · chi · pgx · Redis |
| 数据 | PostgreSQL 16 · Redis 7 |
| 部署 | Docker Compose 一键 |

## 一键部署（推荐）

### 前置

- Docker 20+ / Docker Compose v2
- Linux / macOS / Windows（Docker Desktop）

### 步骤

```bash
# 1. 克隆
git clone https://github.com/hkx1997/CardKey.git
cd CardKey

# 2. 生成 .env（随机库密码与密钥）并启动
bash deploy/docker-deploy.sh

# 或手动
cp .env.example .env
# 编辑 APP_PORT、POSTGRES_PASSWORD、JWT_SECRET、CONTENT_KEY 等
docker compose up -d --build
```

### 访问

- 兑换页：`http://服务器IP:APP_PORT/`（默认 **18080**）
- 管理端：`http://服务器IP:APP_PORT/admin`

### 首次安装

1. 打开管理端  
2. 若尚无管理员 → 自动进入 **`/admin/setup` 安装向导**  
3. 设置管理员用户名/密码、站点名、是否安装演示数据  
4. 完成后自动登录  

> 也可在 `.env` 设置 `BOOTSTRAP_ADMIN_PASS` 启动时自动建号（适合脚本，不推荐生产裸奔）。

### 可配置项（`.env`）

| 变量 | 默认 | 说明 |
|------|------|------|
| `APP_PORT` | 18080 | 应用对外端口 |
| `POSTGRES_PORT` | 5432 | PostgreSQL 宿主机端口 |
| `REDIS_PORT` | 6379 | Redis 宿主机端口 |
| `POSTGRES_USER` / `POSTGRES_DB` | cardkey | 数据库用户/库名 |
| `POSTGRES_PASSWORD` | — | **生产务必改强密码** |
| `JWT_SECRET` | — | ≥32 字符随机串 |
| `CONTENT_KEY` | — | 64 hex（`openssl rand -hex 32`），卡密加密 |
| `BOOTSTRAP_ADMIN_PASS` | 空 | 空=走安装向导 |

### 常用命令

```bash
docker compose ps
docker compose logs -f cardkey
docker compose down          # 停服务
docker compose down -v       # 停服务并清空数据卷（慎用）
```

### 生产建议

1. 修改全部默认密钥与数据库密码  
2. 前置 Nginx/Caddy HTTPS，并设 `SECURE_COOKIE=true`  
3. 定期 `pg_dump` 备份 `postgres` 卷  
4. 防火墙只暴露 `APP_PORT`（或仅 443）

## 演示数据

向导勾选「演示数据」后可用：

| 类别 | 示例编码 |
|------|----------|
| VIP | `VIP-DEMO-7K3M-9P2X-W4QH` |
| CDK | `CDK-DEMO-A2B3-C4D5-E6F7` |

## 开发

```bash
# 前端 Mock
cd frontend && pnpm install && pnpm dev

# 后端（需本机 PG + Redis）
cd backend && go run ./cmd/cardkey

# 测试
cd frontend && pnpm test
cd backend && go test ./...
```

## API 摘要

统一响应：

```json
{ "success": true, "data": {} }
```

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/public/config` | 公开配置 |
| GET | `/api/v1/public/setup-status` | 是否需安装向导 |
| POST | `/api/v1/public/setup` | 完成首次安装 |
| POST | `/api/v1/public/redeem` | 兑换 |
| POST | `/api/v1/admin/auth/login` | 登录 |
| GET | `/healthz` / `/readyz` | 健康检查 |
| GET | `/metrics` | Prometheus 文本指标 |

## 许可

[MIT](LICENSE)
