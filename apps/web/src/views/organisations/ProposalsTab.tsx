import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, Mail, Plus } from 'lucide-react';
import { EmptyState, ErrorMessage, IstDate } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { api, apiFetch } from '@/lib/api';
import { useRole } from '@/lib/auth';
import type { OrganisationDetail } from '@/lib/types';
import { useProgrammes } from './ResearchTab';

export interface ProposalRow {
  id: string;
  organisationId: string;
  organisationName: string;
  recordId: string;
  programmeName: string | null;
  contactName: string | null;
  duration: string | null;
  valueInr: number | null;
  status: 'draft' | 'sent' | 'accepted' | 'declined';
  emailId: string | null;
  emailStatus: string | null;
  createdAt: string;
  sentAt: string | null;
  decidedAt: string | null;
}

export const inr = (n: number | null | undefined) =>
  n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`;

export async function openProposalPdf(id: string) {
  const res = await apiFetch(`/api/proposals/${id}/pdf`);
  const url = URL.createObjectURL(await res.blob());
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function ProposalActions({ p }: { p: ProposalRow }) {
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const { canEdit } = useRole();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['proposals'] });
    void qc.invalidateQueries({ queryKey: ['organisation', p.organisationId] });
  };
  const email = useMutation({
    mutationFn: () => api<{ id: string }>(`/api/proposals/${p.id}/email`, { body: {} }),
    onSuccess: (e) => {
      refresh();
      toast('Email draft with the PDF created — submit it for approval');
      router.push(`/emails/${e.id}`);
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const status = useMutation({
    mutationFn: (s: string) => api(`/api/proposals/${p.id}/status`, { body: { status: s } }),
    onSuccess: () => {
      refresh();
      toast('Proposal updated');
    },
  });
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Button size="sm" variant="outline" onClick={() => void openProposalPdf(p.id)}>
        <FileDown /> PDF
      </Button>
      {canEdit && !p.emailId && (
        <Button size="sm" onClick={() => email.mutate()}>
          <Mail /> Attach to email
        </Button>
      )}
      {p.emailId && (
        <Button size="sm" variant="ghost" asChild>
          <Link href={`/emails/${p.emailId}`}>Email ({p.emailStatus})</Link>
        </Button>
      )}
      {canEdit && ['draft', 'sent'].includes(p.status) && (
        <>
          <Button size="sm" variant="outline" onClick={() => status.mutate('accepted')}>
            Accepted
          </Button>
          <Button size="sm" variant="ghost" onClick={() => status.mutate('declined')}>
            Declined
          </Button>
        </>
      )}
    </div>
  );
}

export function ProposalStatus({ status }: { status: ProposalRow['status'] }) {
  const v = { draft: 'secondary', sent: 'info', accepted: 'success', declined: 'danger' } as const;
  return <Badge variant={v[status]}>{status}</Badge>;
}

export function ProposalsTab({ detail }: { detail: OrganisationDetail }) {
  const orgId = detail.organisation.id;
  const qc = useQueryClient();
  const toast = useToast();
  const { canEdit } = useRole();
  const programmes = useProgrammes();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({
    programmeId: '',
    contactId: '',
    duration: '',
    valueInr: '',
    notes: '',
  });
  const list = useQuery({
    queryKey: ['proposals', orgId],
    queryFn: () => api<ProposalRow[]>(`/api/organisations/${orgId}/proposals`),
  });
  const programme = programmes.data?.find((p) => p.id === form.programmeId);
  const create = useMutation({
    mutationFn: () =>
      api('/api/proposals', {
        body: {
          organisationId: orgId,
          programmeId: form.programmeId,
          contactId: form.contactId || null,
          duration: form.duration,
          valueInr: Number(form.valueInr),
          notes: form.notes,
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['proposals'] });
      setOpen(false);
      toast('Proposal PDF created');
    },
  });

  return (
    <div className="grid gap-4">
      {canEdit && !open && (
        <div className="flex justify-end">
          <Button onClick={() => setOpen(true)}>
            <Plus /> New proposal
          </Button>
        </div>
      )}
      {open && (
        <Card>
          <CardHeader>
            <CardTitle>New proposal</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <Field label="Programme">
              <Select
                value={form.programmeId}
                onChange={(e) => setForm({ ...form, programmeId: e.target.value })}
              >
                <option value="">Choose…</option>
                {programmes.data
                  ?.filter((p) => p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Addressed to">
              <Select
                value={form.contactId}
                onChange={(e) => setForm({ ...form, contactId: e.target.value })}
              >
                <option value="">—</option>
                {detail.contacts
                  .filter((c) => !c.optOut)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName || c.email} {c.verified ? '' : '(unverified)'}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Duration / format" hint={programme?.durationOptions.join(' · ')}>
              <Input value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} />
            </Field>
            <Field
              label="Fee (₹)"
              hint={
                programme
                  ? `Indicative ${inr(programme.indicativeFeeMin)} – ${inr(programme.indicativeFeeMax)}`
                  : undefined
              }
            >
              <Input
                type="number"
                min={0}
                value={form.valueInr}
                onChange={(e) => setForm({ ...form, valueInr: e.target.value })}
              />
            </Field>
            <Field label="Notes" className="md:col-span-2">
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
            <div className="md:col-span-2">
              <ErrorMessage error={create.error} />
            </div>
            <div className="flex justify-end gap-2 md:col-span-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!form.programmeId || !form.duration || !form.valueInr || create.isPending}
                onClick={() => create.mutate()}
              >
                Generate PDF
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {list.data?.length === 0 ? (
        <EmptyState>No proposals yet.</EmptyState>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Created</TH>
              <TH>Programme</TH>
              <TH>Duration</TH>
              <TH>Value</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {list.data?.map((p) => (
              <TR key={p.id}>
                <TD className="text-xs">
                  <IstDate value={p.createdAt} />
                </TD>
                <TD className="text-xs">{p.programmeName}</TD>
                <TD className="text-xs">{p.duration}</TD>
                <TD>{inr(p.valueInr)}</TD>
                <TD>
                  <ProposalStatus status={p.status} />
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
