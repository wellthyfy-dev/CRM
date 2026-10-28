import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, UserPlus } from 'lucide-react';
import { ExternalLink } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useRole } from '@/lib/auth';
import type { OrganisationDetail, ResearchJ } from '@/lib/types';

export interface AiOutput {
  websiteEvidence?: { quote: string; url: string }[];
  candidateContacts?: {
    name: string;
    designation: string;
    email: string;
    sourceUrl: string;
    quote: string;
  }[];
  droppedContacts?: number;
  draftSubject?: string;
  draftBody?: string;
  confidence?: 'low' | 'medium' | 'high';
}

export function AiResearchPanel({ detail }: { detail: OrganisationDetail }) {
  const orgId = detail.organisation.id;
  const qc = useQueryClient();
  const toast = useToast();
  const { canEdit } = useRole();
  const usage = useQuery({
    queryKey: ['ai-usage'],
    queryFn: () => api<{ spentInr: number; limitInr: number; configured: boolean }>('/api/ai/usage'),
  });
  const history = useQuery({
    queryKey: ['research', orgId],
    queryFn: () => api<ResearchJ[]>(`/api/organisations/${orgId}/research`),
  });
  const latestAi = history.data?.find((r) => r.aiGenerated);
  const out = (latestAi?.aiOutput ?? {}) as AiOutput;
  const run = useMutation({
    mutationFn: () => api(`/api/organisations/${orgId}/research/ai`, { body: {} }),
    onSuccess: () => {
      toast('AI research started — results appear here in a minute', 'info');
      // Poll for the new research row for up to 3 minutes.
      let n = 0;
      const timer = setInterval(() => {
        void qc.invalidateQueries({ queryKey: ['research', orgId] });
        void qc.invalidateQueries({ queryKey: ['ai-usage'] });
        if (++n > 36) clearInterval(timer);
      }, 5000);
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const add = useMutation({
    mutationFn: (index: number) => api(`/api/research/${latestAi!.id}/candidates`, { body: { index } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['organisation', orgId] });
      toast('Added as an unverified contact — check the source page, then mark verified');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const existingEmails = new Set(detail.contacts.map((c) => c.email));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> AI research
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {canEdit && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => run.mutate()}
              disabled={run.isPending || !detail.organisation.website || usage.data?.configured === false}
              title={!detail.organisation.website ? 'Add the website first' : undefined}
            >
              Research with AI
            </Button>
            {usage.data && (
              <span className="text-xs text-muted-foreground">
                ₹{usage.data.spentInr.toFixed(2)} of ₹{usage.data.limitInr} this month
                {!usage.data.configured && ' · not configured'}
              </span>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Reads the home page and up to 6 relevant pages of {detail.organisation.domain ?? 'the website'}.
          Suggested contacts are only those that literally appear on a page; they are added unverified.
        </p>
        {latestAi && (
          <>
            <div className="flex items-center gap-2 text-xs">
              <Badge
                variant={
                  out.confidence === 'high' ? 'success' : out.confidence === 'low' ? 'warning' : 'info'
                }
              >
                confidence: {out.confidence ?? '—'}
              </Badge>
              <span className="text-muted-foreground">{latestAi.aiModel}</span>
            </div>
            {latestAi.trainingNeed && <p>{latestAi.trainingNeed}</p>}
            {(out.websiteEvidence ?? []).map((e, i) => (
              <blockquote key={i} className="border-l-2 pl-2 text-xs text-muted-foreground">
                “{e.quote}” <ExternalLink href={e.url} />
              </blockquote>
            ))}
            <div>
              <div className="mb-1 font-medium">Suggested contacts – not verified</div>
              {(out.candidateContacts ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">None found on the pages.</p>
              )}
              {(out.candidateContacts ?? []).map((c, i) => (
                <div key={i} className="mb-2 rounded border p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {c.name} {c.designation && `· ${c.designation}`}
                    </span>
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={existingEmails.has(c.email.toLowerCase()) || add.isPending}
                        onClick={() => add.mutate(i)}
                      >
                        <UserPlus /> {existingEmails.has(c.email.toLowerCase()) ? 'Added' : 'Add'}
                      </Button>
                    )}
                  </div>
                  <div>{c.email}</div>
                  <ExternalLink href={c.sourceUrl} />
                </div>
              ))}
              {!!out.droppedContacts && (
                <p className="text-xs text-amber-700">
                  {out.droppedContacts} suggestion(s) dropped: not found verbatim on the cited page.
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
