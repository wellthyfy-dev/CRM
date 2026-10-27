# Reference notes — Wellthyfy Outreach starter kit

Source files (copied from the starter kit into `reference/`):
- `reference/Wellthyfy_Outreach_CRM.xlsx` — sheets: START HERE, Organisations, Email Drafts, Templates, Dashboard
- `reference/Wellthyfy_Outreach.gs` — Google Apps Script that creates **Gmail drafts only** (never sends)
- `reference/README.txt` — quick start + safety conditions

These notes are the source of truth for business logic ported into the new app.

---

## 1. Organisations sheet — 26 columns → new database

The sheet has a header row plus two placeholder rows (`SAMPLE-001` college, `SAMPLE-002` FMCG company) using
`example.edu` / `example.com` addresses. Data validations in the sheet define the allowed values noted below.

| # | Column | Allowed values (sheet validation) | New database mapping |
|---|---|---|---|
| 1 | Record ID | free text, `SAMPLE-*` = placeholder | `organisations.record_id`. Import keeps an existing `WF-######` id; any other value is replaced by a new auto id and the original kept in the import report. `SAMPLE-` rows are **skipped** on import and blocked by the send gate. |
| 2 | Organisation Name | | `organisations.name` |
| 3 | Organisation Type | `College / University`, `Company` | `organisations.org_type` → `college_university` / `company` |
| 4 | Industry / Department | free text (e.g. "Placement & Training", "FMCG / Sales Training") | `organisations.industry_department`; also used (with the name) to **guess `segment`** (see §1.1) |
| 5 | City | | `organisations.city` (`district` has no source column; left empty) |
| 6 | State | | `organisations.state` |
| 7 | Official Website | URL | `organisations.website`; `organisations.domain` = hostname lowercased, `www.` stripped (duplicate key) |
| 8 | Contact Person | | `contacts.full_name` |
| 9 | Designation | | `contacts.designation` |
| 10 | Official Email | email | `contacts.email` (lowercased, unique) |
| 11 | Contact Source URL | must start `http(s)://` | `contacts.source_url` |
| 12 | Contact Verified (YES/NO) | `YES`, `NO` | `contacts.verified`; YES also sets `verified_by` = importing user, `verified_at` = import time (only if source URL is http/https, else stays false and the report says why) |
| 13 | Likely Training Need / Website Evidence | | `research.training_need` and `research.website_evidence` (one research row per imported org, `ai_generated = false`) |
| 14 | Recommended Programme | free text | `research.recommended_programme_id` when it matches an active programme name (case-insensitive); otherwise the text is appended to the research `website_evidence` as "Imported programme: …" |
| 15 | Duration / Format | | `research.duration_format` |
| 16 | Personalisation Note | | `research.personalisation_note` |
| 17 | Email Subject | | Subject of an imported **draft** email (only when the row has a contact and a subject or body override) |
| 18 | Email Body Override (optional) | | Body of that draft; `[Organisation Name]`, `[Company Name]`, `[Contact Name]` placeholders are rendered. If empty, the body is rendered from the auto-selected template |
| 19 | Approval Status | `NOT READY`, `APPROVED FOR DRAFT`, `DO NOT CONTACT` | `DO NOT CONTACT` → `organisations.do_not_contact = true`. `APPROVED FOR DRAFT` → org stage `approved` (if outreach status is still Research Needed). **Never** maps to `emails.status = approved` — prospect-email approval must be recorded in the app by an admin (safety rule 1). |
| 20 | Draft Created? | `YES`, `NO` | Not imported as state (Gmail drafts don't exist in Titan). Recorded in the import activity payload. |
| 21 | Draft Created At | date | Recorded in the import activity payload |
| 22 | Outreach Status | `Research Needed`, `Draft Created`, `Sent`, `Replied`, `Meeting Scheduled`, `Proposal Submitted`, `Training Confirmed`, `No Response`, `Opted Out` | `organisations.stage`: research_needed, drafted, sent, replied, meeting_scheduled, proposal_sent, training_confirmed, `No Response` → sent, `Opted Out` → lost (reason "Opted out") + contact opt-out |
| 23 | Last Contact Date | date | Recorded as an `import_last_contact` activity |
| 24 | Follow-up Date | date | `organisations.next_follow_up_at` |
| 25 | Reply / Notes | | `organisations.notes` |
| 26 | Opt-out? (YES/NO) | `YES`, `NO` | `contacts.opt_out` (+ `opt_out_at` = import time). Permanent. |

Stage when Outreach Status is "Research Needed" (or blank): `approved` if Approval Status = APPROVED FOR DRAFT, else
`verified` if the contact is verified, else `research_needed`.

### 1.1 Segment guess (import + discovery)
Text = Industry / Department + Organisation Name, lowercased.
- College: `mba|commerce|management|business school|b.com|bba|pgdm` → `mba_commerce`; `engineering|technology|polytechnic|institute of tech` → `engineering`; `arts|science` → `arts_science`; else `other_college`.
- Company: `fmcg|consumer goods` → `fmcg`; `otc|consumer health` → `otc`; `pharma` → `pharma`; `startup|b2b|saas|services|software` → `startup_b2b`; else `other_company`.

### 1.2 Other sheets
- **Email Drafts** (log): Created At, Record ID, Organisation Name, Recipient, Subject, Draft Status, Gmail Draft ID, Notes → replaced by the `emails` table + `activities`.
- **Dashboard**: real organisations (excluding SAMPLE-), verified contacts, approved for draft, drafts created, sent, replied, meetings, training confirmed → new Dashboard totals.
- **START HERE** rules carried over: never guess names or emails; record the official source URL; mark verified only after checking; pilot with 10–20 contacts and check every draft.

---

## 2. Templates

### 2.1 The 4 templates (Templates sheet)

| Key | Use for | Subject |
|---|---|---|
| COLLEGE_GENERAL | College / University | Training Proposal \| Career Readiness & Employability Skills for Students |
| COLLEGE_MBA | MBA / Commerce | Training Proposal \| Sales, Marketing & Business Readiness for MBA Students |
| COMPANY_SALES | FMCG / OTC / Pharma / Sales teams | Customised Sales Training Proposal \| [Organisation Name] |
| COMPANY_STARTUP | Startup / B2B / Services | Customised Sales & Business Development Training \| [Organisation Name] |

All bodies open with `Dear [Contact Name] Sir/Madam,` / "Greetings from Wellthyfy Lifestyle Ventures.", give the
22+ years experience pitch, list modules for the segment, offer formats (one-hour → multi-day / contract), ask for a
discussion or proposal, and end with the signature block (Selvaganapathy V., CEO, phone, email, website).

Conversion to merge fields for the seed:
- `[Contact Name]` → `{{contactName}}` (greeting rendered as "Dear {{contactName}} Sir/Madam," or "Dear Sir/Madam," when no name — fixes the script's "Dear Sir/Madam Sir/Madam" case)
- `[Organisation Name]` / `[Company Name]` → `{{organisationName}}`
- The signature block → `{{signature}}`; `{{optOutLine}}` appended to every template (safety rule 4)
- From the script's generated body, optional lines are added only when the field has a value:
  "Based on the potential focus area — {{trainingNeed}} …", "A relevant point for your organisation: {{personalisationNote}}",
  "({{durationFormat}})", and the programme name. Uses `{{#field}}…{{/field}}` conditional sections.

### 2.2 Subject/body selection logic in the script
1. **Subject**: the row's `Email Subject` if filled; otherwise `defaultSubject_(type, org, programme)`:
   if `type + programme` (lowercased) contains "company" or matches `fmcg|pharma|otc|sales team|startup|business development`
   → `Customised Training Proposal | <Organisation>`; else → `Training Proposal | Career Readiness & Industry-Oriented Skills`.
2. **Body**: the row's `Email Body Override` if filled; otherwise `buildBody_()` — a **company** body if Organisation Type
   contains "company", else a **college** body. The body weaves in training need (or programme, or a default focus area),
   duration/format, and the personalisation note, then the signature, then "Prepared for: <designation>" if set.
3. Placeholders `[Organisation Name]`, `[Contact Name]` (fallback "Sir/Madam"), `[Company Name]` are replaced in the body.
4. Note: the script does **not** read the Templates sheet; the sheet is guidance.

New app (as specified): template auto-selected by segment — fmcg/otc/pharma → COMPANY_SALES; startup_b2b/other_company →
COMPANY_STARTUP; mba_commerce → COLLEGE_MBA; other colleges → COLLEGE_GENERAL. The user can override the template and edit
the rendered subject/body before saving the draft. The "Prepared for: <designation>" line is dropped (it was a reviewer aid,
not prospect-facing text).

---

## 3. Safety gate in the script (`createDraftForRow_`)

A draft is created only if **all** hold:
1. Record ID present (and bulk mode skips `SAMPLE-` ids)
2. Organisation Name present
3. Contact Verified = `YES`
4. Approval Status = `APPROVED FOR DRAFT`
5. Opt-out ≠ `YES`
6. Draft Created? ≠ `YES` (no duplicate drafts)
7. Official Email matches `^[^\s@]+@[^\s@]+\.[^\s@]+$` and does not contain `example.com` / `example.edu`
8. Contact Source URL matches `^https?://`

It only ever calls `GmailApp.createDraft` (never `sendEmail`), sets From name "Selvaganapathy V. | Wellthyfy Lifestyle
Ventures", Reply-To ceo@wellthyfy.in, then writes Draft Created? = YES, Draft Created At, Outreach Status = "Draft Created"
and appends to the Email Drafts log.

New app: these checks are all part of `checkSendGate` (packages/shared), extended per CLAUDE.md safety rule 2 (opt-out
and do-not-contact, ZeroBounce status, approval recorded with approved_by/approved_at, 7-day spacing, follow-up limit,
caps, send window/days, SAMPLE- block). The example-domain check is broadened to example.com/.org/.net/.edu, `*.example`,
`test`, `invalid`, `localhost` and "sample" domains.
