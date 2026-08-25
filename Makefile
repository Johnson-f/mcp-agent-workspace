SHELL := /bin/sh

PNPM ?= pnpm
APP_FILTERS := --filter @agents/api --filter @agents/worker --filter website

.DEFAULT_GOAL := help

.PHONY: help setup install dev infra-up infra-down infra-logs status db-migrate check test

help: ## Show the available commands.
	@printf '%s\n' \
		'Agents development commands' \
		'' \
		'  make setup       Install dependencies, start infrastructure, and migrate the database' \
		'  make dev         Start infrastructure, migrate, and run every local service' \
		'  make install     Install workspace dependencies from the lockfile' \
		'  make infra-up    Start PostgreSQL, Redis, and Temporal' \
		'  make infra-down  Stop the local infrastructure' \
		'  make infra-logs  Follow infrastructure logs' \
		'  make status      Show infrastructure container status' \
		'  make db-migrate  Apply pending database migrations' \
		'  make check       Run all type and lint checks' \
		'  make test        Run all unit tests'

setup: install infra-up db-migrate ## Prepare the local development environment.

install: ## Install workspace dependencies from the lockfile.
	$(PNPM) install --frozen-lockfile

dev: infra-up db-migrate ## Run the complete local application stack.
	@set -eu; \
		$(PNPM) run dev:mcp-smoke & smoke_pid=$$!; \
		trap 'kill "$$smoke_pid" 2>/dev/null || true' EXIT INT TERM; \
		$(PNPM) --parallel $(APP_FILTERS) run dev

infra-up: ## Start PostgreSQL, Redis, and Temporal.
	$(PNPM) run infra:up

infra-down: ## Stop the local infrastructure.
	$(PNPM) run infra:down

infra-logs: ## Follow infrastructure logs.
	$(PNPM) run infra:logs

status: ## Show infrastructure container status.
	docker compose ps

db-migrate: ## Apply pending database migrations.
	$(PNPM) run db:migrate

check: ## Run all type and lint checks.
	$(PNPM) run check

test: ## Run all unit tests.
	$(PNPM) run test:contracts
	$(PNPM) run test:db
	$(PNPM) run test:mcp-gateway
	$(PNPM) run test:agent-runtime
	$(PNPM) run test:website
