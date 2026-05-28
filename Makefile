'SHELL := /bin/bash
.DEFAULT_GOAL := help

# Seed defaults live in src/seed.ts. Override via env, e.g.
#   SEED_EXECUTIONS=50000 SEED_MIN_EVENTS=5000 SEED_MAX_EVENTS=20000 make seed

.PHONY: help setup install db-up db-down db-reset db-wait seed api web dev start clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "Targets:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

setup: install ## Install backend + frontend deps

install:
	npm install
	npm install --prefix web

db-up: ## Start Postgres in docker
	docker compose up -d postgres

db-wait:
	@echo "waiting for Postgres..."
	@for i in {1..30}; do \
	  if docker compose exec -T postgres pg_isready -U eventgraph -d eventgraph >/dev/null 2>&1; then \
	    echo "  Postgres is ready"; exit 0; \
	  fi; \
	  sleep 1; \
	done; \
	echo "  Postgres did not become ready in 30s"; exit 1

db-down: ## Stop Postgres
	docker compose down

db-reset: ## Wipe Postgres volume and recreate
	docker compose down -v
	docker compose up -d postgres

seed: db-up db-wait ## Truncate + seed (defaults in src/seed.ts; override SEED_* via env)
	npm run seed

api: ## Run the API in watch mode (port 3000)
	npm run dev

web: ## Run the Vite dev server (port 5173, proxies /api -> :3000)
	npm run dev --prefix web

dev: db-up db-wait ## Run API + Vite together
	npm run dev:all

start: setup db-up db-wait seed dev ## One-shot: install, db, seed, run

clean: ## Remove node_modules and build output
	rm -rf node_modules web/node_modules web/dist
