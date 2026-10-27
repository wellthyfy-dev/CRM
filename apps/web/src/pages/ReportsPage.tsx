import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { SEGMENT_LABELS, STAGE_LABELS, type Reports, type Segment } from '@wellthyfy/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, apiDownload } from '@/lib/api';
import { inr } from './organisations/ProposalsTab';

type FunnelRow = Reports['bySegment'][number];

function ExportButton({ section }: { section: string }) {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => void apiDownload(`/api/reports/export.csv?section=${section}`, `report-${section}.csv`)}
    >
      <Download /> CSV
    </Button>
  );
}

function FunnelTable({ rows, label }: { rows: FunnelRow[]; label: (k: string) => string }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH />
          <TH className="text-right">Total</TH>
          <TH className="text-right">Sent</TH>
          <TH className="text-right">Replied</TH>
          <TH className="text-right">Meetings</TH>
          <TH className="text-right">Proposals</TH>
          <TH className="text-right">Confirmed</TH>
          <TH className="text-right">Reply %</TH>
          <TH className="text-right">Win %</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.key}>
            <TD>{label(r.key)}</TD>
            {[r.total, r.sent, r.replied, r.meetings, r.proposals, r.confirmed, r.replyRate, r.winRate].map(
              (v, i) => (
                <TD key={i} className="text-right tabular-nums">
                  {v}
                </TD>
              ),
            )}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function Rate({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

// Two-series monthly chart: categorical pair consistent with the dashboard split colours.
const SENT = '#0f766e';
const REPLIES = '#c2410c';

export function ReportsPage() {
  const { data } = useQuery({ queryKey: ['reports'], queryFn: () => api<Reports>('/api/reports') });
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const o = data.overall;
  return (
    <div className="grid gap-4">
      <PageHeader
        title="Reports"
        description="Funnel conversion counts each organisation by the furthest stage it has reached (SAMPLE- excluded)."
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Rate label="Reply rate" value={`${o.replyRate}%`} />
        <Rate label="Meeting rate" value={`${o.meetingRate}%`} />
        <Rate label="Proposal rate" value={`${o.proposalRate}%`} />
        <Rate label="Win rate" value={`${o.winRate}%`} />
        <Rate label="Proposal pipeline" value={inr(o.pipelineValueInr)} />
        <Rate label="Confirmed value" value={inr(o.confirmedValueInr)} />
      </div>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>By month (IST)</CardTitle>
          <ExportButton section="month" />
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={data.byMonth}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="sent" name="Emails sent" fill={SENT} radius={[4, 4, 0, 0]} />
                <Bar dataKey="replies" name="Replies" fill={REPLIES} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Table>
            <THead>
              <TR>
                <TH>Month</TH>
                <TH className="text-right">New orgs</TH>
                <TH className="text-right">Sent</TH>
                <TH className="text-right">Replies</TH>
                <TH className="text-right">Meetings</TH>
                <TH className="text-right">Proposals sent</TH>
                <TH className="text-right">Confirmed</TH>
                <TH className="text-right">Confirmed value</TH>
                <TH className="text-right">New pipeline</TH>
              </TR>
            </THead>
            <TBody>
              {data.byMonth.map((m) => (
                <TR key={m.month}>
                  <TD>{m.month}</TD>
                  {[m.organisations, m.sent, m.replies, m.meetings, m.proposalsSent, m.confirmed].map(
                    (v, i) => (
                      <TD key={i} className="text-right tabular-nums">
                        {v}
                      </TD>
                    ),
                  )}
                  <TD className="text-right">{inr(m.confirmedValueInr)}</TD>
                  <TD className="text-right">{inr(m.pipelineValueInr)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Funnel by segment</CardTitle>
          <ExportButton section="segment" />
        </CardHeader>
        <CardContent>
          <FunnelTable rows={data.bySegment} label={(k) => SEGMENT_LABELS[k as Segment] ?? k} />
        </CardContent>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Funnel by city / district</CardTitle>
            <ExportButton section="city" />
          </CardHeader>
          <CardContent>
            <FunnelTable rows={data.byCity.slice(0, 25)} label={(k) => k} />
          </CardContent>
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Templates (first contact)</CardTitle>
              <ExportButton section="template" />
            </CardHeader>
            <CardContent>
              <Table>
                <THead>
                  <TR>
                    <TH>Template</TH>
                    <TH className="text-right">Sent</TH>
                    <TH className="text-right">Replied</TH>
                    <TH className="text-right">Reply %</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.byTemplate.map((t) => (
                    <TR key={t.key}>
                      <TD>{t.key}</TD>
                      <TD className="text-right">{t.sent}</TD>
                      <TD className="text-right">{t.replied}</TD>
                      <TD className="text-right">{t.replyRate}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Average days per stage</CardTitle>
              <ExportButton section="stages" />
            </CardHeader>
            <CardContent>
              <Table>
                <TBody>
                  {data.avgDaysPerStage.map((s) => (
                    <TR key={s.stage}>
                      <TD>{STAGE_LABELS[s.stage]}</TD>
                      <TD className="text-right tabular-nums">{s.avgDays} days</TD>
                      <TD className="text-right text-xs text-muted-foreground">n={s.samples}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
