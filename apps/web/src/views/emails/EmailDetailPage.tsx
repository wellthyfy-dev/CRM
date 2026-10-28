import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Send, XCircle } from 'lucide-react';
import {
  ConfirmDialog,
  EmailStatusBadge,
  ErrorMessage,
  ExternalLink,
  IstDate,
  KeyValue,
} from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useRole } from '@/lib/auth';
import type { EmailDetail } from '@/lib/types';

export function GatePanel({ gate }: { gate: EmailDetail['gate'] }) {
  if (!gate) return null;
  if (gate.failures.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-emerald-50 p-2 text-sm text-emerald-800">
        <CheckCircle2 className="h-4 w-4" /> All send-gate checks pass.
      </div>
    );
  }
  return (
    <div className="grid gap-1 rounded-md bg-amber-50 p-2 text-sm text-amber-900">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4" /> Send gate
      </div>
      <ul className="list-disc pl-5 text-xs">
        {gate.failures.map((f) => (
          <li key={f.code}>
            {f.message}
            {!gate.blocking.some((b) => b.code === f.code) && ' (timing — the queue waits for this)'}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EmailDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const { canEdit, isAdmin } = useRole();
  const { data, error } = useQuery({
    queryKey: ['email', id],
    queryFn: () => api<EmailDetail>(`/api/emails/${id}`),
  });
  const [editing, setEditing] = React.useState(false);
  const [subject, setSubject] = React.useState('');
  const [body, setBody] = React.useState('');
  const [rejecting, setRejecting] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [confirmSend, setConfirmSend] = React.useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['email', id] });
    void qc.invalidateQueries({ queryKey: ['emails'] });
    void qc.invalidateQueries({ queryKey: ['approvals'] });
  };
  const act = useMutation({
    mutationFn: ({ path, body: b, method }: { path: string; body?: unknown; method?: string }) =>
      api(`/api/emails/${id}${path}`, { method: method ?? 'POST', body: b ?? {} }),
    onSuccess: (_d, v) => {
      refresh();
      setEditing(false);
      setRejecting(false);
      setConfirmSend(false);
      toast(
        {
          '': 'Saved',
          '/submit': 'Submitted for approval',
          '/approve': 'Approved — Titan draft will be created',
          '/reject': 'Returned to draft',
          '/cancel': 'Cancelled',
          '/send': 'Queued for sending',
        }[v.path] ?? 'Done',
      );
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  if (error) return <ErrorMessage error={error} />;
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const { email, contact, organisation } = data;
  const canEditNow =
    (canEdit && email.status === 'draft') || (isAdmin && email.status === 'pending_approval');

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">
            <Link className="hover:underline" href={`/organisations/${organisation.id}`}>
              {organisation.recordId} {organisation.name}
            </Link>
          </div>
          <h1 className="text-xl font-semibold">{email.subject}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm">
            <EmailStatusBadge status={email.status} />
            <span className="text-muted-foreground">
              {email.kind.replace(/_/g, ' ')}
              {email.followUpNo > 0 && ` #${email.followUpNo}`}
            </span>
            {data.template && (
              <Badge variant="outline">
                {data.template.key} v{email.templateVersion}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEditNow && !editing && (
            <Button
              variant="outline"
              onClick={() => {
                setSubject(email.subject);
                setBody(email.body);
                setEditing(true);
              }}
            >
              Edit
            </Button>
          )}
          {canEdit && email.status === 'draft' && (
            <Button onClick={() => act.mutate({ path: '/submit' })}>Submit for approval</Button>
          )}
          {isAdmin && ['draft', 'pending_approval'].includes(email.status) && (
            <Button onClick={() => act.mutate({ path: '/approve' })} data-testid="approve-email">
              <CheckCircle2 /> Approve
            </Button>
          )}
          {isAdmin && ['pending_approval', 'approved'].includes(email.status) && (
            <Button variant="outline" onClick={() => setRejecting(true)}>
              <XCircle /> Reject
            </Button>
          )}
          {isAdmin && email.status === 'approved' && (
            <Button onClick={() => setConfirmSend(true)}>
              <Send /> Send
            </Button>
          )}
          {((canEdit && email.status === 'draft') ||
            (isAdmin && ['pending_approval', 'approved', 'queued', 'failed'].includes(email.status))) && (
            <Button variant="ghost" onClick={() => act.mutate({ path: '/cancel' })}>
              Cancel email
            </Button>
          )}
        </div>
      </div>

      {email.rejectionReason && email.status === 'draft' && (
        <div className="rounded-md bg-amber-50 p-2 text-sm text-amber-900">
          Rejected: {email.rejectionReason}
        </div>
      )}
      {email.gateFailureReason && (
        <div className="rounded-md bg-red-50 p-2 text-sm text-red-800">Gate: {email.gateFailureReason}</div>
      )}
      {email.error && (
        <div className="rounded-md bg-red-50 p-2 text-sm text-red-800">Error: {email.error}</div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle>Message</CardTitle>
          </CardHeader>
          <CardContent>
            {editing ? (
              <div className="grid gap-3">
                <Field label="Subject">
                  <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
                </Field>
                <Field label="Body">
                  <Textarea
                    className="min-h-[360px] font-mono text-xs"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                </Field>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                  <Button onClick={() => act.mutate({ path: '', method: 'PATCH', body: { subject, body } })}>
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <pre className="whitespace-pre-wrap font-sans text-sm" data-testid="email-body">
                {email.body}
              </pre>
            )}
          </CardContent>
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Recipient</CardTitle>
            </CardHeader>
            <CardContent>
              <KeyValue label="Name">{contact?.fullName}</KeyValue>
              <KeyValue label="Designation">{contact?.designation}</KeyValue>
              <KeyValue label="Email">{contact?.email}</KeyValue>
              <KeyValue label="Source">
                <ExternalLink href={contact?.sourceUrl} />
              </KeyValue>
              <KeyValue label="Verified">{contact?.verified ? 'Yes' : 'No'}</KeyValue>
              <KeyValue label="Email check">{contact?.emailCheckStatus}</KeyValue>
              {data.warnings.map((w) => (
                <p key={w} className="text-xs text-amber-700">
                  ⚠ {w}
                </p>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <GatePanel gate={data.gate} />
              <KeyValue label="Approved">
                <IstDate value={email.approvedAt} />
              </KeyValue>
              <KeyValue label="Queued">
                <IstDate value={email.queuedAt} />
              </KeyValue>
              <KeyValue label="Sent">
                <IstDate value={email.sentAt} />
              </KeyValue>
              <KeyValue label="Titan draft">
                {email.imapDraftUid ? `uid ${email.imapDraftUid}` : '—'}
              </KeyValue>
              <KeyValue label="Message-ID">
                <span className="font-mono text-[11px]">{email.messageId ?? '—'}</span>
              </KeyValue>
            </CardContent>
          </Card>
          {data.thread.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle>Thread</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-1 text-sm">
                {data.thread.map((t) => (
                  <Link
                    key={t.id}
                    href={`/emails/${t.id}`}
                    className={t.id === email.id ? 'font-semibold' : 'hover:underline'}
                  >
                    {t.kind.replace(/_/g, ' ')} · {t.status} · <IstDate value={t.sentAt} />
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title="Reject email"
        description="The email goes back to draft with your reason."
        confirmLabel="Reject"
        destructive
        busy={!reason.trim() || act.isPending}
        onConfirm={() => act.mutate({ path: '/reject', body: { reason } })}
      >
        <Input autoFocus placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmSend}
        onOpenChange={setConfirmSend}
        title="Queue this email for sending?"
        description={`To ${contact?.email}. The worker sends within the send window and caps, re-checking the gate immediately before SMTP.`}
        confirmLabel="Queue for sending"
        busy={act.isPending}
        onConfirm={() => act.mutate({ path: '/send' })}
      />
    </div>
  );
}
