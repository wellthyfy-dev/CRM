import { Router } from 'express';
import { and, count, desc, eq, gte, isNotNull, lt, not, notInArray, sql, type SQL } from 'drizzle-orm';
import {
  addDays,
  orgTypeSchema,
  segmentSchema,
  STAGES,
  stageRank,
  startOfIstDay,
  type Stage,
} from '@wellthyfy/shared';
import { contacts, emails, organisations, proposals, replies } from '@wellthyfy/shared/server';
import type { RouteDeps } from '../app';

const notSample = not(sql`${organisations.recordId} ilike 'SAMPLE-%'`);

export function pipelineRoutes({ db, now }: RouteDeps): Router {
  const r = Router();

  r.get('/pipeline', async (req, res) => {
    const where: SQL[] = [];
    const orgType = orgTypeSchema.safeParse(req.query.orgType);
    const segment = segmentSchema.safeParse(req.query.segment);
    if (orgType.success) where.push(eq(organisations.orgType, orgType.data));
    if (segment.success) where.push(eq(organisations.segment, segment.data));
    if (typeof req.query.ownerId === 'string' && req.query.ownerId)
      where.push(eq(organisations.ownerId, req.query.ownerId));
    const rows = await db
      .select({
        id: organisations.id,
        recordId: organisations.recordId,
        name: organisations.name,
        segment: organisations.segment,
        orgType: organisations.orgType,
        city: organisations.city,
        stage: organisations.stage,
        nextFollowUpAt: organisations.nextFollowUpAt,
        doNotContact: organisations.doNotContact,
        primaryContact: sql<{
          fullName: string;
          designation: string | null;
          email: string | null;
        } | null>`(select json_build_object('fullName', c.full_name, 'designation', c.designation, 'email', c.email)
          from contacts c where c.organisation_id = ${organisations.id} order by c.is_primary desc, c.created_at asc limit 1)`,
        lastActivity: sql<{
          type: string;
          createdAt: string;
        } | null>`(select json_build_object('type', a.type, 'createdAt', a.created_at)
          from activities a where a.organisation_id = ${organisations.id} order by a.created_at desc limit 1)`,
      })
      .from(organisations)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(organisations.updatedAt))
      .limit(3000);
    const columns = STAGES.map((stage) => ({
      stage,
      items: rows.filter((o) => o.stage === stage).slice(0, 300),
    }));
    res.json({ columns, total: rows.length });
  });

  r.get('/dashboard', async (_req, res) => {
    const today = startOfIstDay(now());
    const byStage = await db
      .select({ stage: organisations.stage, n: count() })
      .from(organisations)
      .where(notSample)
      .groupBy(organisations.stage);
    const stageCount = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
    for (const row of byStage) stageCount[row.stage] = Number(row.n);
    const reached = (stage: Stage) =>
      STAGES.filter((s) => stageRank(s) >= stageRank(stage)).reduce((sum, s) => sum + stageCount[s], 0);

    const split = await db
      .select({ orgType: organisations.orgType, segment: organisations.segment, n: count() })
      .from(organisations)
      .where(notSample)
      .groupBy(organisations.orgType, organisations.segment);
    const [verified] = await db.select({ n: count() }).from(contacts).where(eq(contacts.verified, true));
    const emailStatus = await db
      .select({ status: emails.status, n: count() })
      .from(emails)
      .groupBy(emails.status);
    const [sentTotal] = await db.select({ n: count() }).from(emails).where(isNotNull(emails.sentAt));
    const [draftsInTitan] = await db
      .select({ n: count() })
      .from(emails)
      .where(isNotNull(emails.imapDraftUid));
    const [repliesTotal] = await db.select({ n: count() }).from(replies);
    const [repliesOpen] = await db.select({ n: count() }).from(replies).where(eq(replies.handled, false));
    const [proposalsTotal] = await db.select({ n: count() }).from(proposals);
    const open = notInArray(organisations.stage, ['training_confirmed', 'lost']);
    const [dueToday] = await db
      .select({ n: count() })
      .from(organisations)
      .where(
        and(
          open,
          gte(organisations.nextFollowUpAt, today),
          lt(organisations.nextFollowUpAt, addDays(today, 1)),
        ),
      );
    const [overdue] = await db
      .select({ n: count() })
      .from(organisations)
      .where(and(open, lt(organisations.nextFollowUpAt, today)));
    const statusMap = Object.fromEntries(emailStatus.map((x) => [x.status, Number(x.n)]));
    const total = Object.values(stageCount).reduce((a, b) => a + b, 0);

    res.json({
      totals: {
        organisations: total,
        verifiedContacts: Number(verified?.n ?? 0),
        approved: reached('approved'),
        drafted: reached('drafted'),
        sent: reached('sent'),
        replied: reached('replied'),
        meetings: reached('meeting_scheduled'),
        proposals: reached('proposal_sent'),
        confirmed: stageCount.training_confirmed,
        lost: stageCount.lost,
      },
      emails: {
        byStatus: statusMap,
        pendingApproval: statusMap.pending_approval ?? 0,
        sent: Number(sentTotal?.n ?? 0),
        titanDrafts: Number(draftsInTitan?.n ?? 0),
      },
      replies: { total: Number(repliesTotal?.n ?? 0), unhandled: Number(repliesOpen?.n ?? 0) },
      proposals: Number(proposalsTotal?.n ?? 0),
      followUps: { dueToday: Number(dueToday?.n ?? 0), overdue: Number(overdue?.n ?? 0) },
      funnel: STAGES.map((stage) => ({ stage, count: stageCount[stage] })),
      split: {
        byType: {
          college_university: split
            .filter((x) => x.orgType === 'college_university')
            .reduce((a, x) => a + Number(x.n), 0),
          company: split.filter((x) => x.orgType === 'company').reduce((a, x) => a + Number(x.n), 0),
        },
        bySegment: split.map((x) => ({ segment: x.segment, orgType: x.orgType, count: Number(x.n) })),
      },
    });
  });

  return r;
}
