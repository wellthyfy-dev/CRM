import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { SEGMENT_LABELS, STAGE_LABELS, type Segment, type Stage } from '@wellthyfy/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { IstDate, StageBadge } from '@/components/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, qs } from '@/lib/api';
import { useRole } from '@/lib/auth';
import type { OrganisationRow, Paged } from '@/lib/types';

interface Dashboard {
  totals: Record<
    | 'organisations'
    | 'verifiedContacts'
    | 'approved'
    | 'drafted'
    | 'sent'
    | 'replied'
    | 'meetings'
    | 'proposals'
    | 'confirmed'
    | 'lost',
    number
  >;
  emails: { pendingApproval: number; sent: number; titanDrafts: number };
  replies: { total: number; unhandled: number };
  followUps: { dueToday: number; overdue: number };
  funnel: { stage: Stage; count: number }[];
  split: {
    byType: { college_university: number; company: number };
    bySegment: { segment: Segment; orgType: string; count: number }[];
  };
}

const TILES: { key: keyof Dashboard['totals']; label: string }[] = [
  { key: 'organisations', label: 'Organisations' },
  { key: 'verifiedContacts', label: 'Verified contacts' },
  { key: 'approved', label: 'Approved' },
  { key: 'drafted', label: 'Drafted' },
  { key: 'sent', label: 'Sent' },
  { key: 'replied', label: 'Replied' },
  { key: 'meetings', label: 'Meetings' },
  { key: 'proposals', label: 'Proposals' },
  { key: 'confirmed', label: 'Confirmed' },
];

// Single-hue sequential scale for the funnel; two categorical hues for the college/company split.
const PRIMARY = '#0f766e';
const SPLIT_COLORS = ['#0f766e', '#c2410c'];

function FollowUpList({ due }: { due: 'today' | 'overdue' }) {
  const q = useQuery({
    queryKey: ['organisations', { due }],
    queryFn: () =>
      api<Paged<OrganisationRow>>(
        `/api/organisations${qs({ due, pageSize: 10, sort: 'next_follow_up_at', dir: 'asc' })}`,
      ),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{due === 'today' ? 'Due today' : 'Overdue'}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1 text-sm">
        {q.data?.items.length === 0 && (
          <p className="text-muted-foreground">Nothing {due === 'today' ? 'due today' : 'overdue'}.</p>
        )}
        {q.data?.items.map((o) => (
          <div key={o.id} className="flex items-center justify-between gap-2">
            <Link to={`/organisations/${o.id}`} className="truncate text-primary hover:underline">
              {o.name}
            </Link>
            <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              <StageBadge stage={o.stage} />
              <IstDate value={o.nextFollowUpAt} time={false} />
            </span>
          </div>
        ))}
        {(q.data?.total ?? 0) > 10 && (
          <Link className="text-xs text-primary hover:underline" to={`/organisations?due=${due}`}>
            View all {q.data?.total}
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { isAdmin } = useRole();
  const { data } = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/api/dashboard') });
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const funnel = data.funnel
    .filter((f) => !['lost', 'on_hold'].includes(f.stage))
    .map((f) => ({ ...f, label: STAGE_LABELS[f.stage] }));
  const split = [
    { name: 'Colleges / universities', value: data.split.byType.college_university },
    { name: 'Companies', value: data.split.byType.company },
  ];
  const segments = [...data.split.bySegment]
    .sort((a, b) => b.count - a.count)
    .map((s) => ({ ...s, label: SEGMENT_LABELS[s.segment] }));

  return (
    <div className="grid gap-4">
      <PageHeader title="Dashboard" description="Outreach at a glance (SAMPLE- records excluded)" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-9">
        {TILES.map((t) => (
          <Card key={t.key}>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">{t.label}</div>
              <div className="text-2xl font-semibold tabular-nums" data-testid={`tile-${t.key}`}>
                {data.totals[t.key]}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        {isAdmin && (
          <Link to="/approvals" className="rounded-md border bg-card px-3 py-2 hover:bg-accent">
            {data.emails.pendingApproval} awaiting approval
          </Link>
        )}
        <Link to="/replies" className="rounded-md border bg-card px-3 py-2 hover:bg-accent">
          {data.replies.unhandled} replies need attention
        </Link>
        <Link to="/organisations?due=today" className="rounded-md border bg-card px-3 py-2 hover:bg-accent">
          {data.followUps.dueToday} follow-ups due today
        </Link>
        <Link to="/organisations?due=overdue" className="rounded-md border bg-card px-3 py-2 hover:bg-accent">
          {data.followUps.overdue} overdue
        </Link>
      </div>
      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Organisations by current stage</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer>
              <BarChart data={funnel} layout="vertical" margin={{ left: 40 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} />
                <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" fill={PRIMARY} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Colleges vs companies</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={split} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} label>
                  {split.map((_s, i) => (
                    <Cell key={i} fill={SPLIT_COLORS[i]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-4 text-xs">
              {split.map((s, i) => (
                <span key={s.name} className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full" style={{ background: SPLIT_COLORS[i] }} /> {s.name}:{' '}
                  {s.value}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <FollowUpList due="today" />
        <FollowUpList due="overdue" />
        <Card>
          <CardHeader>
            <CardTitle>By segment</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            {segments.map((s) => (
              <div key={s.segment} className="flex justify-between">
                <span>{s.label}</span>
                <span className="tabular-nums">{s.count}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
