import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/AppShell';
import { EmptyState, IstDate } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api } from '@/lib/api';
import { inr, ProposalActions, ProposalStatus, type ProposalRow } from './organisations/ProposalsTab';

export function ProposalsPage() {
  const list = useQuery({ queryKey: ['proposals'], queryFn: () => api<ProposalRow[]>('/api/proposals') });
  const rows = list.data ?? [];
  const pipeline = rows
    .filter((p) => p.status === 'draft' || p.status === 'sent')
    .reduce((a, p) => a + Number(p.valueInr ?? 0), 0);
  const won = rows.filter((p) => p.status === 'accepted').reduce((a, p) => a + Number(p.valueInr ?? 0), 0);
  return (
    <div className="grid gap-4">
      <PageHeader title="Proposals" description="Create proposals from an organisation's Proposals tab." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Open pipeline</div>
            <div className="text-2xl font-semibold">{inr(pipeline)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Confirmed</div>
            <div className="text-2xl font-semibold">{inr(won)}</div>
          </CardContent>
        </Card>
      </div>
      {rows.length === 0 ? (
        <EmptyState>No proposals yet.</EmptyState>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Organisation</TH>
              <TH>Programme</TH>
              <TH>Value</TH>
              <TH>Status</TH>
              <TH>Created</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {rows.map((p) => (
              <TR key={p.id}>
                <TD>
                  <Link className="text-primary hover:underline" to={`/organisations/${p.organisationId}`}>
                    {p.recordId} {p.organisationName}
                  </Link>
                  <div className="text-xs text-muted-foreground">{p.contactName}</div>
                </TD>
                <TD className="text-xs">
                  {p.programmeName}
                  <div className="text-muted-foreground">{p.duration}</div>
                </TD>
                <TD>{inr(p.valueInr)}</TD>
                <TD>
                  <ProposalStatus status={p.status} />
                </TD>
                <TD className="text-xs">
                  <IstDate value={p.createdAt} time={false} />
                </TD>
                <TD>
                  <ProposalActions p={p} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
