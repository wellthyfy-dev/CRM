# Wellthyfy Outreach CRM — Project Instructions

## PROJECT CONTEXT

An internal web app for Wellthyfy Lifestyle Ventures Pvt. Ltd. to manage training outreach to:
- Colleges/universities: Arts & Science, Engineering, MBA/Commerce, other
- Companies: FMCG, OTC, Pharma, Startups/B2B, other

Region: Tamil Nadu first, then all of India. Both colleges and companies are targeted.

Workflow: discover organisation → research official website → identify decision-maker → verify contact → generate personalised email → human approval → send from Titan Mail → detect replies → follow up → meeting → proposal → training confirmed.

Sender identity (signature and templates):
Selvaganapathy V. | MBA – Marketing | Corporate Trainer & Sales Mentor
CEO, Wellthyfy Lifestyle Ventures Pvt. Ltd.
97519 45999 | ceo@wellthyfy.in | https://wellthyfy.in
Tagline: "22 Years in Industry. Now Bringing Industry Experience to the Classroom."

Segment playbook (decision-makers → pitch):
- Arts & Science colleges → Principal, Dean, Placement Officer, Training & Placement Head → employability, communication, campus-to-corporate, business skills
- MBA colleges → Director, MBA Head, Placement Head → sales, marketing, negotiation, leadership, interview readiness
- FMCG/OTC companies → HR, L&D, Sales Training Head, Sales Director → frontline sales effectiveness, distribution, territory management
- Pharma companies → L&D, Sales Training, Regional/Zonal Sales leadership → field-force effectiveness, coaching, customer engagement
- Startups → Founder, HR, Business Head → sales fundamentals, business development, customer acquisition

## TECH STACK (do not change without asking)

- Monorepo with npm workspaces:
  - apps/web — Next.js 16 (App Router, client components) + React 19 + TypeScript, TanStack Query, Tailwind CSS + shadcn/ui, dnd-kit (pipeline board), Recharts (dashboard)
  - apps/api — Node.js 22 LTS + Express + TypeScript, Zod validation
  - apps/worker — Node.js 22 + TypeScript background worker
  - packages/shared — shared types, Zod schemas, constants, template renderer, send gate
- Database: Supabase PostgreSQL via Drizzle ORM (DATABASE_URL). Migrations with drizzle-kit, committed.
- Auth: Supabase Auth (email + password, invite-only). Web logs in with supabase-js; API verifies the Supabase JWT on every request and loads the role from `profiles`.
- Job queue: pg-boss on the same Postgres (no Redis).
- Outreach email: Titan Mail ONLY
  - SMTP: nodemailer, smtp.titan.email, port 465, secure true
  - IMAP: imapflow, imap.titan.email, port 993, secure true
  - Credentials only from env (TITAN_USER, TITAN_PASSWORD); never stored in DB, never logged, never sent to the frontend.
- Internal staff notifications only (digest, reply alerts): Resend. NEVER email prospects via Resend (its policy forbids cold outreach).
- AI: provider chosen by AI_PROVIDER. Currently `gemini` (@google/genai, GEMINI_API_KEY): default `gemini-3.5-flash-lite`, optional `gemini-3.8-flash` selectable in Settings. `anthropic` (@anthropic-ai/sdk, `claude-haiku-5-5` / `claude-sonnet-5-5`) remains supported. Model names from env/settings, not hard-coded.
- Lead search: Serper API. Email verification: ZeroBounce API.
- PDF proposals: @react-pdf/renderer, files in Supabase Storage.
- Testing: Vitest, Supertest, Playwright. Lint/format: ESLint + Prettier. CI: GitHub Actions (lint, typecheck, test).
- Hosting target: web on Vercel; api + worker on Render; DB/auth/storage on Supabase.

## NON-NEGOTIABLE SAFETY RULES

1. Nothing is emailed to a prospect without a human approval recorded in the DB (approved_by, approved_at). No auto-send of any prospect email, including follow-ups.
2. One send-gate function `checkSendGate(emailId)` in packages/shared (used by the API) and re-run inside the worker immediately before SMTP. It passes only if ALL hold:
   - contact.verified = true AND contact.source_url starts with http:// or https://
   - contact.email is valid syntax and not an example/sample domain
   - contact.opt_out = false AND organisation.do_not_contact = false
   - contact.email_check_status is not 'invalid'
   - email.status = 'approved'
   - no other email sent to this contact in the last 7 days (except an approved follow-up in the same thread)
   - follow_up_no <= 2
   - sends this hour < hourly_send_cap AND sends today < daily_send_cap
   - now is inside send window and send days (Asia/Kolkata)
   - organisation.record_id does not start with 'SAMPLE-'
   On failure: do not send; store gate_failure_reason on the email.
3. AI never invents names, designations or email addresses. It may only extract contacts that literally appear in fetched page text, with the exact source URL. Server-side code re-checks this. AI-found contacts start verified = false.
4. Opt-outs are permanent. Every outreach email ends with the Settings opt-out line.
5. Dev and tests never send real email. EMAIL_MODE = dry_run | live (default dry_run). In dry_run, SMTP is replaced by a logger and IMAP writes are skipped and logged.
6. Secrets only in .env (git-ignored). Keep .env.example complete and documented.
7. The app only reads INBOX; it never deletes or moves prospects' messages.

## CODING CONVENTIONS

- TypeScript strict. No `any` without a justifying comment.
- All request bodies validated with Zod schemas from packages/shared.
- Roles on every API route: admin (everything incl. approve, send, settings, users), researcher (create/edit organisations, contacts, research, drafts; cannot approve or send), viewer (read-only).
- Every state change writes to `activities` (audit log).
- Store UTC; display Asia/Kolkata.
- Small commits with clear messages; README kept current.
- Ask the user if a business rule is genuinely unclear; otherwise choose a sensible default and note it in PROGRESS.md.
