import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { istDateKey, ORG_TYPE_LABELS, STAGE_LABELS, STAGES, type Stage } from '@wellthyfy/shared';
import {
  ConfirmDialog,
  ErrorMessage,
  ExternalLink,
  IstDate,
  KeyValue,
  SegmentText,
  StageBadge,
} from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useRole } from '@/lib/auth';
import type { OrganisationDetail } from '@/lib/types';
import { ActivityTab } from './ActivityTab';
import { ContactsTab } from './ContactsTab';
import { EmailsTab } from './EmailsTab';
import { OrganisationFormDialog } from './OrganisationForm';
import { ProposalsTab } from './ProposalsTab';
import { ResearchTab } from './ResearchTab';

export function useOrganisation(id: string) {
  return useQuery({
    queryKey: ['organisation', id],
    queryFn: () => api<OrganisationDetail>(`/api/organisations/${id}`),
  });
}

export function StageControl({ orgId, stage }: { orgId: string; stage: Stage }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { canEdit } = useRole();
  const [pending, setPending] = React.useState<Stage | null>(null);
  const [reason, setReason] = React.useState('');
  const mutation = useMutation({
    mutationFn: (body: { stage: Stage; lostReason?: string }) =>
      api(`/api/organisations/${orgId}/stage`, { body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['organisation', orgId] });
      void qc.invalidateQueries({ queryKey: ['organisations'] });
      void qc.invalidateQueries({ queryKey: ['pipeline'] });
      void qc.invalidateQueries({ queryKey: ['activities', orgId] });
      toast('Stage updated');
      setPending(null);
      setReason('');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  if (!canEdit) return <StageBadge stage={stage} />;
  return (
    <>
      <Select
        aria-label="Stage"
        className="w-48"
        value={stage}
        onChange={(e) => {
          const s = e.target.value as Stage;
          if (s === 'lost') setPending(s);
          else mutation.mutate({ stage: s });
        }}
      >
        {STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABELS[s]}
          </option>
        ))}
      </Select>
      <ConfirmDialog
        open={pending === 'lost'}
        onOpenChange={(o) => !o && setPending(null)}
        title="Mark as lost"
        description="A reason is required."
        confirmLabel="Mark lost"
        destructive
        busy={mutation.isPending || !reason.trim()}
        onConfirm={() => mutation.mutate({ stage: 'lost', lostReason: reason })}
      >
        <Input
          autoFocus
          placeholder="Reason (e.g. no budget this year)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </ConfirmDialog>
    </>
  );
}

function FollowUpControl({ orgId, value }: { orgId: string; value: string | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { canEdit } = useRole();
  const mutation = useMutation({
    mutationFn: (date: string) =>
      api(`/api/organisations/${orgId}/follow-up`, {
        method: 'PUT',
        // Store the chosen IST calendar date at 00:00 IST.
        body: { nextFollowUpAt: date ? new Date(`${date}T00:00:00+05:30`).toISOString() : null },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['organisation', orgId] });
      toast('Next follow-up saved');
    },
  });
  if (!canEdit) return <IstDate value={value} time={false} />;
  return (
    <Input
      type="date"
      className="w-44"
      aria-label="Next follow-up date"
      defaultValue={value ? istDateKey(new Date(value)) : ''}
      onChange={(e) => mutation.mutate(e.target.value)}
    />
  );
}

export function OrganisationDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { data, error, isLoading } = useOrganisation(id);
  const { canEdit, isAdmin } = useRole();
  const [editing, setEditing] = React.useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const dnc = useMutation({
    mutationFn: (doNotContact: boolean) =>
      api(`/api/organisations/${id}`, { method: 'PATCH', body: { doNotContact } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['organisation', id] });
      toast('Do-not-contact updated');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data) return <ErrorMessage error={error ?? 'Not found'} />;
  const org = data.organisation;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">
            <Link href="/organisations" className="hover:underline">
              Organisations
            </Link>{' '}
            / <span className="font-mono">{org.recordId}</span>
          </div>
          <h1 className="text-xl font-semibold" data-testid="org-name">
            {org.name}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{ORG_TYPE_LABELS[org.orgType]}</span>·<SegmentText segment={org.segment} />
            {org.city && <>· {org.city}</>}
            {org.doNotContact && <Badge variant="danger">Do not contact</Badge>}
            {org.stage === 'lost' && org.lostReason && (
              <Badge variant="outline">Lost: {org.lostReason}</Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StageControl orgId={org.id} stage={org.stage} />
          {canEdit && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="contacts">Contacts ({data.contacts.length})</TabsTrigger>
          <TabsTrigger value="research">Research</TabsTrigger>
          <TabsTrigger value="emails">Emails</TabsTrigger>
          <TabsTrigger value="proposals">Proposals</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent>
                <KeyValue label="Record ID">{org.recordId}</KeyValue>
                <KeyValue label="Website">
                  <ExternalLink href={org.website} />
                </KeyValue>
                <KeyValue label="Domain">{org.domain}</KeyValue>
                <KeyValue label="Industry / Department">{org.industryDepartment}</KeyValue>
                <KeyValue label="City / District">
                  {[org.city, org.district].filter(Boolean).join(', ') || '—'}
                </KeyValue>
                <KeyValue label="State">{org.state}</KeyValue>
                <KeyValue label="Owner">{data.owner?.fullName}</KeyValue>
                <KeyValue label="Source">{org.source}</KeyValue>
                <KeyValue label="Created">
                  <IstDate value={org.createdAt} />
                </KeyValue>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Follow-up & status</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <KeyValue label="Stage">
                  <StageBadge stage={org.stage} />
                </KeyValue>
                <KeyValue label="Next follow-up">
                  <FollowUpControl orgId={org.id} value={org.nextFollowUpAt} />
                </KeyValue>
                <KeyValue label="Do not contact">
                  <span className="flex items-center gap-2">
                    {org.doNotContact ? 'Yes' : 'No'}
                    {canEdit && !org.doNotContact && (
                      <Button size="sm" variant="outline" onClick={() => dnc.mutate(true)}>
                        Mark do-not-contact
                      </Button>
                    )}
                    {isAdmin && org.doNotContact && (
                      <Button size="sm" variant="outline" onClick={() => dnc.mutate(false)}>
                        Clear
                      </Button>
                    )}
                  </span>
                </KeyValue>
                <div>
                  <div className="mb-1 text-sm text-muted-foreground">Notes</div>
                  <p className="whitespace-pre-wrap text-sm">{org.notes || '—'}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="contacts">
          <ContactsTab detail={data} />
        </TabsContent>
        <TabsContent value="research">
          <ResearchTab detail={data} />
        </TabsContent>
        <TabsContent value="emails">
          <EmailsTab detail={data} />
        </TabsContent>
        <TabsContent value="proposals">
          <ProposalsTab detail={data} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityTab orgId={org.id} />
        </TabsContent>
      </Tabs>
      <OrganisationFormDialog open={editing} onOpenChange={setEditing} organisation={org} />
    </div>
  );
}
