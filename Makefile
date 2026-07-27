.PHONY: up down logs build test frontend-test backend-test release

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

test: frontend-test backend-test

dev-frontend:
	cd frontend && pnpm install && pnpm dev

# 正式发版（仅 tag + Release 说明，无多平台包）：bash scripts/release.sh [version]
release:
	bash scripts/release.sh
