import * as React from 'react';
import Link from 'next/link';
import { useSearchParamsState } from '@/lib/router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Download, Plus, Upload } from 'lucide-react';
import {
  ORG_TYPE_LABELS,
  ORG_TYPES,
  SEGMENT_LABELS,
  SEGMENTS,
  STAGE_LABELS,
  STAGES,
} from '@wellthyfy/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { EmptyState, IstDate, Pagination, SegmentText, StageBadge } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, apiDownload, qs } from '@/lib/api';
import { useRole } from '@/lib/auth';
import type { OrganisationRow, Paged } from '@/lib/types';
import { OrganisationFormDialog, useUserDirectory } from './OrganisationForm';

const FILTER_KEYS = [
  'q',
  'orgType',
  'segment',
  'state',
  'city',
  'stage',
  'ownerId',
  'verified',
  'optOut',
  'due',
  'sort',
  'dir',
  'page',
] as const;

export function OrganisationsPage() {
  const [params, setParams] = useSearchParamsState();
  const { canEdit } = useRole();
  const [creating, setCreating] = React.useState(false);
  const [search, setSearch] = React.useState(params.get('q') ?? '');
  const users = useUserDirectory();
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? undefined]));
  const page = Number(params.get('page') ?? 1);
  const sort = params.get('sort') ?? 'updated_at';
  const dir = params.get('dir') ?? 'desc';

  const setFilter = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  React.useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('q') ?? '') !== search) setFilter('q', search || undefined);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce on search text only
  }, [search]);

  const query = useQuery({
    queryKey: ['organisations', filters],
    queryFn: () => api<Paged<OrganisationRow>>(`/api/organisations${qs({ ...filters, pageSize: 25 })}`),
    placeholderData: keepPreviousData,
  });

  const sortHeader = (key: string, label: string) => (
    <button
      className="inline-flex items-center gap-1 hover:text-foreground"
      onClick={() => {
        const next = new URLSearchParams(params);
        next.set('sort', key);
        next.set('dir', sort === key && dir === 'asc' ? 'desc' : 'asc');
        setParams(next, { replace: true });
      }}
    >
      {label}
      {sort === key && (dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
    </button>
  );

  return (
    <div>
      <PageHeader
        title="Organisations"
        description="Colleges, universities and companies in the outreach programme"
        actions={
          <>
            <Button
              variant="outline"
              onClick={() =>
                void apiDownload(`/api/organisations/export.csv${qs(filters)}`, 'organisations.csv')
              }
            >
              <Download /> Export CSV
            </Button>
            {canEdit && (
              <>
                <Button variant="outline" asChild>
                  <Link href="/organisations/import">
                    <Upload /> Import
                  </Link>
                </Button>
                <Button onClick={() => setCreating(true)}>
                  <Plus /> New organisation
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="mb-3 grid gap-2 md:grid-cols-4 lg:grid-cols-6">
        <Input
          className="md:col-span-2"
          placeholder="Search name, city, domain, contact email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search organisations"
        />
        <Select
          value={filters.orgType ?? ''}
          onChange={(e) => setFilter('orgType', e.target.value)}
          aria-label="Type"
        >
          <option value="">All types</option>
          {ORG_TYPES.map((t) => (
            <option key={t} value={t}>
              {ORG_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
        <Select
          value={filters.segment ?? ''}
          onChange={(e) => setFilter('segment', e.target.value)}
          aria-label="Segment"
        >
          <option value="">All segments</option>
          {SEGMENTS.map((s) => (
            <option key={s} value={s}>
              {SEGMENT_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select
          value={filters.stage ?? ''}
          onChange={(e) => setFilter('stage', e.target.value)}
          aria-label="Stage"
        >
          <option value="">All stages</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select
          value={filters.ownerId ?? ''}
          onChange={(e) => setFilter('ownerId', e.target.value)}
          aria-label="Owner"
        >
          <option value="">All owners</option>
          {users.data?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName}
            </option>
          ))}
        </Select>
        <Input
          placeholder="State"
          defaultValue={filters.state}
          onBlur={(e) => setFilter('state', e.target.value)}
        />
        <Input
          placeholder="City"
          defaultValue={filters.city}
          onBlur={(e) => setFilter('city', e.target.value)}
        />
        <Select
          value={filters.verified ?? ''}
          onChange={(e) => setFilter('verified', e.target.value)}
          aria-label="Verified"
        >
          <option value="">Verified: any</option>
          <option value="true">Has verified contact</option>
          <option value="false">No verified contact</option>
        </Select>
        <Select
          value={filters.optOut ?? ''}
          onChange={(e) => setFilter('optOut', e.target.value)}
          aria-label="Opt-out"
        >
          <option value="">Opt-out: any</option>
          <option value="true">Has opted-out contact</option>
          <option value="false">No opt-outs</option>
        </Select>
        <Select
          value={filters.due ?? ''}
          onChange={(e) => setFilter('due', e.target.value)}
          aria-label="Follow-up"
        >
          <option value="">Follow-up: any</option>
          <option value="today">Due today</option>
          <option value="overdue">Overdue</option>
        </Select>
      </div>

      {query.data && query.data.items.length === 0 ? (
        <EmptyState>No organisations match these filters.</EmptyState>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>{sortHeader('record_id', 'Record')}</TH>
              <TH>{sortHeader('name', 'Name')}</TH>
              <TH>Segment</TH>
              <TH>{sortHeader('city', 'City')}</TH>
              <TH>Primary contact</TH>
              <TH>{sortHeader('stage', 'Stage')}</TH>
              <TH>Owner</TH>
              <TH>{sortHeader('next_follow_up_at', 'Next follow-up')}</TH>
              <TH>{sortHeader('updated_at', 'Updated')}</TH>
            </TR>
          </THead>
          <TBody>
            {query.data?.items.map((o) => (
              <TR key={o.id}>
                <TD className="font-mono text-xs">{o.recordId}</TD>
                <TD>
                  <Link href={`/organisations/${o.id}`} className="font-medium text-primary hover:underline">
                    {o.name}
                  </Link>
                  {o.doNotContact && (
                    <Badge variant="danger" className="ml-2">
                      Do not contact
                    </Badge>
                  )}
                  {o.domain && <div className="text-xs text-muted-foreground">{o.domain}</div>}
                </TD>
                <TD>
                  <SegmentText segment={o.segment} />
                </TD>
                <TD>{o.city ?? '—'}</TD>
                <TD>
                  {o.primaryContact ? (
                    <div className="text-xs">
                      <div className="font-medium">
                        {o.primaryContact.fullName || '(no name)'}{' '}
                        {o.primaryContact.verified && <Badge variant="success">verified</Badge>}{' '}
                        {o.primaryContact.optOut && <Badge variant="danger">opt-out</Badge>}
                      </div>
                      <div className="text-muted-foreground">{o.primaryContact.email}</div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TD>
                <TD>
                  <StageBadge stage={o.stage} />
                </TD>
                <TD className="text-xs">{o.ownerName ?? '—'}</TD>
                <TD className="text-xs">
                  <IstDate value={o.nextFollowUpAt} time={false} />
                </TD>
                <TD className="text-xs">
                  <IstDate value={o.updatedAt} />
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
          onPage={(p) => setFilter('page', String(p))}
        />
      )}
      <OrganisationFormDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
