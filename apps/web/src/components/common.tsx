import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  formatIst,
  SEGMENT_LABELS,
  STAGE_LABELS,
  type EmailStatus,
  type Segment,
  type Stage,
} from '@wellthyfy/shared';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api';

const STAGE_VARIANT: Record<Stage, BadgeProps['variant']> = {
  research_needed: 'secondary',
  verified: 'info',
  approved: 'info',
  drafted: 'info',
  sent: 'default',
  replied: 'warning',
  meeting_scheduled: 'warning',
  proposal_sent: 'warning',
  training_confirmed: 'success',
  lost: 'danger',
  on_hold: 'outline',
};

export function StageBadge({ stage }: { stage: Stage }) {
  return <Badge variant={STAGE_VARIANT[stage]}>{STAGE_LABELS[stage]}</Badge>;
}

const EMAIL_VARIANT: Record<EmailStatus, BadgeProps['variant']> = {
  draft: 'secondary',
  pending_approval: 'warning',
  approved: 'info',
  queued: 'info',
  sent: 'success',
  failed: 'danger',
  replied: 'success',
  bounced: 'danger',
  cancelled: 'outline',
};

export function EmailStatusBadge({ status }: { status: EmailStatus }) {
  return <Badge variant={EMAIL_VARIANT[status]}>{status.replace('_', ' ')}</Badge>;
}

export function SegmentText({ segment }: { segment: Segment }) {
  return <span>{SEGMENT_LABELS[segment]}</span>;
}

export function IstDate({ value, time = true }: { value: string | Date | null | undefined; time?: boolean }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <span title={`${formatIst(value)} IST`}>{formatIst(value, time)}</span>;
}

/** Render an API error, including a link to the existing record for duplicate (409) errors. */
export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  const details =
    error instanceof ApiError ? (error.body.details as Record<string, string> | undefined) : undefined;
  return (
    <div className="rounded-md bg-red-50 p-2 text-sm text-red-800" role="alert">
      {message}
      {details?.kind === 'organisation' && details.existingId && (
        <>
          {' '}
          <Link className="underline" to={`/organisations/${details.existingId}`}>
            Open existing record
          </Link>
        </>
      )}
      {details?.kind === 'contact' && details.organisationId && (
        <>
          {' '}
          <Link className="underline" to={`/organisations/${details.organisationId}`}>
            Open existing organisation
          </Link>
        </>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
      <span>
        {total} record{total === 1 ? '' : 's'}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <span>
          Page {page} of {pages}
        </span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive,
  onConfirm,
  children,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  children?: React.ReactNode;
  busy?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        {children}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function KeyValue({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-2 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{children ?? '—'}</span>
    </div>
  );
}

export function ExternalLink({ href }: { href: string | null | undefined }) {
  if (!href) return <span className="text-muted-foreground">—</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-primary underline-offset-2 hover:underline"
    >
      {href}
    </a>
  );
}
