## Trax

Trax is a lightweight project planning workspace built with Next.js, TypeScript, SQLite, Drizzle, and `shadcn/ui`. It supports hierarchical tasks, dependency-aware scheduling, Gantt-style visualization, and JSON/Markdown exports designed for LLM-assisted workflows.

## Commands

```bash
pnpm dev
pnpm lint
pnpm test
pnpm db:generate
```

## Current Architecture

- `src/domain`: planner types, validation schemas, date math, and scheduling logic
- `src/server`: SQLite/Drizzle schema, repositories, and project services
- `src/features/planner`: project list and planner UI
- `src/components/ui`: `shadcn/ui`-style primitives used directly by the app

## Scope

- Single-user web app
- Multiple saved projects
- Hierarchical tasks with summary rollups
- FS / SS / FF / SF dependencies with lag and lead
- Business-day scheduling
- Planned vs actual task dates
- Task table and Gantt views
- JSON and Markdown exports for LLM workflows

## Notes

- Database files are created under `data/` and ignored by Git.
- Local/system fonts are used so production builds work in restricted environments without remote font fetching.
