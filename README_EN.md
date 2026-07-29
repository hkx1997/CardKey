# CardKey

**Language:** [中文](README.md) · [English](README_EN.md)

Self-hosted high-concurrency card-key (gift code) redeem platform: public redeem page + admin console + HTTP API.

[![Go](https://img.shields.io/badge/Go-1.22+-00ADD8)](https://go.dev/)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)](https://www.postgresql.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Live demo:** [cardkey.ai-service.top](https://cardkey.ai-service.top/) · [API docs](https://cardkey.ai-service.top/docs) · [Admin](https://cardkey.ai-service.top/admin)

## Screenshots

### Public redeem

| Single code | Batch |
|:---:|:---:|
| ![Redeem](docs/screenshots/redeem.png) | ![Batch redeem](docs/screenshots/redeem-batch.png) |

Category tabs, one-click redeem, multi-code batch mode with export.

### Public API docs

| Overview (Base URL) | Endpoint table |
|:---:|:---:|
| ![API docs](docs/screenshots/api-docs.png) | ![Endpoints](docs/screenshots/api-docs-endpoints.png) |

Public `/docs`: endpoint list + multi-language samples. Base URL is the site origin; paths already include the `/api/v1` prefix. Admin has a full **Admin API** docs page.

### Admin

![Admin login](docs/screenshots/admin-login.png)

After setup, open `/admin` for categories, cards, batches, API keys, settings, audit, and online updates.

## Features

- **Public redeem**: category tabs, single/batch redeem, ZIP export
- **Card inventory**: create, bulk import, enable/disable/delete, batches
- **Category isolation**: unique code prefix; delete only when no redeems, otherwise disable
- **API keys**: system redeem key + custom keys (revoke/delete/rotate)
- **API docs**: public `/docs` + admin **API Docs** page; configurable Base URL shown dynamically
- **Branding**: Logo / Favicon upload
- **Setup wizard**: first-run admin account and site name
- **Ops**: health checks, protected metrics, **online updates** (Docker check + optional GitHub token)
- **Security**: production secret denylist, strict CSRF, setup advisory lock, no public redeem key by default, no SVG uploads

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19 · Vite · Tailwind 4 · TanStack Query |
| Backend | Go · chi · pgx · Redis |
| Data | PostgreSQL 16 · Redis 7 |
| Deploy | Docker Compose |

## One-click deploy

### Requirements

- Docker 20+ / Compose v2
- Linux / macOS / Windows (Docker Desktop)
- `git`, `bash` (Git Bash on Windows)

### A) Clone + interactive install (recommended)

```bash
git clone https://github.com/hkx1997/CardKey.git
cd CardKey
bash deploy/docker-deploy.sh
```

The installer **prompts for ports / DB password** and **checks port conflicts**.

```bash
# Non-interactive
APP_PORT=19000 bash deploy/docker-deploy.sh --yes

# Reconfigure .env
bash deploy/docker-deploy.sh --reconfig
```

### B) Online one-liner (Linux/macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/hkx1997/CardKey/main/deploy/install-online.sh | bash
```

Installs to `~/cardkey` by default. Piped installs are non-interactive (auto free ports on conflict).

### C) Manual

```bash
cp .env.example .env
docker compose up -d --build
```

### Access

- Redeem: `http://SERVER:APP_PORT/` (default **18080**)
- Admin: `http://SERVER:APP_PORT/admin`

### First-time setup

1. Open admin  
2. If no admin exists → **Setup wizard** at `/admin/setup`  
3. Set admin user/password and site name  
4. Auto login after finish  

Or set `BOOTSTRAP_ADMIN_PASS` in `.env` to create admin on boot (scripts only).

### Key env vars

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_PORT` | 18080 | App port |
| `POSTGRES_PORT` | 5432 | Postgres host port |
| `REDIS_PORT` | 6379 | Redis host port |
| `POSTGRES_PASSWORD` | — | **Use a strong password in production** |
| `JWT_SECRET` | — | Random ≥32 chars |
| `CONTENT_KEY` | — | 64 hex (`openssl rand -hex 32`) |
| `BOOTSTRAP_ADMIN_PASS` | empty | Empty = web setup wizard |

### Commands

```bash
docker compose ps
docker compose logs -f cardkey
docker compose down
docker compose down -v   # wipe data — careful
```

### Production tips

1. Rotate all secrets and DB password  
2. Put HTTPS reverse proxy in front; set `SECURE_COOKIE=true`  
3. Backup Postgres volume regularly  
4. Expose only `APP_PORT` or 443  

## Development

```bash
cd frontend && pnpm install && pnpm dev
cd backend && go run ./cmd/cardkey
cd frontend && pnpm test
cd backend && go test ./...
```

## API snapshot

```json
{ "success": true, "data": {} }
```

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/public/config` | Public config |
| GET | `/api/v1/public/setup-status` | Setup needed? |
| POST | `/api/v1/public/setup` | Complete setup |
| POST | `/api/v1/public/redeem` | Redeem |
| POST | `/api/v1/admin/auth/login` | Login |
| POST | `/api/v1/admin/uploads` | Image upload (auth) |
| GET | `/healthz` / `/readyz` | Health |
| GET | `/metrics` | Prometheus text metrics |

Configure **API public Base URL** in Admin → Settings → API (`apiPublicBaseUrl`). Docs use it for code samples.

## License

[MIT](LICENSE)
