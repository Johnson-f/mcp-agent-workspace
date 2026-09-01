# Repository Guidelines

## Project Structure & Module Organization

This repository is a pnpm workspace. Deployable services live in `apps/`: `website` is the Next.js UI, `api` is the Fastify backend, and `worker` runs Temporal jobs. Shared code belongs in `packages/`: `contracts` defines cross-service types, `db` owns Drizzle schemas and migrations, `mcp-gateway` integrates MCP servers, and `agent-runtime` contains agent and workflow logic. Tests sit beside source files as `*.test.ts` or `*.test.tsx`. Static web assets are in `apps/website/public`; local tooling is in `scripts/`; design notes and plans are in `docs/`.

## Build, Test, and Development Commands

Use Node 24+ and pnpm 11.19.0.

- `make setup` installs locked dependencies, starts PostgreSQL, Redis, and Temporal, then runs migrations.
- `make dev` starts the complete local stack.
- `pnpm run dev:website`, `dev:api`, or `dev:worker` runs one service.
- `make check` runs TypeScript checks across the workspace and Biome on the website.
- `make test` runs the main Vitest and Node test suites.
- `pnpm --dir apps/api test` runs the API registry test, which is not included in `make test`.
- `pnpm --dir apps/website build` creates a production web build.

## Coding Style & Naming Conventions

Write strict TypeScript and keep modules focused. Use kebab-case filenames (`conversation-stream-state.ts`), PascalCase for React components and exported types, and camelCase for functions and variables. The website uses Biome with two-space indentation and organized imports; run `pnpm --dir apps/website lint` and `format`. Elsewhere, follow the surrounding file's formatting and avoid explanatory comments unless they capture a non-obvious reason.

## Testing Guidelines

Use Vitest for packages and Node's built-in test runner where configured. Add tests beside the behavior they cover and name them `*.test.ts(x)`. Favor observable behavior over implementation details. There is no enforced coverage threshold; every bug fix or behavior change should include a focused regression test.

## Commit & Pull Request Guidelines

History uses Conventional Commits, for example `feat(platform): add unified automation and conversation system`. Use an imperative subject with a meaningful scope. Pull requests should explain the user-visible change, list verification commands, link related issues or plans, and include screenshots for UI changes. Keep generated Drizzle migrations with their schema change.

## Security & Configuration

Copy the provided `.env.example` files into the root `.env` setup as needed. Never commit API keys, auth secrets, or encryption keys. Review `docker-compose.yml` before changing local ports or service credentials.
