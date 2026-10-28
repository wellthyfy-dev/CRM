import Link from 'next/link';
import { useSearchParamsState } from '@/lib/router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { REPLY_CLASSIFICATIONS, type ReplyClassification } from '@wellthyfy/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { EmptyState, IstDate, Pagination } from '@/components/common';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { api, qs } from '@/lib/api';
import { useRole } from '@/lib/auth';
import type { Paged, ReplyJ } from '@/lib/types';

type ReplyRow = ReplyJ & {
  organisationName: string | null;
  contactName: string | null;
  emailSubject: string | null;
};

const VARIANT: Record<ReplyClassification, BadgeProps['variant']> = {
  interested: 'success',
  not_interested: 'secondary',
  unsubscribe: 'danger',
  out_of_office: 'outline',
  bounce: 'danger',
  other: 'info',
};

export function RepliesPage() {
  const [params, setParams] = useSearchParamsState();
  const qc = useQueryClient();
  const toast = useToast();
  const { canEdit } = useRole();
  const classification = params.get('classification') ?? '';
  const handled = params.get('handled') ?? 'false';
  const page = Number(params.get('page') ?? 1);
  const list = useQuery({
    queryKey: ['replies', classification, handled, page],
    queryFn: () => api<Paged<ReplyRow>>(`/api/replies${qs({ classification, handled, page })}`),
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api(`/api/replies/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['replies'] });
      toast('Reply updated');
    },
  });
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete('page');
    setParams(next, { replace: true });
  };
  return (
    <div>
      <PageHeader title="Replies" description="Detected from the Titan INBOX every 5 minutes (read-only)." />
      <div className="mb-3 flex gap-2">
        <Select
          className="w-48"
          value={classification}
          onChange={(e) => set('classification', e.target.value)}
          aria-label="Classification"
        >
          <option value="">All classifications</option>
          {REPLY_CLASSIFICATIONS.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
        <Select
          className="w-40"
          value={handled}
          onChange={(e) => set('handled', e.target.value)}
          aria-label="Handled"
        >
          <option value="false">Needs attention</option>
          <option value="true">Handled</option>
          <option value="">All</option>
        </Select>
      </div>
      {list.data?.items.length === 0 ? (
        <EmptyState>No replies.</EmptyState>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Received</TH>
              <TH>From</TH>
              <TH>Organisation</TH>
              <TH>Classification</TH>
              <TH>Summary / snippet</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {list.data?.items.map((r) => (
              <TR key={r.id}>
                <TD className="text-xs">
                  <IstDate value={r.receivedAt} />
                </TD>
                <TD className="text-xs">
                  <div>{r.contactName}</div>
                  <div className="text-muted-foreground">{r.fromEmail}</div>
                </TD>
                <TD className="text-xs">
                  {r.organisationId ? (
                    <Link href={`/organisations/${r.organisationId}`} className="hover:underline">
                      {r.organisationName}
                    </Link>
                  ) : (
                    '—'
                  )}
                </TD>
                <TD>
                  {canEdit ? (
                    <Select
                      className="h-8 w-40 text-xs"
                      value={r.classification}
                      aria-label="Change classification"
                      onChange={(e) => update.mutate({ id: r.id, body: { classification: e.target.value } })}
                    >
                      {REPLY_CLASSIFICATIONS.map((c) => (
                        <option key={c} value={c}>
                          {c.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Badge variant={VARIANT[r.classification]}>{r.classification.replace(/_/g, ' ')}</Badge>
                  )}
                </TD>
                <TD className="max-w-md text-xs">
                  {r.summary && <div className="font-medium">{r.summary}</div>}
                  <div className="text-muted-foreground">{r.snippet}</div>
                  {r.emailId && (
                    <Link href={`/emails/${r.emailId}`} className="text-primary hover:underline">
                      Re: {r.emailSubject}
                    </Link>
                  )}
                </TD>
                <TD className="text-right">
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => update.mutate({ id: r.id, body: { handled: !r.handled } })}
                    >
                      {r.handled ? 'Reopen' : 'Mark handled'}
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {list.data && (
        <Pagination
          page={page}
          pageSize={list.data.pageSize}
          total={list.data.total}
          onPage={(p) => set('page', String(p))}
        />
      )}
    </div>
  );
}
