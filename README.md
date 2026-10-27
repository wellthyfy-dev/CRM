# Wellthyfy Outreach CRM

Internal web app for **Wellthyfy Lifestyle Ventures Pvt. Ltd.** to manage training outreach to colleges/universities
and companies (Tamil Nadu first, then all of India): discover → research → verify contact → personalised email →
**human approval** → send from Titan Mail → detect replies → follow up → meeting → proposal → training confirmed.

> Safety first: nothing is emailed to a prospect without an admin approval recorded in the database, every send passes
> `checkSendGate`, and `EMAIL_MODE=dry_run` (the default) never sends real email. See [CLAUDE.md](CLAUDE.md).

## Repository layout

| Path | What |
|---|---|
| `apps/web` | React 18 + Vite + TypeScript, React Router, TanStack Query, Tailwind + shadcn/ui |
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
npm run dev                 # web :5173, api :4000, worker
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
2. **Project Settings → API**: copy the Project URL → `SUPABASE_URL` and `VITE_SUPABASE_URL`; the `anon` key →
   `SUPABASE_ANON_KEY` and `VITE_SUPABASE_ANON_KEY`; the `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server only).
   If your project still uses the legacy JWT secret, you may set `SUPABASE_JWT_SECRET`; otherwise the API verifies
   tokens with the project's JWKS automatically.
3. **Project Settings → Database → Connection string**: use the **direct** connection or the **session pooler**
   (port 5432) for `DATABASE_URL`. Do not use the transaction pooler (6543) — pg-boss needs session features.
4. **Authentication → Providers → Email**: enable email + password; **disable "Allow new users to sign up"**
   (invite-only). Under **URL Configuration** set the Site URL to your web URL (e.g. `http://localhost:5173`).
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
