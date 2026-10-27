import { arrangeOrgWithContact, expect, loginAs, test } from './fixtures';

test.describe('send gate blocks', () => {
  test('unverified contact: no "Create email", API refuses a draft', async ({ page, researcherApi }) => {
    const { org, contact } = await arrangeOrgWithContact(researcherApi, { verified: false });
    await loginAs(page, 'researcher');
    await page.goto(`/organisations/${org.id}`);
    await page.getByRole('tab', { name: /Contacts/ }).click();
    const row = page.getByTestId(`contact-${contact.email}`);
    await expect(row.getByText('not verified')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Create email' })).toHaveCount(0);
    const res = await researcherApi.raw('POST', '/api/emails', {
      organisationId: org.id,
      contactId: contact.id,
    });
    expect(res.status()).toBe(400);
    expect(await res.text()).toContain('verified');
  });

  test('opted-out contact: pending email is cancelled and cannot be re-created', async ({
    page,
    researcherApi,
  }) => {
    const { org, contact } = await arrangeOrgWithContact(researcherApi, { verified: true });
    const email = await researcherApi.post<{ id: string }>('/api/emails', {
      organisationId: org.id,
      contactId: contact.id,
    });
    await researcherApi.post(`/api/emails/${email.id}/submit`);

    await loginAs(page, 'researcher');
    await page.goto(`/organisations/${org.id}`);
    await page.getByRole('tab', { name: /Contacts/ }).click();
    const row = page.getByTestId(`contact-${contact.email}`);
    await row.getByTitle('Opt out').click();
    await page.getByRole('button', { name: 'Opt out permanently' }).click();
    await expect(row.getByText('opted out')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Create email' })).toHaveCount(0);

    await page.goto(`/emails/${email.id}`);
    await expect(page.getByText('cancelled')).toBeVisible();
    const res = await researcherApi.raw('POST', '/api/emails', {
      organisationId: org.id,
      contactId: contact.id,
    });
    expect(res.status()).toBe(400);
  });

  test('do-not-contact organisation: admin approval is blocked with the gate reason', async ({
    page,
    researcherApi,
  }) => {
    const { org, contact } = await arrangeOrgWithContact(researcherApi, { verified: true });
    const email = await researcherApi.post<{ id: string }>('/api/emails', {
      organisationId: org.id,
      contactId: contact.id,
    });
    await researcherApi.post(`/api/emails/${email.id}/submit`);
    await researcherApi.patch(`/api/organisations/${org.id}`, { doNotContact: true });

    await loginAs(page, 'admin');
    await page.goto(`/emails/${email.id}`);
    await expect(page.getByText('Organisation is marked do-not-contact')).toBeVisible();
    await page.getByTestId('approve-email').click();
    await expect(page.getByText(/Cannot approve: .*do-not-contact/)).toBeVisible();
    await expect(page.getByText('pending approval')).toBeVisible();
  });
});
