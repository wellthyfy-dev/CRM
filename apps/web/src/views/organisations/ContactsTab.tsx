import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, Mail, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { ConfirmDialog, EmptyState, ErrorMessage, ExternalLink, IstDate } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useRole } from '@/lib/auth';
import type { ContactJ, OrganisationDetail } from '@/lib/types';
import { ComposeEmailDialog } from './ComposeEmailDialog';

function ContactFormDialog({
  open,
  onOpenChange,
  orgId,
  contact,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  orgId: string;
  contact?: ContactJ;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = React.useState({
    fullName: '',
    designation: '',
    email: '',
    phone: '',
    sourceUrl: '',
  });
  React.useEffect(() => {
    if (open)
      setForm({
        fullName: contact?.fullName ?? '',
        designation: contact?.designation ?? '',
        email: contact?.email ?? '',
        phone: contact?.phone ?? '',
        sourceUrl: contact?.sourceUrl ?? '',
      });
  }, [open, contact]);
  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, email: form.email || null, sourceUrl: form.sourceUrl || null };
      return contact
        ? api(`/api/contacts/${contact.id}`, { method: 'PATCH', body })
        : api(`/api/organisations/${orgId}/contacts`, { body });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['organisation', orgId] });
      toast(contact ? 'Contact updated' : 'Contact added');
      onOpenChange(false);
    },
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={contact ? 'Edit contact' : 'Add contact'}
        description="Only record names and emails that appear on an official page, with its URL."
      >
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Full name">
            <Input value={form.fullName} onChange={set('fullName')} />
          </Field>
          <Field label="Designation">
            <Input
              value={form.designation}
              onChange={set('designation')}
              placeholder="Principal, Placement Officer…"
            />
          </Field>
          <Field label="Official email">
            <Input type="email" value={form.email} onChange={set('email')} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="Source URL" hint="The official page where this contact is published (http/https)">
            <Input type="url" value={form.sourceUrl} onChange={set('sourceUrl')} placeholder="https://…" />
          </Field>
          {contact?.verified && (
            <p className="text-xs text-amber-700">
              Changing the email or source URL will require re-verification.
            </p>
          )}
          <ErrorMessage error={save.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const CHECK_VARIANT = {
  valid: 'success',
  invalid: 'danger',
  catch_all: 'warning',
  risky: 'warning',
  unknown: 'secondary',
} as const;

export function ContactsTab({ detail }: { detail: OrganisationDetail }) {
  const orgId = detail.organisation.id;
  const qc = useQueryClient();
  const toast = useToast();
  const { canEdit, isAdmin } = useRole();
  const [deleting, setDeleting] = React.useState<ContactJ | null>(null);
  const [confirmText, setConfirmText] = React.useState('');
  const [editing, setEditing] = React.useState<ContactJ | 'new' | null>(null);
  const [optingOut, setOptingOut] = React.useState<ContactJ | null>(null);
  const [composeFor, setComposeFor] = React.useState<ContactJ | null>(null);

  const deleteData = useMutation({
    mutationFn: (id: string) => api(`/api/contacts/${id}/delete-data`, { body: { confirm: 'DELETE' } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['organisation', orgId] });
      setDeleting(null);
      setConfirmText('');
      toast('Contact data deleted');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const action = useMutation({
    mutationFn: ({ id, path }: { id: string; path: string }) =>
      api(`/api/contacts/${id}/${path}`, { body: {} }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ['organisation', orgId] });
      toast(
        v.path === 'verify'
          ? 'Contact marked verified'
          : v.path === 'opt-out'
            ? 'Contact opted out'
            : 'Saved',
      );
      setOptingOut(null);
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  return (
    <div>
      {canEdit && (
        <div className="mb-3 flex justify-end">
          <Button onClick={() => setEditing('new')}>
            <Plus /> Add contact
          </Button>
        </div>
      )}
      {detail.contacts.length === 0 ? (
        <EmptyState>No contacts yet.</EmptyState>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Email</TH>
              <TH>Source</TH>
              <TH>Status</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {detail.contacts.map((c) => (
              <TR key={c.id} data-testid={`contact-${c.email ?? c.id}`}>
                <TD>
                  <div className="font-medium">
                    {c.fullName || '(no name)'} {c.isPrimary && <Badge variant="outline">primary</Badge>}{' '}
                    {c.aiSuggested && <Badge variant="info">AI suggested</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">{c.designation}</div>
                </TD>
                <TD className="text-xs">
                  <div>{c.email ?? '—'}</div>
                  <div>{c.phone}</div>
                </TD>
                <TD className="max-w-64 truncate text-xs">
                  <ExternalLink href={c.sourceUrl} />
                </TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    {c.verified ? (
                      <Badge variant="success" title={c.verifiedAt ?? ''}>
                        verified
                      </Badge>
                    ) : (
                      <Badge variant="secondary">not verified</Badge>
                    )}
                    {c.optOut && <Badge variant="danger">opted out</Badge>}
                    <Badge variant={CHECK_VARIANT[c.emailCheckStatus]}>
                      email: {c.emailCheckStatus.replace('_', '-')}
                    </Badge>
                  </div>
                  {c.verifiedAt && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      verified <IstDate value={c.verifiedAt} />
                    </div>
                  )}
                </TD>
                <TD className="text-right">
                  <div className="flex flex-wrap justify-end gap-1">
                    {canEdit && c.verified && !c.optOut && c.email && !detail.organisation.doNotContact && (
                      <Button size="sm" onClick={() => setComposeFor(c)}>
                        <Mail /> Create email
                      </Button>
                    )}
                    {canEdit && !c.verified && !c.optOut && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!c.sourceUrl || !c.email}
                        title={!c.sourceUrl ? 'Add a source URL first' : undefined}
                        onClick={() => action.mutate({ id: c.id, path: 'verify' })}
                      >
                        <CheckCircle2 /> Mark verified
                      </Button>
                    )}
                    {canEdit && !c.isPrimary && (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Make primary"
                        onClick={() => action.mutate({ id: c.id, path: 'primary' })}
                      >
                        <Star />
                      </Button>
                    )}
                    {canEdit && !c.anonymisedAt && (
                      <Button size="sm" variant="ghost" title="Edit" onClick={() => setEditing(c)}>
                        <Pencil />
                      </Button>
                    )}
                    {canEdit && !c.optOut && (
                      <Button size="sm" variant="ghost" title="Opt out" onClick={() => setOptingOut(c)}>
                        <Ban />
                      </Button>
                    )}
                    {isAdmin && !c.anonymisedAt && (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Delete contact data"
                        onClick={() => setDeleting(c)}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <ContactFormDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        orgId={orgId}
        contact={editing && editing !== 'new' ? editing : undefined}
      />
      <ConfirmDialog
        open={!!optingOut}
        onOpenChange={(o) => !o && setOptingOut(null)}
        title="Opt out this contact?"
        description="Opt-outs are permanent. Unsent emails to this contact will be cancelled and the address will never be emailed again."
        confirmLabel="Opt out permanently"
        destructive
        busy={action.isPending}
        onConfirm={() => optingOut && action.mutate({ id: optingOut.id, path: 'opt-out' })}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o) {
            setDeleting(null);
            setConfirmText('');
          }
        }}
        title="Delete this contact's personal data?"
        description="For data-protection requests. Name, email, phone and source are erased; their email bodies and replies are redacted; the address is kept only as a hash on the permanent opt-out list. This cannot be undone."
        confirmLabel="Delete data"
        destructive
        busy={confirmText !== 'DELETE' || deleteData.isPending}
        onConfirm={() => deleting && deleteData.mutate(deleting.id)}
      >
        <Input
          placeholder="Type DELETE to confirm"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
        />
      </ConfirmDialog>
      {composeFor && (
        <ComposeEmailDialog
          open={!!composeFor}
          onOpenChange={(o) => !o && setComposeFor(null)}
          organisation={detail.organisation}
          contact={composeFor}
        />
      )}
    </div>
  );
}
