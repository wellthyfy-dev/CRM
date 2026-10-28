import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorMessage, ExternalLink, IstDate } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useRole } from '@/lib/auth';
import type { OrganisationDetail, ProgrammeJ, ResearchJ } from '@/lib/types';
import { AiResearchPanel } from './AiResearchPanel';

export function useProgrammes() {
  return useQuery({ queryKey: ['programmes'], queryFn: () => api<ProgrammeJ[]>('/api/programmes') });
}

export function ResearchTab({ detail }: { detail: OrganisationDetail }) {
  const orgId = detail.organisation.id;
  const qc = useQueryClient();
  const toast = useToast();
  const { canEdit } = useRole();
  const programmes = useProgrammes();
  const history = useQuery({
    queryKey: ['research', orgId],
    queryFn: () => api<ResearchJ[]>(`/api/organisations/${orgId}/research`),
  });
  const latestManual = history.data?.find((r) => !r.aiGenerated);
  const [form, setForm] = React.useState({
    websiteEvidence: '',
    trainingNeed: '',
    recommendedProgrammeId: '',
    durationFormat: '',
    personalisationNote: '',
    sourceUrls: '',
  });
  React.useEffect(() => {
    const r = latestManual ?? detail.research;
    if (!r) return;
    setForm({
      websiteEvidence: r.websiteEvidence ?? '',
      trainingNeed: r.trainingNeed ?? '',
      recommendedProgrammeId: r.recommendedProgrammeId ?? '',
      durationFormat: r.durationFormat ?? '',
      personalisationNote: r.personalisationNote ?? '',
      sourceUrls: (r.sourcePages ?? []).map((p) => p.url).join('\n'),
    });
  }, [latestManual, detail.research]);

  const save = useMutation({
    mutationFn: () =>
      api(`/api/organisations/${orgId}/research`, {
        method: 'PUT',
        body: {
          ...form,
          recommendedProgrammeId: form.recommendedProgrammeId || null,
          sourceUrls: form.sourceUrls
            .split(/\s+/)
            .map((s) => s.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['research', orgId] });
      void qc.invalidateQueries({ queryKey: ['organisation', orgId] });
      toast('Research saved');
    },
  });
  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
      <Card>
        <CardHeader>
          <CardTitle>Research (manual)</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <Field label="Website evidence" hint="Quote what the official website says (no assumptions)">
              <Textarea disabled={!canEdit} value={form.websiteEvidence} onChange={set('websiteEvidence')} />
            </Field>
            <Field label="Training need">
              <Textarea disabled={!canEdit} value={form.trainingNeed} onChange={set('trainingNeed')} />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Recommended programme">
                <Select
                  disabled={!canEdit}
                  value={form.recommendedProgrammeId}
                  onChange={set('recommendedProgrammeId')}
                >
                  <option value="">—</option>
                  {programmes.data
                    ?.filter((p) => p.active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Duration / format">
                <Input
                  disabled={!canEdit}
                  value={form.durationFormat}
                  onChange={set('durationFormat')}
                  placeholder="Half-day workshop"
                />
              </Field>
            </div>
            <Field label="Personalisation note">
              <Textarea
                disabled={!canEdit}
                value={form.personalisationNote}
                onChange={set('personalisationNote')}
              />
            </Field>
            <Field label="Source URLs" hint="One per line (http/https)">
              <Textarea disabled={!canEdit} value={form.sourceUrls} onChange={set('sourceUrls')} />
            </Field>
            <ErrorMessage error={save.error} />
            {canEdit && (
              <div className="flex justify-end">
                <Button type="submit" disabled={save.isPending}>
                  Save research
                </Button>
              </div>
            )}
          </form>
        </CardContent>
      </Card>
      <div className="grid content-start gap-4">
        <AiResearchPanel detail={detail} />
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {history.data?.length === 0 && <p className="text-sm text-muted-foreground">No research yet.</p>}
            {history.data?.map((r) => (
              <div key={r.id} className="rounded-md border p-2 text-xs">
                <div className="mb-1 flex items-center gap-2">
                  {r.aiGenerated ? (
                    <Badge variant="info">AI · {r.aiModel}</Badge>
                  ) : (
                    <Badge variant="secondary">manual</Badge>
                  )}
                  <IstDate value={r.createdAt} />
                  {r.createdByName && <span className="text-muted-foreground">by {r.createdByName}</span>}
                  {r.aiGenerated && (
                    <span className="ml-auto text-muted-foreground">₹{Number(r.costInr).toFixed(2)}</span>
                  )}
                </div>
                {r.trainingNeed && <p className="line-clamp-3">{r.trainingNeed}</p>}
                {r.programmeName && <p className="text-muted-foreground">Programme: {r.programmeName}</p>}
                {(r.sourcePages ?? []).slice(0, 3).map((p) => (
                  <div key={p.url} className="truncate">
                    <ExternalLink href={p.url} />
                  </div>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
