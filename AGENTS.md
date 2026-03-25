<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes. APIs, conventions, and file structure may differ from model priors. Read the relevant guide in `node_modules/next/dist/docs/` before writing code, especially for route handlers, proxy, metadata, and app-router behavior. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Traxly Overview

Traxly is a personal project planning tool intended to replace tools like MS Project or ClickUp for a single-user planning workflow. It is not a generic multi-tenant PM platform. The product is optimized for:

- building reusable template projects
- duplicating a template into a live project
- planning with dependencies and business-day scheduling
- comparing original plan vs current forecast vs actual execution

The user is actively shaping the product around a practical delivery workflow, not around enterprise PM completeness.

# Current Product Model

The scheduling model has three layers:

- `Forecast`: the live editable working schedule
- `Baseline`: a frozen snapshot of the forecast when the plan is approved
- `Actual`: what really happened, based on actual dates and percent complete

Important behavior:

- `plannedStart`, `plannedEnd`, and `plannedDurationDays` are the persisted forecast fields
- `baselinePlannedStart`, `baselinePlannedEnd`, and `baselinePlannedDurationDays` are the frozen baseline fields
- `actualStart`, `actualEnd`, and `percentComplete` are the actual execution fields
- status is derived, not user-authored

Derived task status rules:

- `done` if `actualEnd` exists or `percentComplete >= 100`
- `in_progress` if `actualStart` exists or `percentComplete > 0`
- `not_started` otherwise

There is no user-editable `blocked` task status anymore. Dependency or data issues can still surface as planner issues, but not as a first-class task status.

# Forecast Editing Rules

Forecast edits are cascading:

- editing a task’s forecast start, due date, duration, or schedule mode should persist that task’s new forecast
- dependent downstream forecast tasks should then be recalculated and persisted
- upstream tasks do not move
- unrelated branches do not move
- baseline does not change from forecast edits
- actuals do not change from forecast edits

Project-wide date shifting is handled separately via `Rebase schedule`:

- rebase shifts the entire forecast by one business-day offset from the earliest planned leaf task
- baseline remains unchanged
- actuals remain unchanged

Template duplication can also accept a new start date:

- duplicate with `startDate` rebases the copied forecast
- duplicated projects reset actuals and baseline

Baseline behavior:

- `Freeze baseline` copies the current forecast into baseline fields
- re-freezing intentionally replaces the previous baseline

# Scheduling And Dependency Conventions

- scheduling uses business days only
- weekends are clamped/shifted by the date utilities
- dependencies are between leaf tasks only
- summary tasks roll up dates, effort, progress, and derived status from their children
- sections/summaries should not carry their own planned dates

Do not assume every project is fully dependency-connected. That is why explicit rebase exists in addition to normal task-level forecast propagation.

# Stack And Runtime

- Next.js 16 App Router
- React 19
- TypeScript
- Auth.js with Google OAuth and single allowed-email access
- Drizzle ORM
- Neon Postgres in hosted environments
- PGlite for tests
- Tailwind-based UI with local component wrappers

Operational notes:

- route handlers live under `src/app/api/...`
- auth/protection is handled through Auth.js plus `src/proxy.ts`
- server runtime should stay on Node for DB/auth simplicity unless there is a strong reason to change it

# Key Files And Responsibilities

- `src/domain/planner.ts`
  Core domain types and schemas
- `src/domain/scheduler.ts`
  Derived planning computation and summary rollups
- `src/server/services/project-service.ts`
  Main mutation/read service layer
- `src/server/services/forecast-schedule.ts`
  Forecast cascade and rebase behavior
- `src/features/planner/components/planner-client.tsx`
  Main planner UI
- `src/features/planner/components/task-dialog.tsx`
  Task editing UI
- `src/features/planner/components/project-list.tsx`
  Projects page, duplicate flow, and project list actions

# UX/Product Preferences

Prefer pragmatic PM behavior over abstract configurability.

Current product direction:

- templates are important
- reuse and schedule shaping are core workflows
- percent complete matters more than manual status fields
- baseline/forecast/actual comparison should stay understandable, not enterprise-heavy
- UI should feel intentionally minimal and personal, not overloaded with PM jargon

When making product decisions, favor:

- fewer editable concepts
- clearer schedule behavior
- visible schedule consequences of changes
- preserving baseline integrity once frozen

# Agent Guidance

Before changing scheduling behavior:

- inspect both the service layer and scheduler
- confirm whether a change should affect forecast only, or baseline/actual too
- avoid introducing competing schedule concepts unless explicitly requested

Before changing UI:

- preserve the simplified planner chrome and sidebar structure
- keep project actions obvious and minimal
- avoid reintroducing clutter the user has already removed

Before changing DB-backed behavior:

- update Drizzle schema
- generate a migration
- keep PGlite tests passing

Verification expectations for non-trivial changes:

- `pnpm test`
- `pnpm lint`
- `pnpm build`

# Current Known Project Reality

The repo may contain user-authored visual and branding tweaks that are not directly related to the task at hand. Do not revert unrelated UI changes.

There is a live template project used by the user (`RPA Template`) in the hosted database, but code should not special-case that project by ID or by task names unless explicitly requested. Keep template logic generic.
