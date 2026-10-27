# Progress

## Step 0 — Project setup

### What was built
- **Monorepo** (npm workspaces): `apps/web`, `apps/api`, `apps/worker`, `packages/shared`; TypeScript strict
  (`noUncheckedIndexedAccess`), ESLint (flat config, typescript-eslint, react-hooks), Prettier, Vitest projects.
  Root scripts: `dev` (web + api + worker via concurrently), `build`, `lint`, `typecheck`, `test`, `test:e2e`,
  `db:generate`, `db:migrate`, `db:seed`, `create-admin`.
- **`.env.example`** documenting every variable (the requested list plus `SUPABASE_JWT_SECRET`,
  `SUPABASE_STORAGE_BUCKET`, `RESEND_FROM`, `AI_MODEL_OPTIONAL`, `USD_TO_INR`, `PORT`, `LOG_LEVEL`, `VITE_*`).
- **Database** (Drizzle, `packages/shared/src/db/schema.ts`, migrations in `packages/shared/drizzle/`): all requested
  tables with UUID PKs, `created_at`/`updated_at`, indexes and enums. `record_id` defaults to `WF-000001…` from a
  sequence. Migration `0001_enable_rls` turns on row-level security (no policies) on every table so the browser's
  Supabase anon key can't read data through PostgREST.
- **Seed** (idempotent): settings row, the 4 reference templates converted to merge fields + 2 follow-up templates
  (with version history rows), 5 "SAMPLE – edit me" programmes, default opt-out line.
- **Send gate**: pure `evaluateSendGate()` with every rule from CLAUDE.md, and DB-backed
  `checkSendGate(db, emailId, { stage })` in `@wellthyfy/shared/server` that stores `gate_failure_reason`.
- **API skeleton**: `/health`, Supabase JWT middleware (HS256 secret or JWKS), profile/role loading, role guards,
  Zod/HttpError/unique-violation error handler, request logging without bodies/headers (pino with redaction),
  CORS restricted to `APP_URL`, `/api/me`, `create-admin` script.
- **Web skeleton**: Supabase email/password login, auth context (`/api/me`), protected routes, role-aware sidebar
  (Dashboard … Users), shadcn-style UI primitives, Sentry boundary, Vercel SPA config.
- **Worker skeleton**: pg-boss start, queue creation, job registry with IST cron schedules, heartbeat job, optional
  `/health` endpoint (`WORKER_HEALTH_PORT`), graceful shutdown waiting for active jobs.
- **CI**: GitHub Actions — format check, lint, typecheck, tests, build; Playwright job.
- **Docs**: README (local setup, Supabase project, migrations, seed, first admin, EMAIL_MODE), CLAUDE.md,
  REFERENCE_NOTES.md.

### How to test
- `npm install && npm run lint && npm run typecheck && npm test && npm run build` — all pass (73 tests).
- Tests use **PGlite** (in-process Postgres) with the real migrations, so no database server is needed.
- With a Supabase project: fill `.env`, `npm run db:migrate && npm run db:seed`, `npm run create-admin -- …`,
  `npm run dev`, sign in at http://localhost:5173.

### Decisions / defaults (Step 0)
- **Gate stages.** The gate requires `status = 'approved'` when an admin queues an email and `status = 'queued'`
  (reachable only from approved) when the worker re-runs it before SMTP; both require `approved_by`/`approved_at`.
  At queue time, timing rules (caps, window, days) are reported but don't block queueing — the worker waits for
  the window instead of failing the email. All other rules block at both stages.
- **Extra schema** beyond the spec (all additive): `suppressions` (SHA-256 of opted-out addresses so opt-outs
  survive data deletion — also checked by the gate), `template_versions` (immutable history), `ai_usage` (monthly
  AI limit), `emails.thread_id/attachments/send_attempts/follow_up_offset_days/rejection_reason/submitted_*`,
  `email_kind` adds `proposal`, settings queue-pause fields, `imap_uid_validity`, `privacy_notice_url`,
  `discovery_runs.status/results/error`.
- **Example/sample domains** blocked by the gate: any label `example|sample|test|dummy|placeholder`, or TLD
  `example|test|invalid|localhost|local` (covers the reference `example.edu`/`example.com`).
- **Toolchain pins**: TypeScript 5.9 (typescript-eslint compatible), Vite 7, Vitest 3, ESLint 9, pg-boss 10, Zod 4,
  Express 5. `npm audit` reports advisories only in dev tooling (vitest's tinypool, drizzle-kit's bundled esbuild);
  none ship in production bundles.
