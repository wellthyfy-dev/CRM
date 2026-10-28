import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Pencil, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/AppShell';
import { ConfirmDialog, EmptyState, ExternalLink, IstDate, KeyValue } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import type { ApprovalItem } from '@/lib/types';

export function ApprovalsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [rejecting, setRejecting] = React.useState<ApprovalItem | null>(null);
  const [reason, setReason] = React.useState('');
  const list = useQuery({ queryKey: ['approvals'], queryFn: () => api<ApprovalItem[]>('/api/approvals') });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['approvals'] });
    void qc.invalidateQueries({ queryKey: ['emails'] });
  };
  const approve = useMutation({
    mutationFn: (id: string) => api(`/api/emails/${id}/approve`, { body: {} }),
    onSuccess: () => {
      refresh();
      toast('Approved');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const reject = useMutation({
    mutationFn: ({ id, reason: r }: { id: string; reason: string }) =>
      api(`/api/emails/${id}/reject`, { body: { reason: r } }),
    onSuccess: () => {
      refresh();
      setRejecting(null);
      setReason('');
      toast('Returned to draft');
    },
  });
  const bulk = useMutation({
    mutationFn: (ids: string[]) =>
      api<{ approved: number; results: { id: string; ok: boolean; reasons?: string[] }[] }>(
        '/api/emails/bulk-approve',
        {
          body: { ids },
        },
      ),
    onSuccess: (r) => {
      refresh();
      setSelected(new Set());
      setBulkOpen(false);
      const failed = r.results.filter((x) => !x.ok);
      toast(
        `Approved ${r.approved}${failed.length ? `; ${failed.length} blocked: ${failed.map((f) => f.reasons?.join(', ')).join(' | ')}` : ''}`,
        failed.length ? 'error' : 'success',
      );
    },
  });
  const items = list.data ?? [];
  const chosen = items.filter((i) => selected.has(i.email.id));

  return (
    <div>
      <PageHeader
        title="Approvals"
        description="Nothing is emailed without your approval. Review each email beside its contact, source and research."
        actions={
          <Button disabled={selected.size === 0} onClick={() => setBulkOpen(true)}>
            Approve selected ({selected.size})
          </Button>
        }
      />
      {items.length === 0 && <EmptyState>No emails are waiting for approval.</EmptyState>}
      <div className="grid gap-4">
        {items.map((item) => (
          <Card key={item.email.id} data-testid="approval-item">
            <CardContent className="grid gap-4 pt-4 lg:grid-cols-[1fr_380px]">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label="Select for bulk approval"
                    checked={selected.has(item.email.id)}
                    onChange={(e) =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(item.email.id);
                        else n.delete(item.email.id);
                        return n;
                      })
                    }
                  />
                  <Link href={`/emails/${item.email.id}`} className="font-semibold hover:underline">
                    {item.email.subject}
                  </Link>
                  {item.email.followUpNo > 0 && (
                    <Badge variant="info">follow-up {item.email.followUpNo}</Badge>
                  )}
                  {item.email.kind === 'proposal' && <Badge variant="info">proposal</Badge>}
                </div>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 font-sans text-sm">
                  {item.email.body}
                </pre>
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => approve.mutate(item.email.id)}
                    disabled={approve.isPending}
                  >
                    <CheckCircle2 /> Approve
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/emails/${item.email.id}`}>
                      <Pencil /> Edit
                    </Link>
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRejecting(item)}>
                    <XCircle /> Reject
                  </Button>
                </div>
              </div>
              <div className="text-sm">
                <KeyValue label="Organisation">
                  <Link className="hover:underline" href={`/organisations/${item.organisation.id}`}>
                    {item.organisation.recordId} {item.organisation.name}
                  </Link>
                </KeyValue>
                <KeyValue label="Contact">
                  {item.contact?.fullName} — {item.contact?.designation}
                </KeyValue>
                <KeyValue label="Email">{item.contact?.email}</KeyValue>
                <KeyValue label="Source URL">
                  <ExternalLink href={item.contact?.sourceUrl} />
                </KeyValue>
                <KeyValue label="Verified">
                  {item.contact?.verified ? (
                    <IstDate value={item.contact.verifiedAt} />
                  ) : (
                    <Badge variant="danger">no</Badge>
                  )}
                </KeyValue>
                <KeyValue label="Training need">{item.research?.trainingNeed}</KeyValue>
                <KeyValue label="Programme">{item.research?.programmeName}</KeyValue>
                <KeyValue label="Personalisation">{item.research?.personalisationNote}</KeyValue>
                <KeyValue label="Submitted">
                  {item.submittedByName} <IstDate value={item.email.submittedAt} />
                </KeyValue>
                {item.warnings.map((w) => (
                  <p key={w} className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
                    ⚠ {w}
                  </p>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <ConfirmDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title={`Approve ${chosen.length} emails?`}
        description="Each email is checked individually against the send gate."
        confirmLabel="Approve all listed"
        busy={bulk.isPending}
        onConfirm={() => bulk.mutate(chosen.map((c) => c.email.id))}
      >
        <ul className="max-h-80 overflow-auto text-sm">
          {chosen.map((c) => (
            <li key={c.email.id} className="border-b py-2">
              <div className="font-medium">{c.email.subject}</div>
              <div className="text-xs text-muted-foreground">
                {c.contact?.email} · {c.organisation.name}
              </div>
              <pre className="mt-1 line-clamp-4 whitespace-pre-wrap font-sans text-xs">{c.email.body}</pre>
            </li>
          ))}
        </ul>
      </ConfirmDialog>
      <ConfirmDialog
        open={!!rejecting}
        onOpenChange={(o) => !o && setRejecting(null)}
        title="Reject email"
        confirmLabel="Reject"
        destructive
        busy={!reason.trim() || reject.isPending}
        onConfirm={() => rejecting && reject.mutate({ id: rejecting.email.id, reason })}
      >
        <Input autoFocus placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}
