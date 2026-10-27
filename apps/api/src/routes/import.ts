import { Router } from 'express';
import multer from 'multer';
import { eq, ilike, sql } from 'drizzle-orm';
import {
  convertLegacyPlaceholders,
  ensureOptOutLine,
  IMPORT_FIELDS,
  importCommitSchema,
  suggestMapping,
  transformRow,
  type ImportField,
  type TransformedRow,
} from '@wellthyfy/shared';
import {
  contacts,
  emails,
  isSuppressed,
  logActivity,
  organisations,
  programmes,
  research,
  suppress,
  type Db,
} from '@wellthyfy/shared/server';
import type { RouteDeps } from '../app';
import { canEdit, currentUser, type AuthUser } from '../lib/auth';
import { renderForContact, resolveTemplate } from '../lib/crm';
import { badRequest } from '../lib/errors';
import { parseBody } from '../lib/http';
import { parseSpreadsheet } from '../lib/spreadsheet';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

export interface ImportRowResult {
  row: number;
  status: 'created' | 'updated' | 'skipped';
  reason?: string;
  organisationId?: string;
  recordId?: string;
  name?: string;
  warnings: string[];
}

const RECORD_ID_RE = /^WF-(\d{6})$/;

async function applyRow(
  db: Db,
  t: TransformedRow,
  user: AuthUser,
  updateExisting: boolean,
  now: Date,
): Promise<ImportRowResult> {
  const base = { row: t.rowNumber, name: t.organisation.name, warnings: [...t.warnings] };
  if (t.skip) return { ...base, status: 'skipped', reason: t.skip };

  // Duplicate detection: domain first, then an existing WF- record id.
  let existing = t.organisation.domain
    ? (await db.select().from(organisations).where(eq(organisations.domain, t.organisation.domain)))[0]
    : undefined;
  if (!existing && t.recordId && RECORD_ID_RE.test(t.recordId)) {
    existing = (await db.select().from(organisations).where(eq(organisations.recordId, t.recordId)))[0];
  }
  if (existing && !updateExisting) {
    return {
      ...base,
      status: 'skipped',
      reason: `Duplicate of ${existing.recordId} (${existing.name})`,
      organisationId: existing.id,
    };
  }

  const o = t.organisation;
  let orgId: string;
  let recordId: string;
  let status: 'created' | 'updated';
  if (existing) {
    const patch: Partial<typeof organisations.$inferInsert> = {};
    for (const k of ['industryDepartment', 'city', 'district', 'state', 'website', 'notes'] as const) {
      if (o[k] && !existing[k]) patch[k] = o[k];
    }
    if (o.nextFollowUpAt) patch.nextFollowUpAt = o.nextFollowUpAt;
    if (o.doNotContact && !existing.doNotContact) patch.doNotContact = true;
    if (Object.keys(patch).length)
      await db.update(organisations).set(patch).where(eq(organisations.id, existing.id));
    orgId = existing.id;
    recordId = existing.recordId;
    status = 'updated';
  } else {
    const keepId = t.recordId && RECORD_ID_RE.test(t.recordId) ? t.recordId : undefined;
    const [created] = await db
      .insert(organisations)
      .values({
        ...(keepId ? { recordId: keepId } : {}),
        name: o.name,
        orgType: o.orgType,
        segment: o.segment,
        industryDepartment: o.industryDepartment,
        city: o.city,
        district: o.district,
        state: o.state,
        website: o.website,
        domain: o.domain,
        stage: o.stage,
        doNotContact: o.doNotContact,
        lostReason: o.lostReason,
        nextFollowUpAt: o.nextFollowUpAt,
        notes: o.notes,
        source: 'import',
        ownerId: user.id,
        createdBy: user.id,
      })
      .returning();
    if (keepId) {
      // Keep the sequence ahead of imported ids so future WF- ids never collide.
      const n = Number(RECORD_ID_RE.exec(keepId)![1]);
      await db.execute(
        sql`select setval('organisation_record_seq', greatest((select last_value from organisation_record_seq), ${n}))`,
      );
    } else if (t.recordId) {
      base.warnings.push(`Original Record ID "${t.recordId}" replaced by ${created!.recordId}`);
    }
    orgId = created!.id;
    recordId = created!.recordId;
    status = 'created';
  }

  // Contact
  let contactId: string | null = null;
  let contactVerified = false;
  if (t.contact) {
    const c = t.contact;
    const suppressed = c.email ? await isSuppressed(db, c.email) : false;
    const optOut = c.optOut || suppressed;
    const dupe = c.email
      ? (await db.select().from(contacts).where(eq(contacts.email, c.email)))[0]
      : undefined;
    if (dupe && dupe.organisationId !== orgId) {
      base.warnings.push(`Contact ${c.email} already belongs to another organisation; not imported`);
    } else if (dupe) {
      const patch: Partial<typeof contacts.$inferInsert> = {};
      if (c.fullName && !dupe.fullName) patch.fullName = c.fullName;
      if (c.designation && !dupe.designation) patch.designation = c.designation;
      if (c.sourceUrl && !dupe.sourceUrl) patch.sourceUrl = c.sourceUrl;
      if (c.verified && !dupe.verified && (dupe.sourceUrl || c.sourceUrl)) {
        Object.assign(patch, { verified: true, verifiedBy: user.id, verifiedAt: now });
      }
      if (optOut && !dupe.optOut) Object.assign(patch, { optOut: true, optOutAt: now });
      if (Object.keys(patch).length) await db.update(contacts).set(patch).where(eq(contacts.id, dupe.id));
      contactId = dupe.id;
      contactVerified = dupe.verified || !!patch.verified;
    } else {
      const hasPrimary =
        (await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.organisationId, orgId)))
          .length > 0;
      const [created] = await db
        .insert(contacts)
        .values({
          organisationId: orgId,
          fullName: c.fullName,
          designation: c.designation,
          email: c.email,
          phone: c.phone,
          sourceUrl: c.sourceUrl,
          verified: c.verified,
          verifiedBy: c.verified ? user.id : null,
          verifiedAt: c.verified ? now : null,
          optOut,
          optOutAt: optOut ? now : null,
          isPrimary: !hasPrimary,
        })
        .returning();
      contactId = created!.id;
      contactVerified = c.verified;
    }
    if (optOut && c.email) await suppress(db, c.email, 'imported opt-out');
  }

  // Research
  if (t.research) {
    let programmeId: string | null = null;
    let evidence = t.research.websiteEvidence;
    if (t.research.recommendedProgramme) {
      const [p] = await db
        .select({ id: programmes.id })
        .from(programmes)
        .where(ilike(programmes.name, t.research.recommendedProgramme));
      if (p) programmeId = p.id;
      else
        evidence = [evidence, `Imported programme: ${t.research.recommendedProgramme}`]
          .filter(Boolean)
          .join('\n');
    }
    await db.insert(research).values({
      organisationId: orgId,
      trainingNeed: t.research.trainingNeed,
      websiteEvidence: evidence,
      recommendedProgrammeId: programmeId,
      durationFormat: t.research.durationFormat,
      personalisationNote: t.research.personalisationNote,
      createdBy: user.id,
      aiGenerated: false,
    });
  }

  // Draft email from the sheet's subject/body override (never approved on import — safety rule 1).
  if (t.emailDraft && contactId) {
    if (!contactVerified) {
      base.warnings.push('Email subject/body not imported as a draft: contact is not verified');
    } else {
      const [org] = await db.select().from(organisations).where(eq(organisations.id, orgId));
      const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
      const template = await resolveTemplate(db, org!);
      const rendered = await renderForContact(db, org!, contact!, {
        subject: t.emailDraft.subject ? convertLegacyPlaceholders(t.emailDraft.subject) : template.subject,
        body: t.emailDraft.body ? convertLegacyPlaceholders(t.emailDraft.body) : template.body,
      });
      const body = ensureOptOutLine(rendered.body, rendered.optOutLine);
      const [e] = await db
        .insert(emails)
        .values({
          organisationId: orgId,
          contactId,
          templateId: template.id,
          templateVersion: template.version,
          kind: 'first_contact',
          subject: rendered.subject,
          body,
          status: 'draft',
          createdBy: user.id,
        })
        .returning();
      await db.update(emails).set({ threadId: e!.id }).where(eq(emails.id, e!.id));
    }
  }

  await logActivity(db, {
    organisationId: orgId,
    userId: user.id,
    type: status === 'created' ? 'organisation_imported' : 'organisation_import_updated',
    payload: {
      row: t.rowNumber,
      legacy: { ...t.legacy, lastContactDate: t.legacy.lastContactDate?.toISOString() ?? null },
      warnings: base.warnings,
    },
  });
  if (t.legacy.lastContactDate) {
    await logActivity(db, {
      organisationId: orgId,
      userId: user.id,
      type: 'import_last_contact',
      payload: { occurredAt: t.legacy.lastContactDate.toISOString(), body: 'Last contact date from import' },
    });
  }
  return { ...base, status, organisationId: orgId, recordId };
}

export function importRoutes({ db, now }: RouteDeps): Router {
  const r = Router();

  r.post('/import/parse', canEdit, upload.single('file'), async (req, res) => {
    if (!req.file) throw badRequest('No file uploaded (field "file")');
    const parsed = await parseSpreadsheet(req.file.buffer, req.file.originalname);
    if (parsed.rows.length > 5000) throw badRequest('Maximum 5000 rows per import');
    const mapping = suggestMapping(parsed.headers);
    res.json({
      sheetName: parsed.sheetName,
      headers: parsed.headers,
      rows: parsed.rows,
      preview: parsed.rows.slice(0, 20),
      totalRows: parsed.rows.length,
      suggestedMapping: mapping,
      fields: IMPORT_FIELDS,
    });
  });

  /** Dry transform for the mapping screen: shows how the first 20 rows will be interpreted. */
  r.post('/import/preview', canEdit, async (req, res) => {
    const body = parseBody(importCommitSchema, req);
    res.json(
      body.rows
        .slice(0, 20)
        .map((row, i) => transformRow(row, body.mapping as Partial<Record<ImportField, string>>, i + 2)),
    );
  });

  r.post('/import/commit', canEdit, async (req, res) => {
    const user = currentUser(req);
    const body = parseBody(importCommitSchema, req);
    const mapping = body.mapping as Partial<Record<ImportField, string>>;
    if (!mapping.name || !mapping.orgType)
      throw badRequest('Map at least "Organisation name" and "Organisation type"');
    const results: ImportRowResult[] = [];
    for (let i = 0; i < body.rows.length; i++) {
      const t = transformRow(body.rows[i]!, mapping, i + 2);
      try {
        results.push(await applyRow(db, t, user, body.updateExisting, now()));
      } catch (err) {
        results.push({
          row: t.rowNumber,
          name: t.organisation.name,
          status: 'skipped',
          reason: `Error: ${(err as Error).message}`,
          warnings: t.warnings,
        });
      }
    }
    const summary = {
      created: results.filter((x) => x.status === 'created').length,
      updated: results.filter((x) => x.status === 'updated').length,
      skipped: results.filter((x) => x.status === 'skipped').length,
    };
    await logActivity(db, {
      userId: user.id,
      type: 'import_completed',
      payload: { ...summary, rows: body.rows.length },
    });
    res.json({ ...summary, results });
  });

  return r;
}
