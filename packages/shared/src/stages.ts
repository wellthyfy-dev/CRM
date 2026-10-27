import { stageRank, type Stage } from './constants';

/**
 * Automatic forward-only stage movement (e.g. email sent → "sent"). Never moves an organisation backwards and never
 * moves one out of lost / on_hold automatically — those are manual decisions.
 */
export function advancedStage(current: Stage, target: Stage): Stage | null {
  const cur = stageRank(current);
  const tgt = stageRank(target);
  if (cur < 0 || tgt < 0) return null;
  return tgt > cur ? target : null;
}
