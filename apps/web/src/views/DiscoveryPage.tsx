import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import {
  ORG_TYPE_LABELS,
  ORG_TYPES,
  SEGMENT_LABELS,
  segmentsForType,
  type OrgType,
  type Segment,
} from '@wellthyfy/shared';
import type { DiscoveryCandidate } from '@wellthyfy/shared/db/schema';
import { PageHeader } from '@/components/layout/AppShell';
import { EmptyState, ErrorMessage, ExternalLink, IstDate } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface RunSummary {
  id: string;
  query: string;
  status: string;
  resultsCount: number;
  searchesUsed: number;
  error: string | null;
  createdAt: string;
  createdByName: string | null;
}
interface RunDetail extends RunSummary {
  results: DiscoveryCandidate[];
}

export function DiscoveryPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = React.useState({
    orgType: 'college_university' as OrgType,
    segment: '' as Segment | '',
    state: 'Tamil Nadu',
    city: '',
    keywords: '',
    maxResults: 20,
  });
  const [runId, setRunId] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [queueResearch, setQueueResearch] = React.useState(false);
  const runs = useQuery({
    queryKey: ['discovery'],
    queryFn: () =>
      api<{ runs: RunSummary[]; searchesUsed: number; searchLimit: number; configured: boolean }>(
        '/api/discovery',
      ),
    refetchInterval: (q) =>
      q.state.data?.runs.some((r) => ['pending', 'running'].includes(r.status)) ? 4000 : false,
  });
  const run = useQuery({
    queryKey: ['discovery', runId],
    queryFn: () => api<RunDetail>(`/api/discovery/${runId}`),
    enabled: !!runId,
    refetchInterval: (q) =>
      q.state.data && ['pending', 'running'].includes(q.state.data.status) ? 3000 : false,
  });
  const start = useMutation({
    mutationFn: () =>
      api<RunSummary>('/api/discovery', { body: { ...form, segment: form.segment || undefined } }),
    onSuccess: (r) => {
      setRunId(r.id);
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['discovery'] });
      toast('Search started', 'info');
    },
  });
  const add = useMutation({
    mutationFn: () =>
      api<{ created: { id: string; name: string }[]; skipped: { domain: string; reason: string }[] }>(
        `/api/discovery/${runId}/add`,
        {
          body: { domains: [...selected], queueResearch },
        },
      ),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['discovery', runId] });
      void qc.invalidateQueries({ queryKey: ['organisations'] });
      setSelected(new Set());
      toast(
        `Added ${r.created.length} organisations${r.skipped.length ? `, skipped ${r.skipped.length}` : ''}`,
      );
    },
  });
  const results = run.data?.results ?? [];
  const selectable = results.filter((c) => !c.added && !c.existingOrganisationId);

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Discovery"
        description="Find colleges and companies with web search. Social media, directories, news, job boards and existing organisations are filtered out."
      />
      <Card>
        <CardHeader>
          <CardTitle>New search</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 md:grid-cols-6"
            onSubmit={(e) => {
              e.preventDefault();
              start.mutate();
            }}
          >
            <Field label="Type">
              <Select
                value={form.orgType}
                onChange={(e) => setForm({ ...form, orgType: e.target.value as OrgType, segment: '' })}
              >
                {ORG_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ORG_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Segment">
              <Select
                value={form.segment}
                onChange={(e) => setForm({ ...form, segment: e.target.value as Segment })}
              >
                <option value="">Any</option>
                {segmentsForType(form.orgType).map((s) => (
                  <option key={s} value={s}>
                    {SEGMENT_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="State">
              <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
            </Field>
            <Field label="District / city">
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </Field>
            <Field label="Keywords">
              <Input
                value={form.keywords}
                placeholder="e.g. autonomous"
                onChange={(e) => setForm({ ...form, keywords: e.target.value })}
              />
            </Field>
            <Field label="Max results">
              <Input
                type="number"
                min={1}
                max={100}
                value={form.maxResults}
                onChange={(e) => setForm({ ...form, maxResults: Number(e.target.value) })}
              />
            </Field>
            <div className="flex items-center gap-3 md:col-span-6">
              <Button type="submit" disabled={start.isPending || runs.data?.configured === false}>
                <Search /> Search
              </Button>
              {runs.data && (
                <span className="text-xs text-muted-foreground">
                  {runs.data.searchesUsed} of {runs.data.searchLimit} searches used this month
                  {!runs.data.configured && ' · Serper is not configured'}
                </span>
              )}
            </div>
            <div className="md:col-span-6">
              <ErrorMessage error={start.error} />
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
        <div className="grid content-start gap-1">
          {runs.data?.runs.map((r) => (
            <button
              key={r.id}
              onClick={() => (setRunId(r.id), setSelected(new Set()))}
              className={cn(
                'rounded-md border bg-card p-2 text-left text-xs hover:bg-accent',
                runId === r.id && 'ring-2 ring-primary',
              )}
            >
              <div className="font-medium">{r.query}</div>
              <div className="text-muted-foreground">
                <IstDate value={r.createdAt} /> · {r.status} · {r.resultsCount} results
              </div>
              {r.error && <div className="text-amber-700">{r.error}</div>}
            </button>
          ))}
        </div>
        <div>
          {!runId ? (
            <EmptyState>Start a search or pick a previous run.</EmptyState>
          ) : run.data && ['pending', 'running'].includes(run.data.status) ? (
            <EmptyState>Searching… (the worker runs the search in the background)</EmptyState>
          ) : results.length === 0 ? (
            <EmptyState>{run.data?.error ?? 'No new organisations found.'}</EmptyState>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <Button disabled={selected.size === 0 || add.isPending} onClick={() => add.mutate()}>
                  Add selected ({selected.size})
                </Button>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={queueResearch}
                    onChange={(e) => setQueueResearch(e.target.checked)}
                  />
                  Also queue AI research
                </label>
                <button
                  className="text-xs text-primary underline"
                  onClick={() => setSelected(new Set(selectable.map((c) => c.domain)))}
                >
                  Select all new
                </button>
              </div>
              <Table>
                <THead>
                  <TR>
                    <TH />
                    <TH>Organisation</TH>
                    <TH>Website</TH>
                    <TH>Snippet</TH>
                  </TR>
                </THead>
                <TBody>
                  {results.map((c) => (
                    <TR key={c.domain}>
                      <TD>
                        <input
                          type="checkbox"
                          aria-label={`Select ${c.name}`}
                          disabled={!!c.added || !!c.existingOrganisationId}
                          checked={selected.has(c.domain)}
                          onChange={(e) =>
                            setSelected((s) => {
                              const n = new Set(s);
                              if (e.target.checked) n.add(c.domain);
                              else n.delete(c.domain);
                              return n;
                            })
                          }
                        />
                      </TD>
                      <TD>
                        <div className="font-medium">{c.name}</div>
                        {c.existingOrganisationId && (
                          <Link href={`/organisations/${c.existingOrganisationId}`}>
                            <Badge variant={c.added ? 'success' : 'secondary'}>
                              {c.added ? 'added' : 'already in CRM'}
                            </Badge>
                          </Link>
                        )}
                      </TD>
                      <TD className="text-xs">
                        <ExternalLink href={c.website} />
                      </TD>
                      <TD className="max-w-md text-xs text-muted-foreground">{c.snippet}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
