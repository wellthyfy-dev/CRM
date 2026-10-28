import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import {
  PROGRAMME_AUDIENCES,
  SEGMENT_LABELS,
  SEGMENTS,
  type ProgrammeAudience,
  type Segment,
} from '@wellthyfy/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { ErrorMessage } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useRole } from '@/lib/auth';
import type { ProgrammeJ } from '@/lib/types';
import { useProgrammes } from './organisations/ResearchTab';

const inr = (n: number | null) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`);

function ProgrammeDialog({ programme, onClose }: { programme: ProgrammeJ | 'new'; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const p = programme === 'new' ? null : programme;
  const [form, setForm] = React.useState({
    name: p?.name ?? '',
    audience: (p?.audience ?? 'college') as ProgrammeAudience,
    segments: (p?.segments ?? []) as Segment[],
    modules: (p?.modules ?? []).join('\n'),
    durationOptions: (p?.durationOptions ?? []).join('\n'),
    indicativeFeeMin: p?.indicativeFeeMin?.toString() ?? '',
    indicativeFeeMax: p?.indicativeFeeMax?.toString() ?? '',
    active: p?.active ?? true,
  });
  const lines = (s: string) =>
    s
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        modules: lines(form.modules),
        durationOptions: lines(form.durationOptions),
        indicativeFeeMin: form.indicativeFeeMin ? Number(form.indicativeFeeMin) : null,
        indicativeFeeMax: form.indicativeFeeMax ? Number(form.indicativeFeeMax) : null,
      };
      return p ? api(`/api/programmes/${p.id}`, { method: 'PUT', body }) : api('/api/programmes', { body });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['programmes'] });
      toast('Programme saved');
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={p ? 'Edit programme' : 'New programme'} className="max-w-2xl">
        <div className="grid gap-3">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Audience">
            <Select
              value={form.audience}
              onChange={(e) => setForm({ ...form, audience: e.target.value as ProgrammeAudience })}
            >
              {PROGRAMME_AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-1 text-xs">
            {SEGMENTS.map((s) => (
              <label key={s} className="flex items-center gap-1 rounded border px-2 py-1">
                <input
                  type="checkbox"
                  checked={form.segments.includes(s)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      segments: e.target.checked
                        ? [...form.segments, s]
                        : form.segments.filter((x) => x !== s),
                    })
                  }
                />
                {SEGMENT_LABELS[s]}
              </label>
            ))}
          </div>
          <Field label="Modules (one per line)">
            <Textarea value={form.modules} onChange={(e) => setForm({ ...form, modules: e.target.value })} />
          </Field>
          <Field label="Duration options (one per line)">
            <Textarea
              value={form.durationOptions}
              onChange={(e) => setForm({ ...form, durationOptions: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Indicative fee min (₹)">
              <Input
                type="number"
                min={0}
                value={form.indicativeFeeMin}
                onChange={(e) => setForm({ ...form, indicativeFeeMin: e.target.value })}
              />
            </Field>
            <Field label="Indicative fee max (₹)">
              <Input
                type="number"
                min={0}
                value={form.indicativeFeeMax}
                onChange={(e) => setForm({ ...form, indicativeFeeMax: e.target.value })}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />{' '}
            Active
          </label>
          <ErrorMessage error={save.error} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ProgrammesPage() {
  const { isAdmin } = useRole();
  const list = useProgrammes();
  const [editing, setEditing] = React.useState<ProgrammeJ | 'new' | null>(null);
  return (
    <div>
      <PageHeader
        title="Programmes"
        description="Training programmes used in research, emails and proposals"
        actions={
          isAdmin && (
            <Button onClick={() => setEditing('new')}>
              <Plus /> New programme
            </Button>
          )
        }
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.data?.map((p) => (
          <Card key={p.id} className={p.active ? '' : 'opacity-60'}>
            <CardContent className="grid gap-2 pt-4 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold">{p.name}</div>
                {isAdmin && (
                  <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                    Edit
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                <Badge variant="outline">{p.audience}</Badge>
                {p.segments.map((s) => (
                  <Badge key={s} variant="secondary">
                    {SEGMENT_LABELS[s]}
                  </Badge>
                ))}
                {!p.active && <Badge variant="danger">inactive</Badge>}
              </div>
              <ul className="list-disc pl-5 text-xs">
                {p.modules.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
              <div className="text-xs text-muted-foreground">{p.durationOptions.join(' · ')}</div>
              <div className="text-xs">
                Fee: {inr(p.indicativeFeeMin)} – {inr(p.indicativeFeeMax)}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {editing && <ProgrammeDialog programme={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
