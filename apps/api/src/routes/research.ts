import { Router } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { researchUpsertSchema } from '@wellthyfy/shared';
import { logActivity, programmes, profiles, research } from '@wellthyfy/shared/server';
import type { RouteDeps } from '../app';
import { canEdit, currentUser } from '../lib/auth';
import { getOrg } from '../lib/crm';
import { badRequest } from '../lib/errors';
import { idParam, parseBody } from '../lib/http';

export function researchRoutes({ db }: RouteDeps): Router {
  const r = Router();

  r.get('/organisations/:id/research', async (req, res) => {
    const rows = await db
      .select({
        research,
        createdByName: profiles.fullName,
        programmeName: programmes.name,
      })
      .from(research)
      .leftJoin(profiles, eq(profiles.id, research.createdBy))
      .leftJoin(programmes, eq(programmes.id, research.recommendedProgrammeId))
      .where(eq(research.organisationId, idParam(req)))
      .orderBy(desc(research.createdAt));
    res.json(
      rows.map((row) => ({
        ...row.research,
        createdByName: row.createdByName,
        programmeName: row.programmeName,
      })),
    );
  });

  /** Save manual research. Updates the latest manual record, or creates one. AI research always creates new rows. */
  r.put('/organisations/:id/research', canEdit, async (req, res) => {
    const user = currentUser(req);
    const org = await getOrg(db, idParam(req));
    const body = parseBody(researchUpsertSchema, req);
    if (body.recommendedProgrammeId) {
      const [p] = await db
        .select({ id: programmes.id })
        .from(programmes)
        .where(eq(programmes.id, body.recommendedProgrammeId));
      if (!p) throw badRequest('Unknown programme');
    }
    const values = {
      websiteEvidence: body.websiteEvidence,
      trainingNeed: body.trainingNeed,
      recommendedProgrammeId: body.recommendedProgrammeId ?? null,
      durationFormat: body.durationFormat,
      personalisationNote: body.personalisationNote,
      sourcePages: body.sourceUrls.map((url) => ({ url })),
    };
    const [latestManual] = await db
      .select({ id: research.id })
      .from(research)
      .where(and(eq(research.organisationId, org.id), eq(research.aiGenerated, false)))
      .orderBy(desc(research.createdAt))
      .limit(1);
    const [row] = latestManual
      ? await db.update(research).set(values).where(eq(research.id, latestManual.id)).returning()
      : await db
          .insert(research)
          .values({ ...values, organisationId: org.id, createdBy: user.id, aiGenerated: false })
          .returning();
    await logActivity(db, {
      organisationId: org.id,
      userId: user.id,
      type: 'research_saved',
      payload: { researchId: row!.id, manual: true },
    });
    res.json(row);
  });

  return r;
}
