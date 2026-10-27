import { arrangeOrgWithContact, expect, loginAs, test } from './fixtures';

test.describe('approval by role', () => {
  test('researcher drafts and submits but cannot approve; admin approves', async ({
    page,
    browser,
    researcherApi,
  }) => {
    const { org } = await arrangeOrgWithContact(researcherApi, { verified: true });

    // Researcher: compose from the contact, save & submit.
    await loginAs(page, 'researcher');
    await page.goto(`/organisations/${org.id}`);
    await page.getByRole('tab', { name: /Contacts/ }).click();
    await page.getByRole('button', { name: 'Create email' }).click();
    await expect(page.getByLabel('Subject')).toHaveValue(/Training Proposal/);
    await expect(page.getByLabel('Body')).toHaveValue(/simply reply STOP\.$/);
    await page.getByRole('button', { name: 'Save & submit for approval' }).click();
    await expect(page).toHaveURL(/\/emails\//);
    await expect(page.getByText('pending approval')).toBeVisible();
    await expect(page.getByTestId('approve-email')).toHaveCount(0);
    // No Approvals menu and no access to the page.
    await expect(page.getByRole('link', { name: 'Approvals' })).toHaveCount(0);
    await page.goto('/approvals');
    await expect(page.getByText('You do not have access to this page.')).toBeVisible();

    // Admin: approve from the Approvals page.
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await loginAs(admin, 'admin');
    await admin.goto('/approvals');
    const item = admin.getByTestId('approval-item').filter({ hasText: org.name });
    await expect(item).toBeVisible();
    await expect(item.getByRole('link', { name: /\/principal$/ })).toBeVisible();
    await item.getByRole('button', { name: 'Approve' }).click();
    await expect(admin.getByText('Approved', { exact: true })).toBeVisible();
    await expect(admin.getByTestId('approval-item').filter({ hasText: org.name })).toHaveCount(0);
    await adminContext.close();
  });

  test('viewer sees emails read-only', async ({ page }) => {
    await loginAs(page, 'viewer');
    await page.goto('/emails');
    await expect(page.getByRole('heading', { name: 'Emails' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Approvals' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  });
});
