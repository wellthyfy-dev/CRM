import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorMessage } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import type { ContactJ, EmailJ, OrganisationJ, ResearchJ, TemplateJ } from '@/lib/types';
import type { AiOutput } from './AiResearchPanel';

interface Rendered {
  templateId: string;
  templateKey: string;
  templateVersion: number;
  subject: string;
  body: string;
}

/** Create email: auto-selected template (overridable) → render → edit → save draft. */
export function ComposeEmailDialog({
  open,
  onOpenChange,
  organisation,
  contact,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  organisation: OrganisationJ;
  contact: ContactJ;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const [templateId, setTemplateId] = React.useState<string | undefined>(undefined);
  const [subject, setSubject] = React.useState('');
  const [body, setBody] = React.useState('');
  const templates = useQuery({
    queryKey: ['templates'],
    queryFn: () => api<TemplateJ[]>('/api/templates'),
  });
  const render = useMutation({
    mutationFn: (tid?: string) =>
      api<Rendered>('/api/emails/render', {
        body: { organisationId: organisation.id, contactId: contact.id, templateId: tid },
      }),
    onSuccess: (r) => {
      setTemplateId(r.templateId);
      setSubject(r.subject);
      setBody(r.body);
    },
  });
  React.useEffect(() => {
    if (open) render.mutate(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- render once when opened
  }, [open]);

  const save = useMutation({
    mutationFn: (submit: boolean) =>
      api<EmailJ>('/api/emails', {
        body: { organisationId: organisation.id, contactId: contact.id, templateId, subject, body },
      }).then(async (email) =>
        submit ? api<EmailJ>(`/api/emails/${email.id}/submit`, { body: {} }) : email,
      ),
    onSuccess: (email, submit) => {
      void qc.invalidateQueries({ queryKey: ['emails'] });
      void qc.invalidateQueries({ queryKey: ['organisation', organisation.id] });
      toast(submit ? 'Draft saved and submitted for approval' : 'Draft saved');
      onOpenChange(false);
      router.push(`/emails/${email.id}`);
    },
  });

  const research = useQuery({
    queryKey: ['research', organisation.id],
    queryFn: () => api<ResearchJ[]>(`/api/organisations/${organisation.id}/research`),
  });
  const aiDraft = research.data?.find((r) => r.aiGenerated)?.aiOutput as AiOutput | undefined;
  /** Render the AI draft through the template renderer (signature + opt-out line). */
  const useAiDraft = useMutation({
    mutationFn: () =>
      api<{ subject: string; body: string }>('/api/templates/preview', {
        body: {
          subject: aiDraft?.draftSubject ?? '',
          body: `${aiDraft?.draftBody ?? ''}

{{optOutLine}}`,
          organisationId: organisation.id,
          contactId: contact.id,
        },
      }),
    onSuccess: (r) => {
      setSubject(r.subject);
      setBody(r.body);
    },
  });

  const firstContact = templates.data?.filter((t) => t.kind === 'first_contact' && t.active) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Email to ${contact.fullName || contact.email}`}
        description={`${contact.email} · ${organisation.name}`}
        className="max-w-3xl"
      >
        <Field label="Template" hint="Auto-selected for this segment; you can override it">
          <Select
            aria-label="Template"
            value={templateId ?? ''}
            onChange={(e) => {
              setTemplateId(e.target.value);
              render.mutate(e.target.value);
            }}
          >
            {firstContact.map((t) => (
              <option key={t.id} value={t.id}>
                {t.key} — {t.name} (v{t.version})
              </option>
            ))}
          </Select>
        </Field>
        {aiDraft?.draftBody && (
          <div className="flex items-center gap-2 rounded-md bg-sky-50 p-2 text-xs text-sky-900">
            An AI-drafted email is available from the latest research.
            <Button size="sm" variant="outline" onClick={() => useAiDraft.mutate()}>
              Use AI draft
            </Button>
          </div>
        )}
        <Field label="Subject">
          <Input aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label="Body" hint="The opt-out line is always kept at the end">
          <Textarea
            aria-label="Body"
            className="min-h-[320px] font-mono text-xs"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
        <ErrorMessage error={render.error ?? save.error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            disabled={save.isPending || !subject || !body}
            onClick={() => save.mutate(false)}
          >
            Save draft
          </Button>
          <Button disabled={save.isPending || !subject || !body} onClick={() => save.mutate(true)}>
            Save & submit for approval
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
