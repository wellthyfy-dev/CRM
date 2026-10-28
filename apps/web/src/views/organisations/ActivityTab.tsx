import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MANUAL_ACTIVITY_TYPES, STAGE_LABELS, type ManualActivityType, type Stage } from '@wellthyfy/shared';
import { ErrorMessage, IstDate } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useRole } from '@/lib/auth';
import type { ActivityJ } from '@/lib/types';

/** Human-readable one-liner for an audit entry. */
export function describeActivity(a: ActivityJ): string {
  const p = a.payload as Record<string, unknown>;
  switch (a.type) {
    case 'note':
    case 'call':
    case 'meeting':
      return String(p.body ?? '');
    case 'stage_changed':
      return `Stage ${STAGE_LABELS[p.from as Stage] ?? p.from} → ${STAGE_LABELS[p.to as Stage] ?? p.to}${p.auto ? ` (auto: ${p.reason})` : ''}${p.lostReason ? ` — ${p.lostReason}` : ''}`;
    case 'email_drafted':
      return `Email drafted: ${p.subject}`;
    case 'email_submitted':
      return `Submitted for approval: ${p.subject}`;
    case 'email_approved':
      return `Approved: ${p.subject}`;
    case 'email_rejected':
      return `Rejected: ${p.reason}`;
    case 'email_sent':
      return `Sent${p.dryRun ? ' (dry run — not really sent)' : ''}: ${p.subject ?? ''}`;
    case 'titan_draft_created':
      return p.dryRun ? 'Titan draft skipped (dry run)' : `Titan draft created (uid ${p.uid})`;
    case 'reply_received':
      return `Reply received (${p.classification}): ${p.summary ?? p.subject ?? ''}`;
    case 'contact_opted_out':
      return `Contact opted out (${p.source})`;
    case 'follow_up_set':
      return 'Next follow-up date changed';
    default:
      return a.type.replace(/_/g, ' ');
  }
}

export function ActivityTab({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { canEdit } = useRole();
  const [type, setType] = React.useState<ManualActivityType>('note');
  const [body, setBody] = React.useState('');
  const [occurredAt, setOccurredAt] = React.useState('');
  const list = useQuery({
    queryKey: ['activities', orgId],
    queryFn: () => api<ActivityJ[]>(`/api/organisations/${orgId}/activities`),
  });
  const add = useMutation({
    mutationFn: () =>
      api(`/api/organisations/${orgId}/activities`, {
        body: { type, body, occurredAt: occurredAt ? new Date(occurredAt).toISOString() : undefined },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['activities', orgId] });
      setBody('');
      setOccurredAt('');
      toast('Added to timeline');
    },
  });
  return (
    <div className="grid gap-4">
      {canEdit && (
        <Card>
          <CardContent className="grid gap-2 pt-4">
            <div className="flex flex-wrap gap-2">
              <Select
                className="w-36"
                value={type}
                onChange={(e) => setType(e.target.value as ManualActivityType)}
                aria-label="Activity type"
              >
                {MANUAL_ACTIVITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t[0]!.toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </Select>
              {type !== 'note' && (
                <Input
                  type="datetime-local"
                  className="w-56"
                  aria-label="When"
                  value={occurredAt}
                  onChange={(e) => setOccurredAt(e.target.value)}
                />
              )}
            </div>
            <Textarea placeholder="What happened?" value={body} onChange={(e) => setBody(e.target.value)} />
            <ErrorMessage error={add.error} />
            <div className="flex justify-end">
              <Button disabled={!body.trim() || add.isPending} onClick={() => add.mutate()}>
                Add
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      <ol className="relative grid gap-3 border-l pl-4">
        {list.data?.map((a) => (
          <li key={a.id} className="text-sm">
            <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border bg-card" />
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={['note', 'call', 'meeting'].includes(a.type) ? 'info' : 'secondary'}>
                {a.type.replace(/_/g, ' ')}
              </Badge>
              <IstDate value={a.createdAt} />
              {a.userName && <span>· {a.userName}</span>}
              {(a.payload as { occurredAt?: string }).occurredAt && (
                <span>
                  · on <IstDate value={(a.payload as { occurredAt: string }).occurredAt} />
                </span>
              )}
            </div>
            <div className="whitespace-pre-wrap">{describeActivity(a)}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}
