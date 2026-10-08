## Traxly

Traxly is a lightweight project planning workspace built with Next.js, TypeScript, Neon Postgres, Drizzle, Auth.js, and `shadcn/ui`. It supports hierarchical tasks, dependency-aware scheduling, Gantt-style visualization, and JSON/Markdown exports designed for LLM-assisted workflows.

## Commands

```bash
pnpm dev
pnpm lint
pnpm test
pnpm db:generate
pnpm db:migrate
```

## Environment

Create `.env.local` with the values from `.env.example`.

- `DATABASE_URL`: Neon pooled Postgres connection string
- `AUTH_SECRET`: random secret for Auth.js sessions
- `AUTH_GOOGLE_ID`: Google OAuth client id
- `AUTH_GOOGLE_SECRET`: Google OAuth client secret
- `ALLOWED_EMAIL`: the single Google account allowed to access the app

## Deployment

- Create a Neon Postgres project and apply migrations with `pnpm db:migrate`.
- Create a Google OAuth app with local and Vercel callback URLs that point to `/api/auth/callback/google`.
- Add the five required env vars in Vercel.
- Deploy to Vercel on the Node runtime.

## Current Architecture

- `src/domain`: planner types, validation schemas, date math, and scheduling logic
- `src/server`: Postgres/Drizzle schema, repositories, and project services
- `src/auth.ts`: Auth.js configuration and Google OAuth access control
- `src/features/planner`: project list and planner UI
- `src/components/ui`: `shadcn/ui`-style primitives used directly by the app

## Scope

- Private single-user web app
- Multiple saved projects
- Hierarchical tasks with summary rollups
- FS / SS / FF / SF dependencies with lag and lead
- Business-day scheduling
- Planned vs actual task dates
- Task table and Gantt views
- JSON and Markdown exports for LLM workflows

## Notes

- Runtime migrations are not executed automatically. Run `pnpm db:migrate` before starting a fresh environment.
- Local/system fonts are used so production builds work in restricted environments without remote font fetching.

## Forecast updates

Open **Project actions → Forecast settings** to select a deployment task or milestone and opt into automatic downstream scheduling. Enabling it previews the affected dates. Existing projects keep their current scheduling behavior until enabled.

Automatic scheduling moves unstarted dependent work earlier or later using current forecast durations, including when a predecessor finishes ahead of plan. It preserves baseline, actual execution, started tasks, and unrelated branches. Use **Keep forecast dates fixed** in a task menu for an intentional release window; conflicting dependencies produce a warning. Turning automation off retains the current dates. **Reflow downstream** remains a separate action that can restore baseline sizing.

Date arrows show business-day movement from the last schedule change in the current session; **Clear arrows** dismisses them. The planner shows the selected deployment forecast and its variance against that target's baseline. Shared reports use the project's target unless the share link explicitly selects another target.

Overdue unfinished work is flagged **Update expected finish**, even after its date is automatically rolled forward. Edit its forecast end or duration to provide a revised estimate; checkpoint progress alone does not predict remaining time. A deployment forecast whose prerequisite estimates need attention is marked **Forecast needs review**. Empty sections and unfinished tasks without a dependency path to the selected deployment target receive advisory warnings. Additional work belongs in rework sections with dependencies linking it to deployment.

Apply migration `0006_empty_major_mapleleaf.sql` with `pnpm db:migrate` before running this version against an existing hosted database.
