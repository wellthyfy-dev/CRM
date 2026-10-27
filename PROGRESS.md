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

## Step 1 — Core CRM + Titan drafts + pipeline

### What was built
- **Organisations**: list with search (name, city, domain, record id, contact email), filters (type, segment, state,
  city, stage, owner, verified, opt-out, due today/overdue), sortable columns, pagination, CSV export (formula-injection
  safe, UTF-8 BOM). Create/edit dialog with live duplicate check by domain; the API blocks duplicates by domain and
  contact email (409 with a link to the existing record). Auto `WF-000001…` record ids. Detail page tabs: Overview,
  Contacts, Research, Emails, Proposals (Step 3), Activity.
- **Contacts**: multiple per organisation, primary flag, "Mark verified" (requires http(s) source URL; records who/when),
  editing email or source URL resets verification, "Opt out" (permanent; suppresses the address; cancels unsent
  emails). Suppressed addresses stay opted out if re-added anywhere.
- **Import** (`/organisations/import`): .xlsx/.csv upload, 20-row preview, column mapping pre-filled for the 26 reference
  columns, "check interpretation" preview, commit with created/updated/skipped report and reasons. Rules in
  REFERENCE_NOTES.md §1 (SAMPLE- skipped, type/segment mapping, verified/opt-out/approval/outreach status/follow-up).
- **Research tab** (manual): evidence, training need, programme, duration/format, personalisation note, source URLs,
  history.
- **Templates & programmes**: CRUD (admin). Template editor with merge-field buttons, `{{#field}}` conditional sections,
  live preview against a chosen organisation + contact; every content edit creates a new version (history table);
  emails store `template_version`. Auto-selection by segment (ported from the .gs).
- **Drafting & approval**: "Create email" on verified contacts → rendered from the auto/overridden template → edit →
  save draft / submit. Researchers submit; only admins approve/reject (with reason)/bulk-approve (confirmation lists
  every email; each is checked individually). Approval pre-checks all non-timing gate rules and records
  `approved_by/approved_at`. Approvals page shows each email beside contact, source URL, research and ZeroBounce
  warnings. `checkSendGate` unit tests cover every rule (pass and fail).
- **Titan drafts** (worker `imap-draft` job): on approval, builds the RFC 5322 message with nodemailer MailComposer
  (From "TITAN_FROM_NAME <TITAN_USER>", Reply-To, generated Message-ID stored once, text + simple HTML), APPENDs to the
  special-use `\Drafts` mailbox (fallback "Drafts") with `\Draft`, stores `imap_draft_uid`, stage → drafted.
  dry_run logs instead. Settings → "Test Titan connection" (IMAP login + folder list, SMTP verify) returns pass/fail only.
- **ZeroBounce** job on contact create/edit (worker), re-check before approval if older than 90 days.
- **Pipeline board**: dnd-kit Kanban by stage, optimistic moves, "lost" asks for a reason; every move logged.
- **Activity timeline**: notes, calls, meetings (with date) plus all automatic events; manual next follow-up date;
  "Due today" / "Overdue" lists on the dashboard and as organisation filters.
- **Dashboard**: totals (organisations, verified contacts, approved, drafted, sent, replied, meetings, proposals,
  confirmed), stage funnel chart, colleges vs companies split, segment counts.
- **Users** (admin): invite via Supabase Auth admin API, change role, deactivate/reactivate; cannot remove your own or
  the last admin.

### How to test
- `npm run lint && npm run typecheck && npm test` — 109 unit/integration tests (API tests use Supertest + PGlite and
  import the real `reference/Wellthyfy_Outreach_CRM.xlsx`).
- `npm run test:e2e` — 8 Playwright tests: import flow (reference xlsx + CSV), approval by role, gate blocks
  (unverified contact, opted-out contact, do-not-contact organisation). Runs the real API on an in-memory database in
  dry_run mode; first run needs `npx playwright install chromium` in `apps/web`.
- Manually: sign in → Organisations → Import the reference xlsx (2 rows skipped) → New organisation → add contact with
  source URL → Mark verified → Create email → Submit → (admin) Approvals → Approve → worker log shows the dry-run draft.

### Decisions / defaults (Step 1)
- Org stage moves forward automatically: contact verified → `verified`; email approved → `approved`; Titan draft created
  → `drafted` (mirrors the reference "APPROVED FOR DRAFT → Draft Created" flow). Automatic moves never go backwards or
  leave lost/on_hold.
- Researchers may verify contacts, set do-not-contact and opt contacts out (all safety-positive); clearing
  do-not-contact is admin-only. Opt-out has no undo endpoint.
- Researchers edit only drafts; admins can also edit emails awaiting approval. Rejecting returns the email to draft.
- Imported "APPROVED FOR DRAFT" never approves an email (safety rule 1); sheet subject/body become a *draft* only for
  verified contacts. Imported `WF-######` ids are kept (sequence bumped); other ids are replaced and reported.
- Templates and programmes are admin-edited (they are business configuration); everyone can read them.
- Settings GET is readable by all roles (no secrets — integration status is booleans only); PATCH is admin-only.
- e2e login seeds a supabase-js session in localStorage with an HS256 token the API accepts via `SUPABASE_JWT_SECRET`
  (test-only secret); production uses the project's JWKS or real secret.
