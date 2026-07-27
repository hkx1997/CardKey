.PHONY: up down logs build test frontend-test backend-test

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
