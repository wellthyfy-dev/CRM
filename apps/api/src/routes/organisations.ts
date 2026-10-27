import { Router } from 'express';
import { and, asc, count, desc, eq, gte, ilike, lt, notInArray, or, sql, type SQL } from 'drizzle-orm';
import {
  activityCreateSchema,
  followUpDateSchema,
  normaliseDomain,
  normaliseWebsite,
  organisationCreateSchema,
  organisationListQuerySchema,
  organisationUpdateSchema,
  SEGMENT_LABELS,
  STAGE_LABELS,
  stageChangeSchema,
  startOfIstDay,
  addDays,
  type OrganisationListQuery,
} from '@wellthyfy/shared';
import {
  activities,
  contacts,
  logActivity,
  organisations,
  profiles,
  research,
  type Db,
} from '@wellthyfy/shared/server';
import type { RouteDeps } from '../app';
import { canEdit, currentUser } from '../lib/auth';
import { assertDomainFree, getOrg, setOrgStage } from '../lib/crm';
import { forbidden } from '../lib/errors';
import { idParam, parseBody, parseQuery, toCsv } from '../lib/http';

const primaryContactSql = sql<{
  id: string;
  fullName: string;
  email: string | null;
  designation: string | null;
  verified: boolean;
  optOut: boolean;
} | null>`(select json_build_object('id', c.id, 'fullName', c.full_name, 'email', c.email, 'designation', c.designation, 'verified', c.verified, 'optOut', c.opt_out)
  from contacts c where c.organisation_id = ${organisations.id}
  order by c.is_primary desc, c.created_at asc limit 1)`;

const lastActivitySql = sql<
  string | null
>`(select max(a.created_at) from activities a where a.organisation_id = ${organisations.id})`;

const SORT_COLUMNS = {
  name: organisations.name,
  record_id: organisations.recordId,
  city: organisations.city,
  stage: organisations.stage,
  created_at: organisations.createdAt,
  updated_at: organisations.updatedAt,
  next_follow_up_at: organisations.nextFollowUpAt,
} as const;

const CLOSED_STAGES = ['training_confirmed', 'lost'] as const;

export function organisationFilters(q: Partial<OrganisationListQuery>, now: Date): SQL | undefined {
  const where: SQL[] = [];
  if (q.q) {
    const like = `%${q.q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    where.push(
      or(
        ilike(organisations.name, like),
        ilike(organisations.city, like),
        ilike(organisations.domain, like),
        ilike(organisations.recordId, like),
        sql`exists (select 1 from contacts c where c.organisation_id = ${organisations.id} and c.email ilike ${like})`,
      )!,
    );
  }
  if (q.orgType) where.push(eq(organisations.orgType, q.orgType));
  if (q.segment) where.push(eq(organisations.segment, q.segment));
  if (q.state) where.push(ilike(organisations.state, q.state));
  if (q.city) where.push(ilike(organisations.city, q.city));
  if (q.stage) where.push(eq(organisations.stage, q.stage));
  if (q.ownerId) where.push(eq(organisations.ownerId, q.ownerId));
  if (q.verified !== undefined) {
    const e = sql`exists (select 1 from contacts c where c.organisation_id = ${organisations.id} and c.verified = true)`;
    where.push(q.verified ? e : sql`not ${e}`);
  }
  if (q.optOut !== undefined) {
    const e = sql`exists (select 1 from contacts c where c.organisation_id = ${organisations.id} and c.opt_out = true)`;
    where.push(q.optOut ? e : sql`not ${e}`);
  }
  if (q.due) {
    const today = startOfIstDay(now);
    where.push(notInArray(organisations.stage, [...CLOSED_STAGES]));
    if (q.due === 'today') {
      where.push(
        gte(organisations.nextFollowUpAt, today),
        lt(organisations.nextFollowUpAt, addDays(today, 1)),
      );
    } else {
      where.push(lt(organisations.nextFollowUpAt, today));
    }
  }
  return where.length ? and(...where) : undefined;
}

async function listOrganisations(db: Db, q: OrganisationListQuery, now: Date, limitAll = false) {
  const where = organisationFilters(q, now);
  const col = SORT_COLUMNS[q.sort];
  const order = q.dir === 'asc' ? asc(col) : desc(col);
  const base = db
    .select({
      id: organisations.id,
      recordId: organisations.recordId,
      name: organisations.name,
      orgType: organisations.orgType,
      segment: organisations.segment,
      industryDepartment: organisations.industryDepartment,
      city: organisations.city,
      district: organisations.district,
      state: organisations.state,
      website: organisations.website,
      domain: organisations.domain,
      stage: organisations.stage,
      doNotContact: organisations.doNotContact,
      nextFollowUpAt: organisations.nextFollowUpAt,
      ownerId: organisations.ownerId,
      ownerName: profiles.fullName,
      source: organisations.source,
      notes: organisations.notes,
      createdAt: organisations.createdAt,
      updatedAt: organisations.updatedAt,
      primaryContact: primaryContactSql,
      lastActivityAt: lastActivitySql,
    })
    .from(organisations)
    .leftJoin(profiles, eq(profiles.id, organisations.ownerId))
    .where(where)
    .orderBy(order, asc(organisations.id));
  const items = limitAll
    ? await base.limit(20000)
    : await base.limit(q.pageSize).offset((q.page - 1) * q.pageSize);
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(organisations).where(where);
  return { items, total: Number(n), page: q.page, pageSize: q.pageSize };
}

export function organisationRoutes({ db, now }: RouteDeps): Router {
  const r = Router();

  r.get('/organisations', async (req, res) => {
    res.json(await listOrganisations(db, parseQuery(organisationListQuerySchema, req), now()));
  });

  r.get('/organisations/export.csv', async (req, res) => {
    const q = parseQuery(organisationListQuerySchema, req);
    const { items } = await listOrganisations(db, q, now(), true);
    const csv = toCsv(
      [
        'Record ID',
        'Name',
        'Type',
        'Segment',
        'Industry / Department',
        'City',
        'District',
        'State',
        'Website',
        'Stage',
        'Owner',
        'Primary contact',
        'Designation',
        'Email',
        'Verified',
        'Opt-out',
        'Do not contact',
        'Next follow-up',
        'Notes',
      ],
      items.map((o) => [
        o.recordId,
        o.name,
        o.orgType,
        SEGMENT_LABELS[o.segment],
        o.industryDepartment,
        o.city,
        o.district,
        o.state,
        o.website,
        STAGE_LABELS[o.stage],
        o.ownerName,
        o.primaryContact?.fullName,
        o.primaryContact?.designation,
        o.primaryContact?.email,
        o.primaryContact ? (o.primaryContact.verified ? 'YES' : 'NO') : '',
        o.primaryContact ? (o.primaryContact.optOut ? 'YES' : 'NO') : '',
        o.doNotContact ? 'YES' : 'NO',
        o.nextFollowUpAt,
        o.notes,
      ]),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="organisations.csv"');
    // UTF-8 byte-order mark so Excel opens the CSV with the right encoding.
    res.send(String.fromCharCode(0xfeff) + csv);
  });

  r.get('/organisations/check-duplicate', async (req, res) => {
    const domain = normaliseDomain(String(req.query.website ?? ''));
    const email = String(req.query.email ?? '')
      .trim()
      .toLowerCase();
    const result: { organisation?: unknown; contact?: unknown } = {};
    if (domain) {
      const [o] = await db
        .select({ id: organisations.id, recordId: organisations.recordId, name: organisations.name })
        .from(organisations)
        .where(eq(organisations.domain, domain));
      if (o) result.organisation = o;
    }
    if (email) {
      const [c] = await db
        .select({ id: contacts.id, organisationId: contacts.organisationId, name: organisations.name })
        .from(contacts)
        .innerJoin(organisations, eq(organisations.id, contacts.organisationId))
        .where(eq(contacts.email, email));
      if (c) result.contact = c;
    }
    res.json(result);
  });

  r.get('/organisations/:id', async (req, res) => {
    const org = await getOrg(db, idParam(req));
    const [owner] = org.ownerId
      ? await db
          .select({ id: profiles.id, fullName: profiles.fullName })
          .from(profiles)
          .where(eq(profiles.id, org.ownerId))
      : [];
    const contactRows = await db
      .select()
      .from(contacts)
      .where(eq(contacts.organisationId, org.id))
      .orderBy(desc(contacts.isPrimary), asc(contacts.createdAt));
    const [latest] = await db
      .select()
      .from(research)
      .where(eq(research.organisationId, org.id))
      .orderBy(desc(research.createdAt))
      .limit(1);
    res.json({ organisation: org, owner: owner ?? null, contacts: contactRows, research: latest ?? null });
  });

  r.post('/organisations', canEdit, async (req, res) => {
    const user = currentUser(req);
    const body = parseBody(organisationCreateSchema, req);
    const website = normaliseWebsite(body.website);
    const domain = normaliseDomain(website);
    await assertDomainFree(db, domain);
    const [org] = await db
      .insert(organisations)
      .values({
        name: body.name,
        orgType: body.orgType,
        segment: body.segment,
        industryDepartment: body.industryDepartment,
        city: body.city,
        district: body.district,
        state: body.state,
        website,
        domain,
        ownerId: body.ownerId ?? user.id,
        notes: body.notes,
        source: body.source ?? 'manual',
        nextFollowUpAt: body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null,
        createdBy: user.id,
      })
      .returning();
    await logActivity(db, {
      organisationId: org!.id,
      userId: user.id,
      type: 'organisation_created',
      payload: { recordId: org!.recordId, source: org!.source },
    });
    res.status(201).json(org);
  });

  r.patch('/organisations/:id', canEdit, async (req, res) => {
    const user = currentUser(req);
    const org = await getOrg(db, idParam(req));
    const body = parseBody(organisationUpdateSchema, req);
    if (body.doNotContact === false && org.doNotContact && user.role !== 'admin') {
      throw forbidden('Only an admin can clear do-not-contact');
    }
    const patch: Partial<typeof organisations.$inferInsert> = {};
    for (const key of [
      'name',
      'orgType',
      'segment',
      'industryDepartment',
      'city',
      'district',
      'state',
      'ownerId',
      'notes',
      'doNotContact',
    ] as const) {
      if (body[key] !== undefined) (patch as Record<string, unknown>)[key] = body[key];
    }
    if (body.website !== undefined) {
      patch.website = normaliseWebsite(body.website);
      patch.domain = normaliseDomain(patch.website);
      await assertDomainFree(db, patch.domain, org.id);
    }
    if (body.nextFollowUpAt !== undefined) {
      patch.nextFollowUpAt = body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null;
    }
    const [updated] = await db
      .update(organisations)
      .set(patch)
      .where(eq(organisations.id, org.id))
      .returning();
    const changed = Object.keys(patch).filter(
      (k) =>
        JSON.stringify((org as Record<string, unknown>)[k]) !==
        JSON.stringify((patch as Record<string, unknown>)[k]),
    );
    if (changed.length) {
      await logActivity(db, {
        organisationId: org.id,
        userId: user.id,
        type:
          patch.doNotContact !== undefined && patch.doNotContact !== org.doNotContact
            ? 'do_not_contact_changed'
            : 'organisation_updated',
        payload: { fields: changed, doNotContact: patch.doNotContact },
      });
    }
    res.json(updated);
  });

  r.post('/organisations/:id/stage', canEdit, async (req, res) => {
    const user = currentUser(req);
    const org = await getOrg(db, idParam(req));
    const body = parseBody(stageChangeSchema, req);
    await setOrgStage(db, org, body.stage, user.id, { lostReason: body.lostReason });
    res.json(await getOrg(db, org.id));
  });

  r.put('/organisations/:id/follow-up', canEdit, async (req, res) => {
    const user = currentUser(req);
    const org = await getOrg(db, idParam(req));
    const body = parseBody(followUpDateSchema, req);
    const value = body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null;
    await db.update(organisations).set({ nextFollowUpAt: value }).where(eq(organisations.id, org.id));
    await logActivity(db, {
      organisationId: org.id,
      userId: user.id,
      type: 'follow_up_set',
      payload: { from: org.nextFollowUpAt, to: value },
    });
    res.json(await getOrg(db, org.id));
  });

  r.get('/organisations/:id/activities', async (req, res) => {
    const id = idParam(req);
    const rows = await db
      .select({
        id: activities.id,
        type: activities.type,
        payload: activities.payload,
        createdAt: activities.createdAt,
        userId: activities.userId,
        userName: profiles.fullName,
      })
      .from(activities)
      .leftJoin(profiles, eq(profiles.id, activities.userId))
      .where(eq(activities.organisationId, id))
      .orderBy(desc(activities.createdAt))
      .limit(500);
    res.json(rows);
  });

  r.post('/organisations/:id/activities', canEdit, async (req, res) => {
    const user = currentUser(req);
    const org = await getOrg(db, idParam(req));
    const body = parseBody(activityCreateSchema, req);
    await logActivity(db, {
      organisationId: org.id,
      userId: user.id,
      type: body.type,
      payload: {
        body: body.body,
        occurredAt: body.occurredAt ? new Date(body.occurredAt).toISOString() : null,
      },
    });
    // Touch updated_at so lists sort by recent work.
    await db.update(organisations).set({ updatedAt: new Date() }).where(eq(organisations.id, org.id));
    res.status(201).json({ ok: true });
  });

  return r;
}
