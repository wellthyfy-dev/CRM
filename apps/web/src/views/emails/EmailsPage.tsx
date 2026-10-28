import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { EMAIL_STATUSES } from '@wellthyfy/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { EmailStatusBadge, EmptyState, IstDate, Pagination } from '@/components/common';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, qs } from '@/lib/api';
import type { EmailRow, Paged } from '@/lib/types';

export function EmailsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? 1);
  const [q, setQ] = React.useState(params.get('q') ?? '');
  const query = useQuery({
    queryKey: ['emails', { status, page, q: params.get('q') }],
    queryFn: () => api<Paged<EmailRow>>(`/api/emails${qs({ status, page, q: params.get('q') })}`),
    placeholderData: keepPreviousData,
  });
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  return (
    <div>
      <PageHeader title="Emails" description="All drafts, approvals and sends" />
      <div className="mb-3 flex flex-wrap gap-2">
        <Select
          className="w-52"
          value={status}
          onChange={(e) => set('status', e.target.value)}
          aria-label="Status"
        >
          <option value="">All statuses</option>
          {EMAIL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </Select>
        <Input
          className="w-80"
          placeholder="Search subject, organisation, email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && set('q', q)}
          onBlur={() => set('q', q)}
        />
      </div>
      {query.data?.items.length === 0 ? (
        <EmptyState>No emails.</EmptyState>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Subject</TH>
              <TH>Organisation</TH>
              <TH>To</TH>
              <TH>Kind</TH>
              <TH>Status</TH>
              <TH>Sent</TH>
              <TH>Updated</TH>
            </TR>
          </THead>
          <TBody>
            {query.data?.items.map((e) => (
              <TR key={e.id}>
                <TD>
                  <Link className="text-primary hover:underline" to={`/emails/${e.id}`}>
                    {e.subject}
                  </Link>
                  {e.gateFailureReason && <div className="text-xs text-red-700">{e.gateFailureReason}</div>}
                  {e.rejectionReason && e.status === 'draft' && (
                    <div className="text-xs text-amber-700">Rejected: {e.rejectionReason}</div>
                  )}
                </TD>
                <TD className="text-xs">
                  <Link className="hover:underline" to={`/organisations/${e.organisationId}`}>
                    {e.organisationName}
                  </Link>
                </TD>
                <TD className="text-xs">{e.contactEmail}</TD>
                <TD className="text-xs">{e.kind.replace(/_/g, ' ')}</TD>
                <TD>
                  <EmailStatusBadge status={e.status} />
                </TD>
                <TD className="text-xs">
                  <IstDate value={e.sentAt} />
                </TD>
                <TD className="text-xs">
                  <IstDate value={e.updatedAt} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {query.data && (
        <Pagination
          page={page}
          pageSize={query.data.pageSize}
          total={query.data.total}
          onPage={(p) => set('page', String(p))}
        />
      )}
    </div>
  );
}
