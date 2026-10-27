import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, Send } from 'lucide-react';
import { PageHeader } from '@/components/layout/AppShell';
import { EmptyState, IstDate } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface QueueStatus {
  queued: {
    id: string;
    subject: string;
    kind: string;
    followUpNo: number;
    queuedAt: string | null;
    scheduledFor: string | null;
    sendAttempts: number;
    error: string | null;
    gateFailureReason: string | null;
    organisationId: string;
    organisationName: string;
    contactEmail: string | null;
  }[];
  sentToday: number;
  sentThisHour: number;
  dailyCap: number;
  hourlyCap: number;
  remainingToday: number;
  remainingThisHour: number;
  paused: boolean;
  pausedUntil: string | null;
  pauseReason: string | null;
  nextSendAfter: string | null;
  nextWindow: string | null;
  window: { start: string; end: string; days: string[] };
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export function QueuePage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { emailMode } = useAuth();
  const q = useQuery({
    queryKey: ['queue'],
    queryFn: () => api<QueueStatus>('/api/queue'),
    refetchInterval: 15_000,
  });
  const act = useMutation({
    mutationFn: (path: string) => api<QueueStatus | { queued: number }>(path, { body: {} }),
    onSuccess: (r, path) => {
      void qc.invalidateQueries({ queryKey: ['queue'] });
      void qc.invalidateQueries({ queryKey: ['emails'] });
      if (path.endsWith('send-approved')) toast(`Queued ${(r as { queued: number }).queued} approved emails`);
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const d = q.data;
  return (
    <div className="grid gap-4">
      <PageHeader
        title="Send queue"
        description={
          d
            ? `One email at a time, 60–180 s apart, ${d.window.start}–${d.window.end} IST on ${d.window.days.join(', ')}. The send gate re-runs right before each send.`
            : undefined
        }
        actions={
          <>
            <Button variant="outline" onClick={() => act.mutate('/api/emails/send-approved')}>
              <Send /> Queue all approved
            </Button>
            {d?.paused ? (
              <Button onClick={() => act.mutate('/api/queue/resume')}>
                <Play /> Resume
              </Button>
            ) : (
              <Button variant="outline" onClick={() => act.mutate('/api/queue/pause')}>
                <Pause /> Pause
              </Button>
            )}
          </>
        }
      />
      {emailMode === 'dry_run' && (
        <div className="rounded-md bg-sky-50 p-2 text-sm text-sky-900">
          EMAIL_MODE is dry_run: sends are logged, nothing is really emailed.
        </div>
      )}
      {d?.paused && (
        <div className="rounded-md bg-amber-50 p-2 text-sm text-amber-900">
          Paused
          {d.pausedUntil && (
            <>
              {' '}
              until <IstDate value={d.pausedUntil} />
            </>
          )}
          : {d.pauseReason}
        </div>
      )}
      {d && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Queued" value={d.queued.length} />
          <Stat label="Sent today" value={d.sentToday} sub={`cap ${d.dailyCap}`} />
          <Stat label="Remaining today" value={d.remainingToday} />
          <Stat label="Sent this hour" value={d.sentThisHour} sub={`cap ${d.hourlyCap}`} />
          <Stat
            label="Next window"
            value={d.nextWindow ? '' : '—'}
            sub={
              d.nextWindow
                ? new Date(d.nextWindow).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
                : undefined
            }
          />
        </div>
      )}
      {d && d.queued.length === 0 ? (
        <EmptyState>
          Nothing queued. Approve emails, then press Send on each (or “Queue all approved”).
        </EmptyState>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Email</TH>
              <TH>To</TH>
              <TH>Queued</TH>
              <TH>Retry after</TH>
              <TH>Attempts</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {d?.queued.map((e) => (
              <TR key={e.id}>
                <TD>
                  <Link to={`/emails/${e.id}`} className="text-primary hover:underline">
                    {e.subject}
                  </Link>
                  {e.followUpNo > 0 && (
                    <Badge variant="info" className="ml-2">
                      follow-up {e.followUpNo}
                    </Badge>
                  )}
                  <div className="text-xs text-muted-foreground">{e.organisationName}</div>
                  {e.error && <div className="text-xs text-red-700">{e.error}</div>}
                  {e.gateFailureReason && <div className="text-xs text-amber-700">{e.gateFailureReason}</div>}
                </TD>
                <TD className="text-xs">{e.contactEmail}</TD>
                <TD className="text-xs">
                  <IstDate value={e.queuedAt} />
                </TD>
                <TD className="text-xs">
                  <IstDate value={e.scheduledFor} />
                </TD>
                <TD>{e.sendAttempts}</TD>
                <TD className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => act.mutate(`/api/emails/${e.id}/unqueue`)}>
                    Remove
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
