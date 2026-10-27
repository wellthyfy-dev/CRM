import { Router } from 'express';
import { and, count, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  buildMergeVars,
  proposalCreateSchema,
  proposalStatusSchema,
  renderEmail,
  replySubject,
} from '@wellthyfy/shared';
import {
  advanceOrg,
  contacts,
  effectiveOptOutLine,
  emails,
  getSettings,
  latestResearch,
  logActivity,
  organisations,
  programmes,
  proposals,
  setOrgStage,
} from '@wellthyfy/shared/server';
import type { RouteDeps } from '../app';
import { canEdit, currentUser } from '../lib/auth';
import { getContact, getOrg, requireVerifiedContact } from '../lib/crm';
import { badRequest, notFound } from '../lib/errors';
import { idParam, parseBody } from '../lib/http';
import { renderProposalPdf } from '../lib/proposal-pdf';

const PROPOSAL_EMAIL = {
  subject: 'Training Proposal | {{organisationName}}',
  body: `Dear {{#contactName}}{{contactName}} {{/contactName}}Sir/Madam,

Thank you for your time. Please find attached our proposal for {{programmeName}} for {{organisationName}}{{#durationFormat}} ({{durationFormat}}){{/durationFormat}}.

I would be glad to walk you through it and adapt it to your priorities.

{{signature}}

{{optOutLine}}`,
};

export function proposalRoutes({ db, services, now }: RouteDeps): Router {
  const r = Router();

  const listQuery = () =>
    db
      .select({
        proposal: proposals,
        organisationName: organisations.name,
        recordId: organisations.recordId,
        programmeName: programmes.name,
        contactName: contacts.fullName,
        emailStatus: emails.status,
      })
      .from(proposals)
      .innerJoin(organisations, eq(organisations.id, proposals.organisationId))
      .leftJoin(programmes, eq(programmes.id, proposals.programmeId))
      .leftJoin(contacts, eq(contacts.id, proposals.contactId))
      .leftJoin(emails, eq(emails.id, proposals.emailId));
  const flatten = (rows: Awaited<ReturnType<typeof listQuery>>) =>
    rows.map((x) => ({
      ...x.proposal,
      organisationName: x.organisationName,
      recordId: x.recordId,
      programmeName: x.programmeName,
      contactName: x.contactName,
      emailStatus: x.emailStatus,
    }));

  r.get('/proposals', async (_req, res) => {
    res.json(flatten(await listQuery().orderBy(desc(proposals.createdAt)).limit(500)));
  });

  r.get('/organisations/:id/proposals', async (req, res) => {
    res.json(
      flatten(
        await listQuery()
          .where(eq(proposals.organisationId, idParam(req)))
          .orderBy(desc(proposals.createdAt)),
      ),
    );
  });

  r.post('/proposals', canEdit, async (req, res) => {
    const user = currentUser(req);
    const body = parseBody(proposalCreateSchema, req);
    const org = await getOrg(db, body.organisationId);
    const [programme] = await db.select().from(programmes).where(eq(programmes.id, body.programmeId));
    if (!programme) throw badRequest('Unknown programme');
    const contact = body.contactId ? await getContact(db, body.contactId) : null;
    if (contact && contact.organisationId !== org.id)
      throw badRequest('Contact does not belong to this organisation');
    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(proposals)
      .where(eq(proposals.organisationId, org.id));
    const proposalNo = `P-${org.recordId}-${Number(n) + 1}`;
    const [row] = await db
      .insert(proposals)
      .values({
        organisationId: org.id,
        programmeId: programme.id,
        contactId: contact?.id ?? null,
        duration: body.duration,
        valueInr: body.valueInr,
        notes: body.notes,
        status: 'draft',
        createdBy: user.id,
      })
      .returning();
    const research = await latestResearch(db, org.id);
    const pdf = await renderProposalPdf({
      proposalNo,
      date: now(),
      organisation: org,
      contact,
      programme,
      duration: body.duration,
      valueInr: body.valueInr,
      notes: body.notes,
      trainingNeed: research?.trainingNeed,
    });
    const filePath = `proposals/${org.id}/${row!.id}.pdf`;
    await services.files.put(filePath, pdf, 'application/pdf');
    const [updated] = await db
      .update(proposals)
      .set({ filePath })
      .where(eq(proposals.id, row!.id))
      .returning();
    await logActivity(db, {
      organisationId: org.id,
      userId: user.id,
      type: 'proposal_created',
      payload: { proposalId: row!.id, proposalNo, valueInr: body.valueInr, programme: programme.name },
    });
    res.status(201).json(updated);
  });

  r.get('/proposals/:id/pdf', async (req, res) => {
    const [p] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.id, idParam(req)));
    if (!p?.filePath) throw notFound('Proposal PDF not found');
    const buf = await services.files.get(p.filePath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="proposal-${p.id.slice(0, 8)}.pdf"`);
    res.send(buf);
  });

  /** Attach the PDF to an email draft in the existing thread. The draft still needs human approval. */
  r.post('/proposals/:id/email', canEdit, async (req, res) => {
    const user = currentUser(req);
    const [p] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.id, idParam(req)));
    if (!p) throw notFound('Proposal not found');
    if (!p.filePath) throw badRequest('Proposal has no PDF');
    if (p.emailId) throw badRequest('An email has already been drafted for this proposal');
    const contactId = (req.body as { contactId?: string })?.contactId ?? p.contactId;
    if (!contactId) throw badRequest('Choose a contact for this proposal');
    const contact = await getContact(db, contactId);
    requireVerifiedContact(contact);
    const org = await getOrg(db, p.organisationId);
    if (org.doNotContact) throw badRequest('Organisation is marked do-not-contact');
    const [programme] = p.programmeId
      ? await db.select().from(programmes).where(eq(programmes.id, p.programmeId))
      : [];
    const [parent] = await db
      .select()
      .from(emails)
      .where(
        and(
          eq(emails.contactId, contact.id),
          isNotNull(emails.sentAt),
          inArray(emails.status, ['sent', 'replied']),
        ),
      )
      .orderBy(desc(emails.sentAt))
      .limit(1);
    const s = await getSettings(db);
    const optOutLine = effectiveOptOutLine(s);
    const vars = buildMergeVars({
      organisation: org,
      contact,
      research: { durationFormat: p.duration },
      programme: programme ? { name: programme.name.replace(/^SAMPLE – edit me:\s*/, '') } : null,
      settings: { signature: s.signature, optOutLine },
    });
    const rendered = renderEmail(PROPOSAL_EMAIL, vars);
    const [created] = await db
      .insert(emails)
      .values({
        organisationId: org.id,
        contactId: contact.id,
        kind: 'proposal',
        followUpNo: 0,
        parentEmailId: parent?.id ?? null,
        threadId: parent?.threadId ?? null,
        subject: parent ? replySubject(parent.subject) : rendered.subject,
        body: rendered.body,
        status: 'draft',
        createdBy: user.id,
        inReplyTo: parent?.messageId ?? null,
        references: parent ? [parent.references, parent.messageId].filter(Boolean).join(' ') || null : null,
        attachments: [
          {
            path: p.filePath,
            filename: `Wellthyfy-Proposal-${org.recordId}.pdf`,
            contentType: 'application/pdf',
          },
        ],
      })
      .returning();
    if (!parent) await db.update(emails).set({ threadId: created!.id }).where(eq(emails.id, created!.id));
    await db
      .update(proposals)
      .set({ emailId: created!.id, contactId: contact.id })
      .where(eq(proposals.id, p.id));
    await logActivity(db, {
      organisationId: org.id,
      userId: user.id,
      type: 'email_drafted',
      payload: { emailId: created!.id, subject: created!.subject, proposalId: p.id },
    });
    res.status(201).json(created);
  });

  r.post('/proposals/:id/status', canEdit, async (req, res) => {
    const user = currentUser(req);
    const [p] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.id, idParam(req)));
    if (!p) throw notFound('Proposal not found');
    const { status } = parseBody(proposalStatusSchema, req);
    const decided = status === 'accepted' || status === 'declined';
    const [updated] = await db
      .update(proposals)
      .set({
        status,
        decidedAt: decided ? now() : null,
        sentAt: status === 'sent' ? (p.sentAt ?? now()) : p.sentAt,
      })
      .where(eq(proposals.id, p.id))
      .returning();
    if (status === 'accepted') {
      await setOrgStage(db, await getOrg(db, p.organisationId), 'training_confirmed', user.id, {
        reason: 'proposal accepted',
      });
    } else if (status === 'sent') {
      await advanceOrg(db, p.organisationId, 'proposal_sent', user.id, 'proposal marked sent');
    }
    await logActivity(db, {
      organisationId: p.organisationId,
      userId: user.id,
      type: 'proposal_status',
      payload: { proposalId: p.id, status },
    });
    res.json(updated);
  });

  return r;
}
