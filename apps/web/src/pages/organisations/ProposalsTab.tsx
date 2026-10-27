import { EmptyState } from '@/components/common';
import type { OrganisationDetail } from '@/lib/types';

/** Proposals are added in Step 3. */
export function ProposalsTab(_props: { detail: OrganisationDetail }) {
  return <EmptyState>Proposals will appear here.</EmptyState>;
}
