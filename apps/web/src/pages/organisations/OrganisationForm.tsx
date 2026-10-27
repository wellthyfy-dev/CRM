import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ORG_TYPE_LABELS,
  ORG_TYPES,
  SEGMENT_LABELS,
  segmentsForType,
  type OrgType,
  type Segment,
} from '@wellthyfy/shared';
import { ErrorMessage } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { api, qs } from '@/lib/api';
import type { OrganisationJ } from '@/lib/types';

interface FormState {
  name: string;
  orgType: OrgType;
  segment: Segment;
  industryDepartment: string;
  city: string;
  district: string;
  state: string;
  website: string;
  ownerId: string;
  notes: string;
}

function initial(org?: OrganisationJ): FormState {
  return {
    name: org?.name ?? '',
    orgType: org?.orgType ?? 'college_university',
    segment: org?.segment ?? 'arts_science',
    industryDepartment: org?.industryDepartment ?? '',
    city: org?.city ?? '',
    district: org?.district ?? '',
    state: org?.state ?? 'Tamil Nadu',
    website: org?.website ?? '',
    ownerId: org?.ownerId ?? '',
    notes: org?.notes ?? '',
  };
}

export function useUserDirectory() {
  return useQuery({
    queryKey: ['users', 'directory'],
    queryFn: () => api<{ id: string; fullName: string; role: string }[]>('/api/users/directory'),
    staleTime: 60_000,
  });
}

export function OrganisationFormDialog({
  open,
  onOpenChange,
  organisation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organisation?: OrganisationJ;
}) {
  const [form, setForm] = React.useState<FormState>(() => initial(organisation));
  const [dupe, setDupe] = React.useState<{ id: string; recordId: string; name: string } | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const users = useUserDirectory();

  React.useEffect(() => {
    if (open) {
      setForm(initial(organisation));
      setDupe(null);
    }
  }, [open, organisation]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function checkWebsite() {
    if (!form.website.trim()) return setDupe(null);
    const res = await api<{ organisation?: { id: string; recordId: string; name: string } }>(
      `/api/organisations/check-duplicate${qs({ website: form.website })}`,
    );
    setDupe(res.organisation && res.organisation.id !== organisation?.id ? res.organisation : null);
  }

  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, ownerId: form.ownerId || null };
      return organisation
        ? api<OrganisationJ>(`/api/organisations/${organisation.id}`, { method: 'PATCH', body })
        : api<OrganisationJ>('/api/organisations', { body });
    },
    onSuccess: (org) => {
      void qc.invalidateQueries({ queryKey: ['organisations'] });
      void qc.invalidateQueries({ queryKey: ['organisation', org.id] });
      toast(organisation ? 'Organisation updated' : `Created ${org.recordId}`);
      onOpenChange(false);
      if (!organisation) navigate(`/organisations/${org.id}`);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={organisation ? 'Edit organisation' : 'New organisation'} className="max-w-2xl">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Name" className="sm:col-span-2">
            <Input required value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Type">
            <Select
              value={form.orgType}
              onChange={(e) => {
                const t = e.target.value as OrgType;
                setForm((f) => ({ ...f, orgType: t, segment: segmentsForType(t)[0]! }));
              }}
            >
              {ORG_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ORG_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Segment">
            <Select value={form.segment} onChange={(e) => set('segment', e.target.value as Segment)}>
              {segmentsForType(form.orgType).map((s) => (
                <option key={s} value={s}>
                  {SEGMENT_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Official website"
            className="sm:col-span-2"
            hint="Used for duplicate detection (domain)"
          >
            <Input
              value={form.website}
              placeholder="https://www.example-college.ac.in"
              onChange={(e) => set('website', e.target.value)}
              onBlur={() => void checkWebsite()}
            />
          </Field>
          {dupe && (
            <div className="rounded-md bg-amber-50 p-2 text-sm text-amber-900 sm:col-span-2">
              This domain already belongs to {dupe.recordId} {dupe.name}.{' '}
              <button
                type="button"
                className="underline"
                onClick={() => navigate(`/organisations/${dupe.id}`)}
              >
                Open existing record
              </button>
            </div>
          )}
          <Field label="Industry / Department">
            <Input
              value={form.industryDepartment}
              onChange={(e) => set('industryDepartment', e.target.value)}
            />
          </Field>
          <Field label="Owner">
            <Select value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)}>
              <option value="">(me)</option>
              {users.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="City">
            <Input value={form.city} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <Field label="District">
            <Input value={form.district} onChange={(e) => set('district', e.target.value)} />
          </Field>
          <Field label="State">
            <Input value={form.state} onChange={(e) => set('state', e.target.value)} />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <ErrorMessage error={save.error} />
          </div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
