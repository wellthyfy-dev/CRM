import { eq } from 'drizzle-orm';
import { advanceOrg, emails, logActivity, QUEUES } from '@wellthyfy/shared/server';
import { composeEmail, loadEmailWithContact } from '../lib/compose';
import type { JobDefinition } from '../runtime';

/**
 * Create a Titan draft for an approved email (APPEND to \Drafts with \Draft) so it can be reviewed in webmail.
 * dry_run: the append is skipped and logged. The same Message-ID is later used for the real send.
 */
export const imapDraftJob: JobDefinition = {
  queue: QUEUES.imapDraft,
  retryLimit: 3,
  async handler(deps, data) {
    const emailId = String(data.emailId ?? '');
    const loaded = await loadEmailWithContact(deps, emailId);
    if (!loaded) return;
    const { email, contact } = loaded;
    if (!['approved', 'queued'].includes(email.status) || !contact?.email) {
      deps.logger.info({ emailId, status: email.status }, 'imap-draft skipped (not approved)');
      return;
    }
    const { raw, messageId } = await composeEmail(deps, email, contact);
    if (email.imapDraftUid) await deps.mail.deleteDraft(email.imapDraftUid).catch(() => {});
    const uid = await deps.mail.appendDraft(raw);
    await deps.db.update(emails).set({ imapDraftUid: uid, messageId }).where(eq(emails.id, email.id));
    await logActivity(deps.db, {
      organisationId: email.organisationId,
      type: 'titan_draft_created',
      payload: { emailId: email.id, uid, dryRun: deps.mail.mode === 'dry_run' },
    });
    await advanceOrg(deps.db, email.organisationId, 'drafted', null, 'Titan draft created');
  },
};
