import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import {
  MERGE_FIELD_LABELS,
  MERGE_FIELDS,
  SEGMENT_LABELS,
  SEGMENTS,
  TEMPLATE_KINDS,
  type Segment,
  type TemplateKind,
} from '@wellthyfy/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { ErrorMessage, IstDate } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { api, qs } from '@/lib/api';
import { useRole } from '@/lib/auth';
import { cn } from '@/lib/utils';
import type { ContactJ, OrganisationDetail, OrganisationRow, Paged, TemplateJ } from '@/lib/types';

interface Draft {
  key: string;
  name: string;
  kind: TemplateKind;
  segments: Segment[];
  subject: string;
  body: string;
  active: boolean;
}

function PreviewPane({ subject, body }: { subject: string; body: string }) {
  const [orgId, setOrgId] = React.useState('');
  const [contactId, setContactId] = React.useState('');
  const orgs = useQuery({
    queryKey: ['organisations', { pageSize: 100, preview: true }],
    queryFn: () =>
      api<Paged<OrganisationRow>>(`/api/organisations${qs({ pageSize: 100, sort: 'name', dir: 'asc' })}`),
  });
  const detail = useQuery({
    queryKey: ['organisation', orgId],
    queryFn: () => api<OrganisationDetail>(`/api/organisations/${orgId}`),
    enabled: !!orgId,
  });
  const [debounced, setDebounced] = React.useState({ subject, body });
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced({ subject, body }), 400);
    return () => clearTimeout(t);
  }, [subject, body]);
  const preview = useQuery({
    queryKey: ['template-preview', orgId, contactId, debounced],
    queryFn: () =>
      api<{ subject: string; body: string; unknownFields: string[] }>('/api/templates/preview', {
        body: { ...debounced, organisationId: orgId, contactId: contactId || null },
      }),
    enabled: !!orgId,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Live preview</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        <Select
          aria-label="Preview organisation"
          value={orgId}
          onChange={(e) => (setOrgId(e.target.value), setContactId(''))}
        >
          <option value="">Choose an organisation…</option>
          {orgs.data?.items.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Preview contact"
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
          disabled={!orgId}
        >
          <option value="">(no contact)</option>
          {detail.data?.contacts.map((c: ContactJ) => (
            <option key={c.id} value={c.id}>
              {c.fullName || c.email}
            </option>
          ))}
        </Select>
        {preview.data && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="mb-2 font-semibold">{preview.data.subject}</div>
            <pre className="whitespace-pre-wrap font-sans">{preview.data.body}</pre>
            {preview.data.unknownFields.length > 0 && (
              <p className="mt-2 text-xs text-red-700">
                Unknown fields: {preview.data.unknownFields.join(', ')}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TemplatesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { isAdmin } = useRole();
  const list = useQuery({ queryKey: ['templates'], queryFn: () => api<TemplateJ[]>('/api/templates') });
  const [selectedId, setSelectedId] = React.useState<string | 'new' | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  const selected = list.data?.find((t) => t.id === selectedId);
  const versions = useQuery({
    queryKey: ['template', selectedId],
    queryFn: () =>
      api<{ versions: { version: number; createdAt: string; subject: string }[] }>(
        `/api/templates/${selectedId}`,
      ),
    enabled: !!selectedId && selectedId !== 'new',
  });

  React.useEffect(() => {
    if (selectedId === 'new') {
      setDraft({
        key: '',
        name: '',
        kind: 'first_contact',
        segments: [],
        subject: '',
        body: '{{signature}}\n\n{{optOutLine}}',
        active: true,
      });
    } else if (selected) {
      setDraft({
        key: selected.key,
        name: selected.name,
        kind: selected.kind,
        segments: selected.segments,
        subject: selected.subject,
        body: selected.body,
        active: selected.active,
      });
    }
  }, [selectedId, selected]);

  const save = useMutation({
    mutationFn: (d: Draft) =>
      selectedId === 'new'
        ? api<TemplateJ>('/api/templates', { body: d })
        : api<TemplateJ>(`/api/templates/${selectedId}`, {
            method: 'PATCH',
            body: {
              name: d.name,
              kind: d.kind,
              segments: d.segments,
              subject: d.subject,
              body: d.body,
              active: d.active,
            },
          }),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: ['templates'] });
      void qc.invalidateQueries({ queryKey: ['template', t.id] });
      setSelectedId(t.id);
      toast(`Saved ${t.key} v${t.version}`);
    },
  });

  function insertField(field: string) {
    if (!draft) return;
    const el = bodyRef.current;
    const token = `{{${field}}}`;
    if (!el) return setDraft({ ...draft, body: draft.body + token });
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const body = draft.body.slice(0, start) + token + draft.body.slice(end);
    setDraft({ ...draft, body });
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    });
  }

  return (
    <div>
      <PageHeader
        title="Templates"
        description="Editing a template creates a new version; existing emails keep the version they were written with."
        actions={
          isAdmin && (
            <Button onClick={() => setSelectedId('new')}>
              <Plus /> New template
            </Button>
          )
        }
      />
      <div className="grid gap-4 xl:grid-cols-[260px_1fr_400px]">
        <div className="grid content-start gap-1">
          {list.data?.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              className={cn(
                'rounded-md border bg-card p-2 text-left text-sm hover:bg-accent',
                selectedId === t.id && 'ring-2 ring-primary',
              )}
            >
              <div className="font-medium">{t.key}</div>
              <div className="text-xs text-muted-foreground">
                {t.name} · v{t.version} {!t.active && <Badge variant="outline">inactive</Badge>}
              </div>
            </button>
          ))}
        </div>
        {draft ? (
          <Card>
            <CardContent className="grid gap-3 pt-4">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Key">
                  <Input
                    disabled={selectedId !== 'new'}
                    value={draft.key}
                    onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                  />
                </Field>
                <Field label="Name">
                  <Input
                    disabled={!isAdmin}
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </Field>
                <Field label="Kind">
                  <Select
                    disabled={!isAdmin}
                    value={draft.kind}
                    onChange={(e) => setDraft({ ...draft, kind: e.target.value as TemplateKind })}
                  >
                    {TEMPLATE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </Select>
                </Field>
                <label className="flex items-end gap-2 pb-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={!isAdmin}
                    checked={draft.active}
                    onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                  />
                  Active
                </label>
              </div>
              <div className="flex flex-wrap gap-1 text-xs">
                {SEGMENTS.map((s) => (
                  <label key={s} className="flex items-center gap-1 rounded border px-2 py-1">
                    <input
                      type="checkbox"
                      disabled={!isAdmin}
                      checked={draft.segments.includes(s)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          segments: e.target.checked
                            ? [...draft.segments, s]
                            : draft.segments.filter((x) => x !== s),
                        })
                      }
                    />
                    {SEGMENT_LABELS[s]}
                  </label>
                ))}
              </div>
              <Field label="Subject">
                <Input
                  disabled={!isAdmin}
                  value={draft.subject}
                  onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                />
              </Field>
              {isAdmin && (
                <div className="flex flex-wrap gap-1">
                  {MERGE_FIELDS.map((f) => (
                    <Button key={f} type="button" size="sm" variant="outline" onClick={() => insertField(f)}>
                      {MERGE_FIELD_LABELS[f]}
                    </Button>
                  ))}
                </div>
              )}
              <Field label="Body" hint="{{#field}}…{{/field}} shows text only when the field has a value">
                <Textarea
                  ref={bodyRef}
                  disabled={!isAdmin}
                  className="min-h-[380px] font-mono text-xs"
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                />
              </Field>
              <ErrorMessage error={save.error} />
              {isAdmin && (
                <div className="flex justify-end">
                  <Button onClick={() => save.mutate(draft)} disabled={save.isPending}>
                    Save {selectedId !== 'new' && '(new version)'}
                  </Button>
                </div>
              )}
              {versions.data && (
                <div className="text-xs text-muted-foreground">
                  Versions:{' '}
                  {versions.data.versions.map((v) => (
                    <span key={v.version} className="mr-2">
                      v{v.version} (<IstDate value={v.createdAt} time={false} />)
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <p className="text-sm text-muted-foreground">Select a template.</p>
        )}
        {draft && <PreviewPane subject={draft.subject} body={draft.body} />}
      </div>
    </div>
  );
}
