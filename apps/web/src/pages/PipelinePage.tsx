import * as React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { ORG_TYPE_LABELS, ORG_TYPES, SEGMENT_LABELS, STAGE_LABELS, type Stage } from '@wellthyfy/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { ConfirmDialog, IstDate } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Input, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api, qs } from '@/lib/api';
import { useRole } from '@/lib/auth';
import { cn } from '@/lib/utils';
import type { PipelineCard } from '@/lib/types';

function Card({ card, draggable }: { card: PipelineCard; draggable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
    disabled: !draggable,
  });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        'rounded-md border bg-card p-2 text-xs shadow-sm',
        draggable && 'cursor-grab',
        isDragging && 'z-10 opacity-80 shadow-lg',
      )}
      data-testid="pipeline-card"
    >
      <Link
        to={`/organisations/${card.id}`}
        className="font-medium text-primary hover:underline"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {card.name}
      </Link>
      <div className="text-muted-foreground">
        {SEGMENT_LABELS[card.segment]}
        {card.city && ` · ${card.city}`}
      </div>
      {card.primaryContact && (
        <div className="mt-1 truncate">
          {card.primaryContact.fullName || card.primaryContact.email}
          {card.primaryContact.designation && (
            <span className="text-muted-foreground"> · {card.primaryContact.designation}</span>
          )}
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
        {card.lastActivity && (
          <span>
            {card.lastActivity.type.replace(/_/g, ' ')}{' '}
            <IstDate value={card.lastActivity.createdAt} time={false} />
          </span>
        )}
        {card.nextFollowUpAt && (
          <Badge variant="warning">
            follow-up <IstDate value={card.nextFollowUpAt} time={false} />
          </Badge>
        )}
        {card.doNotContact && <Badge variant="danger">DNC</Badge>}
      </div>
    </div>
  );
}

function Column({ stage, items, draggable }: { stage: Stage; items: PipelineCard[]; draggable: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-64 shrink-0 flex-col rounded-lg border bg-muted/40',
        isOver && 'ring-2 ring-primary',
      )}
      data-testid={`pipeline-column-${stage}`}
    >
      <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-medium">
        {STAGE_LABELS[stage]}
        <Badge variant="secondary">{items.length}</Badge>
      </div>
      <div
        className="flex min-h-24 flex-col gap-2 overflow-y-auto p-2"
        style={{ maxHeight: 'calc(100vh - 220px)' }}
      >
        {items.map((c) => (
          <Card key={c.id} card={c} draggable={draggable} />
        ))}
      </div>
    </div>
  );
}

export function PipelinePage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { canEdit } = useRole();
  const [orgType, setOrgType] = React.useState('');
  const [lostMove, setLostMove] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const board = useQuery({
    queryKey: ['pipeline', orgType],
    queryFn: () =>
      api<{ columns: { stage: Stage; items: PipelineCard[] }[] }>(`/api/pipeline${qs({ orgType })}`),
  });
  const move = useMutation({
    mutationFn: ({ id, stage, lostReason }: { id: string; stage: Stage; lostReason?: string }) =>
      api(`/api/organisations/${id}/stage`, { body: { stage, lostReason } }),
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: ['pipeline', orgType] });
      const prev = qc.getQueryData<{ columns: { stage: Stage; items: PipelineCard[] }[] }>([
        'pipeline',
        orgType,
      ]);
      if (prev) {
        const card = prev.columns.flatMap((c) => c.items).find((c) => c.id === id);
        if (card) {
          qc.setQueryData(['pipeline', orgType], {
            columns: prev.columns.map((c) => ({
              ...c,
              items:
                c.stage === stage
                  ? [{ ...card, stage }, ...c.items.filter((i) => i.id !== id)]
                  : c.items.filter((i) => i.id !== id),
            })),
          });
        }
      }
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['pipeline', orgType], ctx.prev);
      toast((e as Error).message, 'error');
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['pipeline'] });
      void qc.invalidateQueries({ queryKey: ['organisations'] });
    },
  });

  function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    const stage = e.over?.id as Stage | undefined;
    if (!stage) return;
    const current = board.data?.columns.find((c) => c.items.some((i) => i.id === id))?.stage;
    if (current === stage) return;
    if (stage === 'lost') {
      setLostMove(id);
      return;
    }
    move.mutate({ id, stage });
  }

  return (
    <div>
      <PageHeader
        title="Pipeline"
        description={canEdit ? 'Drag cards between stages. Every move is logged.' : 'Read-only view.'}
        actions={
          <Select
            className="w-52"
            value={orgType}
            onChange={(e) => setOrgType(e.target.value)}
            aria-label="Type"
          >
            <option value="">Colleges and companies</option>
            {ORG_TYPES.map((t) => (
              <option key={t} value={t}>
                {ORG_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        }
      />
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {board.data?.columns.map((c) => (
            <Column key={c.stage} stage={c.stage} items={c.items} draggable={canEdit} />
          ))}
        </div>
      </DndContext>
      <ConfirmDialog
        open={!!lostMove}
        onOpenChange={(o) => !o && setLostMove(null)}
        title="Mark as lost"
        description="A reason is required."
        confirmLabel="Mark lost"
        destructive
        busy={!reason.trim()}
        onConfirm={() => {
          if (lostMove) move.mutate({ id: lostMove, stage: 'lost', lostReason: reason });
          setLostMove(null);
          setReason('');
        }}
      >
        <Input autoFocus placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}
