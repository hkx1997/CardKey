.PHONY: up down logs build test frontend-test backend-test check release

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f

build:
	docker compose build

frontend-test:
	cd frontend && pnpm test

backend-test:
	cd backend && go test ./...

# 本地门禁：与 CI 接近
check: backend-test
	cd frontend && pnpm test && pnpm exec tsc --noEmit

test: frontend-test backend-test

dev-frontend:
	cd frontend && pnpm install && pnpm dev

# 正式发版：bash scripts/release.sh [version]（一体包，远程 ≥13MB）
release:
	bash scripts/release.sh

backup:
	bash scripts/backup.sh
