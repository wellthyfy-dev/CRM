import { Router } from 'express';
import { eq, not, sql } from 'drizzle-orm';
import { computeReports, SEGMENT_LABELS, STAGE_LABELS, type Segment, type Stage } from '@wellthyfy/shared';
import {
  activities,
  emails,
  organisations,
  proposals,
  replies,
  templates,
  type Db,
} from '@wellthyfy/shared/server';
import type { RouteDeps } from '../app';
import { badRequest } from '../lib/errors';
import { toCsv } from '../lib/http';

async function loadReports(db: Db) {
  const orgs = await db
    .select({
      id: organisations.id,
      segment: organisations.segment,
      orgType: organisations.orgType,
      city: organisations.city,
      district: organisations.district,
      stage: organisations.stage,
      createdAt: organisations.createdAt,
    })
    .from(organisations)
    .where(not(sql`${organisations.recordId} ilike 'SAMPLE-%'`));
  const changes = await db
    .select({
      organisationId: activities.organisationId,
      payload: activities.payload,
      at: activities.createdAt,
    })
    .from(activities)
    .where(eq(activities.type, 'stage_changed'));
  const emailRows = await db
    .select({
      id: emails.id,
      organisationId: emails.organisationId,
      templateKey: templates.key,
      kind: emails.kind,
      status: emails.status,
      sentAt: emails.sentAt,
      threadId: emails.threadId,
    })
    .from(emails)
    .leftJoin(templates, eq(templates.id, emails.templateId));
  const replyRows = await db
    .select({
      emailId: replies.emailId,
      organisationId: replies.organisationId,
      classification: replies.classification,
      receivedAt: replies.receivedAt,
    })
    .from(replies);
  const proposalRows = await db
    .select({
      organisationId: proposals.organisationId,
      status: proposals.status,
      valueInr: proposals.valueInr,
      createdAt: proposals.createdAt,
      sentAt: proposals.sentAt,
      decidedAt: proposals.decidedAt,
    })
    .from(proposals);
  return computeReports({
    organisations: orgs,
    stageChanges: changes
      .filter((c) => c.organisationId)
      .map((c) => ({
        organisationId: c.organisationId!,
        from: (c.payload as { from: Stage }).from,
        to: (c.payload as { to: Stage }).to,
        at: c.at,
      })),
    emails: emailRows,
    replies: replyRows,
    proposals: proposalRows,
  });
}

const SECTIONS = ['segment', 'city', 'template', 'month', 'stages'] as const;

export function reportRoutes({ db }: RouteDeps): Router {
  const r = Router();

  r.get('/reports', async (_req, res) => {
    res.json(await loadReports(db));
  });

  r.get('/reports/export.csv', async (req, res) => {
    const section = String(req.query.section ?? 'segment') as (typeof SECTIONS)[number];
    if (!SECTIONS.includes(section)) throw badRequest(`section must be one of ${SECTIONS.join(', ')}`);
    const rep = await loadReports(db);
    const funnelHeaders = [
      'Total',
      'Sent',
      'Replied',
      'Meetings',
      'Proposals',
      'Confirmed',
      'Reply rate %',
      'Win rate %',
    ];
    const funnel = (rows: typeof rep.bySegment, label: (k: string) => string) =>
      rows.map((x) => [
        label(x.key),
        x.total,
        x.sent,
        x.replied,
        x.meetings,
        x.proposals,
        x.confirmed,
        x.replyRate,
        x.winRate,
      ]);
    let csv: string;
    if (section === 'segment')
      csv = toCsv(
        ['Segment', ...funnelHeaders],
        funnel(rep.bySegment, (k) => SEGMENT_LABELS[k as Segment] ?? k),
      );
    else if (section === 'city')
      csv = toCsv(
        ['City / district', ...funnelHeaders],
        funnel(rep.byCity, (k) => k),
      );
    else if (section === 'template')
      csv = toCsv(
        ['Template', 'Sent', 'Replied', 'Reply rate %'],
        rep.byTemplate.map((x) => [x.key, x.sent, x.replied, x.replyRate]),
      );
    else if (section === 'month')
      csv = toCsv(
        [
          'Month',
          'New organisations',
          'Emails sent',
          'Replies',
          'Meetings',
          'Proposals sent',
          'Confirmed',
          'Confirmed value (INR)',
          'New pipeline value (INR)',
        ],
        rep.byMonth.map((x) => [
          x.month,
          x.organisations,
          x.sent,
          x.replies,
          x.meetings,
          x.proposalsSent,
          x.confirmed,
          x.confirmedValueInr,
          x.pipelineValueInr,
        ]),
      );
    else
      csv = toCsv(
        ['Stage', 'Average days', 'Samples'],
        rep.avgDaysPerStage.map((x) => [STAGE_LABELS[x.stage], x.avgDays, x.samples]),
      );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="report-${section}.csv"`);
    res.send(String.fromCharCode(0xfeff) + csv);
  });

  return r;
}
