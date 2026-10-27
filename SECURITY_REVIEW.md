# Security review — NON-NEGOTIABLE SAFETY RULES

Reviewed at Step 4 against CLAUDE.md. Each rule lists where it is enforced and how it is tested; gaps found in this
review are listed at the end with their fixes.

## Rule 1 — No prospect email without a recorded human approval
- Only admins can approve (`requireRole` → `adminOnly` on `/emails/:id/approve`, `/emails/bulk-approve`;
  `apps/api/src/routes/emails.ts`). Approval writes `approved_by` + `approved_at`.
- The gate requires `approved_by`/`approved_at` at both stages (`approval_not_recorded`) and status `approved`
  (queue) / `queued` (send) — `packages/shared/src/gate/evaluate.ts`.
- Follow-ups are created as `pending_approval` with no approver (`apps/worker/src/jobs/follow-ups.ts`); proposal emails
  are created as `draft`. Imports never approve ("APPROVED FOR DRAFT" only moves the stage).
- Approved emails can't be edited; rejecting clears the approval.
- Tests: `gate.test.ts` (approval cases), `crm.test.ts` (roles), `send.test.ts` ("never sends without approval"),
  `replies-followups.test.ts` (follow-ups pending approval), e2e `approval.spec.ts`.

## Rule 2 — One send gate, re-run before SMTP
- `checkSendGate(db, emailId, { stage })` in `packages/shared/src/server/gate.ts` wraps the pure
  `evaluateSendGate` with every listed rule (plus the permanent suppression list). Used by the API when approving
  (pre-check) and queueing, and by the worker immediately before `mail.send` (`apps/worker/src/jobs/send.ts`).
  Failures store `gate_failure_reason`.
- Tests: every rule pass/fail in `gate.test.ts`; DB-backed in `db-gate.test.ts`; worker re-check in `send.test.ts`.

## Rule 3 — AI never invents contacts
- Prompt forbids it; output is Zod-validated; `filterVerbatimContacts` drops any candidate whose name or email is not
  verbatim in the fetched text of the exact cited URL, and evidence from unfetched URLs is dropped
  (`apps/worker/src/jobs/ai-research.ts`). Only the filtered list is stored; "add" creates `verified=false`,
  `ai_suggested=true` contacts. Tests: `replies-ai.test.ts`, `ai-research.test.ts`, `sending.test.ts`.

## Rule 4 — Opt-outs permanent; every email ends with the opt-out line
- No API path clears `opt_out` (schemas have no such field; import never clears it). Opt-outs add a SHA-256 entry to
  `suppressions`, checked on contact create/edit and by the gate, and survive contact anonymisation.
- `ensureOptOutLine` on render, edit, follow-up, proposal and import drafts — and again in the worker right before
  SMTP. Tests: `crm.test.ts`, `render.test.ts`, `send.test.ts`, `data-protection.test.ts`.

## Rule 5 — Dev and tests never send real email
- `EMAIL_MODE` defaults to `dry_run`; only the exact value `live` selects the live transport
  (`packages/shared/src/server/titan.ts`). Tests and e2e use fakes / dry_run and an in-process database; CI sets
  `EMAIL_MODE=dry_run`.

## Rule 6 — Secrets only in env
- `.env` is git-ignored; `.env.example` documents every variable; Titan credentials are read only from env and never
  stored, logged or returned (Titan test returns pass/fail only; settings API returns booleans). pino redaction is a
  second line of defence. `pg_dump` receives credentials via `PG*` env vars, not argv.

## Rule 7 — INBOX is read-only
- INBOX is opened with `readOnly: true` (EXAMINE) and only fetched; all IMAP writes go through `assertNotInbox`
  (Drafts/Sent only; deleting our own draft after sending). Unrelated INBOX mail is not stored.

## Gaps found in this review and fixed
| Gap | Risk | Fix |
|---|---|---|
| Two worker instances (or an overlapping tick) could send concurrently | caps exceeded / double send | Atomic 10-minute lease on the settings row before each send (`send.ts`), test "only one tick can hold the lease" |
| Opt-out line only guaranteed at draft/edit time | an email edited outside the API or after an opt-out-line change could go out without it | Re-applied in the worker before SMTP, test "re-appends the opt-out line" |
| Crawler fetched any researcher-entered URL from the server | SSRF to internal services / cloud metadata | `assertPublicUrl` (http/https, ports 80/443, no credentials, public IPs only) checked on every redirect hop (`url-guard.ts`), tests in `url-guard.test.ts` |
| No security headers / rate limiting on the API | clickjacking/MIME sniffing, brute force | `securityHeaders` + per-IP limiter (`apps/api/src/lib/hardening.ts`) |
| No way to honour a data-deletion request | DPDP Act compliance | Admin "Delete contact data" (anonymise, redact emails/replies, scrub logs, keep hashed opt-out) |
| `pg_dump` connection string would be visible in the process list | credential exposure | credentials passed via env |

## Residual risks / operational requirements
- **Supabase sign-ups must be disabled** (Auth → Providers → Email → "Allow new users to sign up" off). The API also
  refuses users without a `profiles` row, so a stray sign-up has no access.
- The in-memory rate limiter is per API instance; run a single API instance or put Render/Cloudflare rate limiting in
  front if you scale out.
- The worker must run as **one** instance (the lease makes a second one safe, but pointless).
- RLS is enabled on every `public` table with no policies; the `pgboss` and `drizzle` schemas are not exposed through
  PostgREST by default — keep them out of "Exposed schemas" in Supabase API settings.
- `npm audit` advisories are limited to dev tooling (vitest's tinypool, drizzle-kit's esbuild); none ship in the
  production bundles.
