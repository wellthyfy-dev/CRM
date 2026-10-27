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

## Step 2 — Sending, follow-ups, replies, verification, AI, alerts

### What was built
- **Sending (Titan SMTP)**: admin "Send" (per email, or "Queue all approved") runs the gate at queue stage and sets
  `queued`. Worker `send-tick` (every minute + kicked after each send) sends **one email at a time** inside the IST send
  window/days and under hourly/daily caps, with a random 60–180 s gap. `checkSendGate` is re-run immediately before
  SMTP; timing-only failures wait, any other failure marks the email `failed` with `gate_failure_reason`. The same
  stored Message-ID is used; on success: `sent_at`, APPEND copy to special-use `\Sent` with `\Seen`, delete the Titan
  draft by UID, stage → sent (proposal emails → proposal_sent), activity. Errors: rate-limit/network → exponential
  backoff retry (max 5 attempts) + queue paused 1 hour; rejected recipient → failed + contact `invalid`; auth → queue
  paused + staff alert. **Queue page**: queued list, sent today/this hour, remaining capacity, next window, pause/resume,
  remove from queue.
- **Follow-ups**: daily 08:00 IST job drafts follow-up 1 after `follow_up_1_days` and follow-up 2 after
  `follow_up_2_days` (only after FU1 was sent) for sent first contacts with no reply/opt-out; status
  `pending_approval` (never auto-sent); threaded (`In-Reply-To`/`References`, "Re: …"). Max 2. Any reply cancels
  pending follow-ups.
- **Reply tracking**: every 5 minutes, read-only INBOX fetch from `imap_last_uid` (UIDVALIDITY-aware; never deletes,
  moves or flags). Match by In-Reply-To/References → stored Message-ID, then sender → contact email; bounces matched by
  Message-IDs quoted in the DSN. Unrelated mail is ignored (not stored). Rules first: bounce → `bounced` + contact
  invalid; STOP/unsubscribe/remove me/not interested → permanent opt-out + suppression; out-of-office → follow-ups
  shifted by 7 days (not treated as a reply). Otherwise AI classifies interested / not_interested / other with a
  one-line summary. "Interested" triggers an instant staff alert. **Replies page** with filters, reclassify and
  "mark handled".
- **ZeroBounce**: async on contact create/edit; re-checked before approval if older than 90 days; `invalid` blocks the
  gate; catch-all / risky / unchecked shown as warnings on approval screens. Role-based "do_not_mail" (e.g. placement@)
  maps to risky, not invalid.
- **AI research** (`@anthropic-ai/sdk`, `messages.parse` + Zod structured output): fetches the home page + up to 6
  relevant same-domain pages (about, placement, training, departments, contact, leadership, careers…), strips to text,
  caps ~80k chars (~20k tokens). Prompt includes the Wellthyfy profile, segment playbook and active programmes.
  Server drops any candidate contact whose name or email is not verbatim on its cited page (and any evidence quote
  from an unfetched URL). Saved with model, tokens and `cost_inr` (₹88/$; Haiku 5.5 $0.10/$0.50, Sonnet 5.5 $2/$10 per
  MTok). Candidates show as "Suggested – not verified" with one-click add (`verified=false`, `ai_suggested=true`).
  "Use AI draft" in the compose dialog. Monthly AI limit enforced across research and reply classification
  (`ai_usage` table).
- **Resend (staff only)**: 09:00 IST digest to `ALERT_EMAIL_TO` (follow-ups due/overdue, approvals waiting, replies
  needing attention, yesterday's sends) and instant "interested" alerts. Recipients are always `ALERT_EMAIL_TO`.

### How to test
- `npm test` — 151 tests, including: scheduler window/days/caps (cap = 2), one-at-a-time + gap, gate re-check before
  SMTP (opt-out after queueing, missing approval), error classification paths, follow-up timing/threading/limit,
  reply matching (In-Reply-To, sender, DSN), STOP → opt-out, bounce, out-of-office shift, AI verbatim filter, AI cost
  and monthly limit, crawler helpers.
- `npm run test:e2e` — 8 Playwright tests still pass.
- Manual (dry_run): approve an email → Send → watch the worker log "[dry_run] SMTP send replaced by logger" → email
  shows sent with a "dry run" activity.

### Decisions / defaults (Step 2)
- A gate failure at send time other than timing marks the email `failed` (an admin can review and re-approve).
- Follow-up 2 is created only if follow-up 1 was actually sent; follow-up timing counts from the original send date.
- Out-of-office replies are stored for visibility but do not count as replies (no stage change, no cancellation).
- AI uses effort `medium` for research and `low` for classification; refusals and schema failures are logged as
  `ai_research_failed` and fall back to "other" for classification.
- The worker must run as a single instance (one-at-a-time sending relies on it).
