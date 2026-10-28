import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { EmailStatusBadge, EmptyState, IstDate } from '@/components/common';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, qs } from '@/lib/api';
import type { EmailRow, OrganisationDetail, Paged } from '@/lib/types';

export function EmailsTab({ detail }: { detail: OrganisationDetail }) {
  const orgId = detail.organisation.id;
  const emails = useQuery({
    queryKey: ['emails', { organisationId: orgId }],
    queryFn: () => api<Paged<EmailRow>>(`/api/emails${qs({ organisationId: orgId, pageSize: 100 })}`),
  });
  if (emails.data?.items.length === 0) {
    return <EmptyState>No emails yet. Use “Create email” on a verified contact.</EmptyState>;
  }
  return (
    <Table>
      <THead>
        <TR>
          <TH>Subject</TH>
          <TH>To</TH>
          <TH>Kind</TH>
          <TH>Status</TH>
          <TH>Sent</TH>
          <TH>Updated</TH>
        </TR>
      </THead>
      <TBody>
        {emails.data?.items.map((e) => (
          <TR key={e.id}>
            <TD>
              <Link className="text-primary hover:underline" href={`/emails/${e.id}`}>
                {e.subject}
              </Link>
              {e.gateFailureReason && <div className="text-xs text-red-700">{e.gateFailureReason}</div>}
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
  );
}
