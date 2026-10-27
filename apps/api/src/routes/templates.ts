import { Router } from 'express';
import { asc, desc, eq } from 'drizzle-orm';
import {
  selectTemplateKey,
  templateCreateSchema,
  templatePreviewSchema,
  templateUpdateSchema,
  unknownMergeFields,
} from '@wellthyfy/shared';
import { contacts, logActivity, templates, templateVersions } from '@wellthyfy/shared/server';
import type { RouteDeps } from '../app';
import { adminOnly, currentUser } from '../lib/auth';
import { getOrg, renderForContact } from '../lib/crm';
import { badRequest, notFound } from '../lib/errors';
import { idParam, parseBody } from '../lib/http';

function assertKnownFields(subject: string, body: string) {
  const unknown = unknownMergeFields(`${subject}\n${body}`);
  if (unknown.length) throw badRequest(`Unknown merge field(s): ${unknown.join(', ')}`);
}

export function templateRoutes({ db }: RouteDeps): Router {
  const r = Router();

  r.get('/templates', async (_req, res) => {
    res.json(await db.select().from(templates).orderBy(asc(templates.kind), asc(templates.key)));
  });

  /** Auto-selected template for an organisation (ported from the reference script). */
  r.get('/templates/select', async (req, res) => {
    const org = await getOrg(db, String(req.query.organisationId ?? ''));
    const key = selectTemplateKey(org.segment);
    const [t] = await db.select().from(templates).where(eq(templates.key, key));
    res.json({ key, template: t ?? null });
  });

  r.get('/templates/:id', async (req, res) => {
    const id = idParam(req);
    const [t] = await db.select().from(templates).where(eq(templates.id, id));
    if (!t) throw notFound('Template not found');
    const versions = await db
      .select()
      .from(templateVersions)
      .where(eq(templateVersions.templateId, id))
      .orderBy(desc(templateVersions.version));
    res.json({ template: t, versions });
  });

  r.post('/templates', adminOnly, async (req, res) => {
    const user = currentUser(req);
    const body = parseBody(templateCreateSchema, req);
    assertKnownFields(body.subject, body.body);
    const [t] = await db
      .insert(templates)
      .values({ ...body, version: 1 })
      .returning();
    await db.insert(templateVersions).values({
      templateId: t!.id,
      version: 1,
      subject: t!.subject,
      body: t!.body,
      createdBy: user.id,
    });
    await logActivity(db, {
      userId: user.id,
      type: 'template_created',
      payload: { templateId: t!.id, key: t!.key },
    });
    res.status(201).json(t);
  });

  /** Editing creates a new version; emails keep the version they were rendered from. */
  r.patch('/templates/:id', adminOnly, async (req, res) => {
    const user = currentUser(req);
    const id = idParam(req);
    const [t] = await db.select().from(templates).where(eq(templates.id, id));
    if (!t) throw notFound('Template not found');
    const body = parseBody(templateUpdateSchema, req);
    const subject = body.subject ?? t.subject;
    const text = body.body ?? t.body;
    assertKnownFields(subject, text);
    const contentChanged = subject !== t.subject || text !== t.body;
    const version = contentChanged ? t.version + 1 : t.version;
    const [updated] = await db
      .update(templates)
      .set({ ...body, subject, body: text, version })
      .where(eq(templates.id, id))
      .returning();
    if (contentChanged) {
      await db
        .insert(templateVersions)
        .values({ templateId: id, version, subject, body: text, createdBy: user.id });
    }
    await logActivity(db, {
      userId: user.id,
      type: 'template_updated',
      payload: { templateId: id, key: t.key, version, contentChanged },
    });
    res.json(updated);
  });

  /** Live preview of (possibly unsaved) template text against a chosen organisation + contact. */
  r.post('/templates/preview', async (req, res) => {
    const body = parseBody(templatePreviewSchema, req);
    const org = await getOrg(db, body.organisationId);
    const contact = body.contactId
      ? ((await db.select().from(contacts).where(eq(contacts.id, body.contactId)))[0] ?? null)
      : null;
    const rendered = await renderForContact(db, org, contact, { subject: body.subject, body: body.body });
    res.json({
      subject: rendered.subject,
      body: rendered.body,
      unknownFields: unknownMergeFields(`${body.subject}\n${body.body}`),
    });
  });

  return r;
}
