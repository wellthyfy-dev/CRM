import { STAGES, stageRank, type ReplyClassification, type Segment, type Stage } from './constants';
import { istMonthKey } from './time';

// Report computations over plain rows (pure, unit-tested). Data volumes are small (thousands of organisations).

export interface ReportInput {
  organisations: {
    id: string;
    segment: Segment;
    orgType: string;
    city: string | null;
    district: string | null;
    stage: Stage;
    createdAt: Date;
  }[];
  stageChanges: { organisationId: string; from: Stage; to: Stage; at: Date }[];
  emails: {
    id: string;
    organisationId: string;
    templateKey: string | null;
    kind: string;
    status: string;
    sentAt: Date | null;
    threadId: string | null;
  }[];
  replies: {
    emailId: string | null;
    organisationId: string | null;
    classification: ReplyClassification;
    receivedAt: Date;
  }[];
  proposals: {
    organisationId: string;
    status: string;
    valueInr: number | null;
    createdAt: Date;
    sentAt: Date | null;
    decidedAt: Date | null;
  }[];
}

const FUNNEL: Stage[] = ['sent', 'replied', 'meeting_scheduled', 'proposal_sent', 'training_confirmed'];
const REAL_REPLY = (c: ReplyClassification) => c !== 'bounce' && c !== 'out_of_office';

export interface FunnelRow {
  key: string;
  total: number;
  sent: number;
  replied: number;
  meetings: number;
  proposals: number;
  confirmed: number;
  replyRate: number;
  winRate: number;
}

const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

/** Highest funnel rank each organisation has ever reached (current stage or any stage in its history). */
export function reachedRanks(input: ReportInput): Map<string, number> {
  const reached = new Map<string, number>();
  for (const o of input.organisations) reached.set(o.id, stageRank(o.stage));
  for (const c of input.stageChanges) {
    const prev = reached.get(c.organisationId);
    if (prev === undefined) continue;
    reached.set(c.organisationId, Math.max(prev, stageRank(c.to), stageRank(c.from)));
  }
  return reached;
}

function funnelRow(key: string, ids: string[], reached: Map<string, number>): FunnelRow {
  const count = (s: Stage) => ids.filter((id) => (reached.get(id) ?? -1) >= stageRank(s)).length;
  const [sent, replied, meetings, proposals, confirmed] = FUNNEL.map(count) as [
    number,
    number,
    number,
    number,
    number,
  ];
  return {
    key,
    total: ids.length,
    sent,
    replied,
    meetings,
    proposals,
    confirmed,
    replyRate: rate(replied, sent),
    winRate: rate(confirmed, proposals),
  };
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return m;
}

export function computeReports(input: ReportInput) {
  const reached = reachedRanks(input);
  const allIds = input.organisations.map((o) => o.id);
  const overall = funnelRow('all', allIds, reached);

  const bySegment = [...groupBy(input.organisations, (o) => o.segment)].map(([k, rows]) =>
    funnelRow(
      k,
      rows.map((r) => r.id),
      reached,
    ),
  );
  const byCity = [
    ...groupBy(input.organisations, (o) => [o.city, o.district].filter(Boolean).join(' / ') || '(unknown)'),
  ]
    .map(([k, rows]) =>
      funnelRow(
        k,
        rows.map((r) => r.id),
        reached,
      ),
    )
    .sort((a, b) => b.total - a.total);

  // Template performance: first-contact emails that were sent, and whether their thread got a real reply.
  const repliedThreads = new Set<string>();
  const emailById = new Map(input.emails.map((e) => [e.id, e]));
  for (const r of input.replies) {
    if (!r.emailId || !REAL_REPLY(r.classification)) continue;
    const e = emailById.get(r.emailId);
    if (e) repliedThreads.add(e.threadId ?? e.id);
  }
  const firstSent = input.emails.filter((e) => e.kind === 'first_contact' && e.sentAt);
  const byTemplate = [...groupBy(firstSent, (e) => e.templateKey ?? '(none)')].map(([k, rows]) => {
    const replied = rows.filter((e) => repliedThreads.has(e.threadId ?? e.id)).length;
    return { key: k, sent: rows.length, replied, replyRate: rate(replied, rows.length) };
  });

  // Monthly activity (IST months).
  const months = new Map<
    string,
    {
      month: string;
      organisations: number;
      sent: number;
      replies: number;
      meetings: number;
      proposalsSent: number;
      confirmed: number;
      confirmedValueInr: number;
      pipelineValueInr: number;
    }
  >();
  const m = (d: Date) => {
    const key = istMonthKey(d);
    if (!months.has(key)) {
      months.set(key, {
        month: key,
        organisations: 0,
        sent: 0,
        replies: 0,
        meetings: 0,
        proposalsSent: 0,
        confirmed: 0,
        confirmedValueInr: 0,
        pipelineValueInr: 0,
      });
    }
    return months.get(key)!;
  };
  for (const o of input.organisations) m(o.createdAt).organisations++;
  for (const e of input.emails) if (e.sentAt) m(e.sentAt).sent++;
  for (const r of input.replies) if (REAL_REPLY(r.classification)) m(r.receivedAt).replies++;
  for (const c of input.stageChanges) {
    if (c.to === 'meeting_scheduled') m(c.at).meetings++;
    if (c.to === 'training_confirmed') m(c.at).confirmed++;
  }
  for (const p of input.proposals) {
    if (p.sentAt) m(p.sentAt).proposalsSent++;
    if (p.status === 'accepted' && p.decidedAt) m(p.decidedAt).confirmedValueInr += Number(p.valueInr ?? 0);
    if (p.status === 'draft' || p.status === 'sent')
      m(p.createdAt).pipelineValueInr += Number(p.valueInr ?? 0);
  }
  const byMonth = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));

  // Average days spent in each stage (completed stays only).
  const changesByOrg = groupBy(input.stageChanges, (c) => c.organisationId);
  const durations = new Map<Stage, number[]>();
  for (const o of input.organisations) {
    const changes = (changesByOrg.get(o.id) ?? []).sort((a, b) => a.at.getTime() - b.at.getTime());
    let enteredAt = o.createdAt;
    for (const c of changes) {
      const days = (c.at.getTime() - enteredAt.getTime()) / 86400000;
      durations.set(c.from, [...(durations.get(c.from) ?? []), days]);
      enteredAt = c.at;
    }
  }
  const avgDaysPerStage = STAGES.filter((s) => durations.has(s)).map((s) => {
    const xs = durations.get(s)!;
    return {
      stage: s,
      avgDays: Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10,
      samples: xs.length,
    };
  });

  const pipelineValueInr = input.proposals
    .filter((p) => p.status === 'draft' || p.status === 'sent')
    .reduce((a, p) => a + Number(p.valueInr ?? 0), 0);
  const confirmedValueInr = input.proposals
    .filter((p) => p.status === 'accepted')
    .reduce((a, p) => a + Number(p.valueInr ?? 0), 0);

  return {
    overall: {
      ...overall,
      meetingRate: rate(overall.meetings, overall.sent),
      proposalRate: rate(overall.proposals, overall.sent),
      pipelineValueInr,
      confirmedValueInr,
    },
    bySegment,
    byCity,
    byTemplate,
    byMonth,
    avgDaysPerStage,
  };
}

export type Reports = ReturnType<typeof computeReports>;
