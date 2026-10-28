# Wellthyfy Outreach CRM

Internal web app for **Wellthyfy Lifestyle Ventures Pvt. Ltd.** to manage training outreach to colleges/universities
and companies (Tamil Nadu first, then all of India): discover → research → verify contact → personalised email →
**human approval** → send from Titan Mail → detect replies → follow up → meeting → proposal → training confirmed.

> Safety first: nothing is emailed to a prospect without an admin approval recorded in the database, every send passes
> `checkSendGate`, and `EMAIL_MODE=dry_run` (the default) never sends real email. See [CLAUDE.md](CLAUDE.md).

## Repository layout

| Path | What |
|---|---|
| `apps/web` | Next.js 16 (App Router) + React 19 + TypeScript, TanStack Query, Tailwind + shadcn/ui |
| `apps/api` | Express + TypeScript REST API (`/api/*`), Supabase JWT auth, Zod validation |
| `apps/worker` | pg-boss background worker (sending, IMAP drafts/replies, follow-ups, AI, digests, backups) |
| `packages/shared` | Shared constants, Zod schemas, template renderer, **send gate**, Drizzle schema + migrations |
| `reference/` | Original starter kit (xlsx + Apps Script) — see [REFERENCE_NOTES.md](REFERENCE_NOTES.md) |

## Local setup

Requirements: Node.js 22+ and npm 10+. (No local Postgres needed for tests — they use PGlite, an in-process Postgres.)

```bash
npm install
cp .env.example .env        # then fill in values (see below)
npm run db:migrate          # apply committed migrations to DATABASE_URL
npm run db:seed             # settings row, 6 templates, sample programmes, storage bucket
npm run create-admin -- you@wellthyfy.in 'a-long-password' "Your Name"
npm run dev                 # web :3000, api :4000, worker
```

Useful scripts (root):

| Script | Does |
|---|---|
| `npm run dev` | starts web + api + worker together |
| `npm run build` | builds all workspaces |
| `npm run lint` / `npm run typecheck` / `npm test` | ESLint, `tsc --noEmit`, Vitest (all workspaces) |
| `npm run test:e2e` | Playwright end-to-end tests (in-memory DB, dry run) |
| `npm run db:generate` | generate a new migration after editing `packages/shared/src/db/schema.ts` |

### Demo mode without Supabase Postgres

Set `DATABASE_URL=pglite://./.pglite/dev` to run the **api** against an in-process Postgres stored on disk (migrated and
seeded on boot). The worker needs real Postgres (pg-boss), so in this mode jobs are logged, not executed.

## Creating the Supabase project

1. Create a project at [supabase.com](https://supabase.com) (region: Mumbai `ap-south-1`).
2. **Project Settings → API**: copy the Project URL → `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL`; the `anon` key →
   `SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`; the `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server only).
   If your project still uses the legacy JWT secret, you may set `SUPABASE_JWT_SECRET`; otherwise the API verifies
   tokens with the project's JWKS automatically.
3. **Project Settings → Database → Connection string**: use the **direct** connection or the **session pooler**
   (port 5432) for `DATABASE_URL`. Do not use the transaction pooler (6543) — pg-boss needs session features.
4. **Authentication → Providers → Email**: enable email + password; **disable "Allow new users to sign up"**
   (invite-only). Under **URL Configuration** set the Site URL to your web URL (e.g. `http://localhost:3000`).
5. Run `npm run db:migrate` and `npm run db:seed`. The migration enables row-level security on every table with no
   policies, so the browser's anon key cannot read data directly — all data goes through the API.

## Migrations and seed

- Schema lives in `packages/shared/src/db/schema.ts`; SQL migrations are committed in `packages/shared/drizzle/`.
- After a schema change: `npm run db:generate`, review the SQL, commit it, then `npm run db:migrate`.
- `npm run db:seed` is idempotent: it creates the settings row (caps 30/day, 10/hour, window 10:00–17:00 IST,
  Mon–Sat, follow-ups at 7 and 14 days), the 4 templates from the reference workbook plus 2 follow-up templates, and
  5 "SAMPLE – edit me" programmes (only if none exist).

## First admin user

```bash
npm run create-admin -- ceo@wellthyfy.in 'choose-a-strong-password' "Selvaganapathy V."
```

This creates (or finds) the Supabase Auth user and gives them an `admin` profile. Further users are invited from
**Users** in the app (admin only); they receive a Supabase invite email and get the role you choose.

Roles: **admin** (everything incl. approve, send, settings, users) · **researcher** (organisations, contacts, research,
drafts — cannot approve or send) · **viewer** (read-only).

## EMAIL_MODE

| Value | Behaviour |
|---|---|
| `dry_run` (default) | SMTP is replaced by a logger; IMAP writes (drafts, Sent copies, draft deletes) are skipped and logged. Emails are marked sent with a `dryRun` flag in the activity log so the workflow can be tested end to end. |
| `live` | Real sends through Titan SMTP (`smtp.titan.email:465`) and IMAP (`imap.titan.email:993`). Only switch on in production after the first-day checklist. |

Development and tests never send real email. Titan credentials come only from `TITAN_USER` / `TITAN_PASSWORD`.

## Features at a glance

Organisations & contacts (search, filters, CSV, duplicate blocking, verification, permanent opt-out) · xlsx/csv import
of the reference workbook · manual and AI research (verbatim-only contacts) · versioned templates with live preview ·
drafting → submit → admin approval → Titan draft → queued send (caps, IST window, random gaps, gate re-check) ·
follow-ups drafted for approval · read-only reply detection with rule + AI classification · ZeroBounce · discovery via
Serper · proposal PDFs · pipeline board · dashboard and reports · staff digest/alerts via Resend · nightly backups ·
data-deletion requests. See [PROGRESS.md](PROGRESS.md) for details and [SECURITY_REVIEW.md](SECURITY_REVIEW.md).

## Deployment

Target: **web on Vercel**, **api + worker on Render** (Singapore region, closest to India), **DB/auth/storage on
Supabase** (Mumbai). Everything below uses `dry_run` until the first-day checklist is complete.

### 1. Supabase (production project)
1. Create a new project (region `ap-south-1` Mumbai); save the database password in a password manager.
2. **Auth → Providers → Email**: enable email + password, **turn off "Allow new users to sign up"**.
   **Auth → URL configuration**: Site URL = your Vercel URL (e.g. `https://crm.wellthyfy.in`); add it to Redirect URLs.
   Optionally configure custom SMTP for auth emails (invites) under Auth → Emails.
3. **Project Settings → API**: copy URL, anon key, service role key (and the JWT secret if your project shows a legacy
   one). Keep "Exposed schemas" as `public` only.
4. **Project Settings → Database**: copy the **session pooler** (port 5432) or direct connection string → `DATABASE_URL`.
5. From your machine with the production `.env`: `npm run db:migrate && npm run db:seed` (creates the private storage
   bucket `wellthyfy-crm`), then `npm run create-admin -- ceo@wellthyfy.in '<strong password>' "Selvaganapathy V."`.

### 2. Render (api + worker)
1. Push the repo to GitHub. In Render: **New → Blueprint**, select the repo; it reads [`render.yaml`](render.yaml)
   and creates `wellthyfy-crm-api` (Node web service) and `wellthyfy-crm-worker` (Docker background worker, includes
   `pg_dump` 17 for backups).
2. Fill the `wellthyfy-crm` environment group (all `sync: false` values): `DATABASE_URL`, `SUPABASE_*`,
   `TITAN_USER`, `TITAN_PASSWORD`, `RESEND_API_KEY`, `RESEND_FROM`, `ALERT_EMAIL_TO`, `AI_PROVIDER`, `GEMINI_API_KEY`,
   `SERPER_API_KEY`, `ZEROBOUNCE_API_KEY`, `SENTRY_DSN`, `APP_URL` (the Vercel URL — used for CORS),
   `API_URL`. Leave `EMAIL_MODE=dry_run` for now.
3. The API runs `npm run db:migrate` as its pre-deploy command and exposes `GET /health`. Keep the worker at **one**
   instance.

### 3. Vercel (web)
1. **New Project** → import the repo → **Root Directory: `apps/web`** (framework Next.js). [`apps/web/vercel.json`](apps/web/vercel.json)
   installs and builds from the monorepo root; security headers are set in `apps/web/next.config.ts`.
2. Environment variables (Production): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `NEXT_PUBLIC_API_URL` (the Render API URL), `NEXT_PUBLIC_SENTRY_DSN` (optional), and `SENTRY_AUTH_TOKEN`
   (optional; uploads browser source maps to the `wellthyfy-web` Sentry project during the build).
3. Add your domain (e.g. `crm.wellthyfy.in`) and set the same URL as `APP_URL` on Render and Site URL in Supabase.

### 4. Environment variables
Every variable is documented in [`.env.example`](.env.example). Server-only secrets (`SUPABASE_SERVICE_ROLE_KEY`,
`DATABASE_URL`, `TITAN_PASSWORD`, `RESEND_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `SERPER_API_KEY`, `ZEROBOUNCE_API_KEY`) go
only on Render — never on Vercel (only `NEXT_PUBLIC_*` values reach the browser).

### 5. Switching EMAIL_MODE to live
Only after the first-day checklist below passes in `dry_run`:
1. Settings → **Test Titan connection** shows IMAP pass and SMTP pass (and Drafts/Sent folders found).
2. Approve one email to an internal test address; confirm the draft appears in Titan webmail → Drafts.
3. On Render set `EMAIL_MODE=live` in the env group (both services restart). Settings shows "LIVE email".
4. Start with Settings → daily cap 5 and hourly cap 2 for the first week, then raise gradually (Titan limits apply).

### 6. First-day checklist
- [ ] `https://<api>/health` returns `ok`; worker logs show `worker started` and `heartbeat` every minute.
- [ ] Admin can sign in; invite a researcher and a viewer; check each sees the right menu.
- [ ] Settings: signature, opt-out line, privacy notice URL, send window/days, caps, AI model and monthly limits.
- [ ] Replace the 5 "SAMPLE – edit me" programmes with real ones; review the 6 templates.
- [ ] Import the reference workbook (SAMPLE rows are skipped) or add 10–20 real organisations with verified contacts.
- [ ] Titan connection test passes; SPF/DKIM/DMARC verified for `wellthyfy.in` (see PROGRESS.md "manual setup").
- [ ] One live email to an internal address: arrives, is in Titan Sent, draft removed, reply detected within 5 minutes,
      replying "STOP" opts the contact out.
- [ ] Next morning: digest arrives at `ALERT_EMAIL_TO`; a backup file exists in Storage → `wellthyfy-crm/backups/`.
