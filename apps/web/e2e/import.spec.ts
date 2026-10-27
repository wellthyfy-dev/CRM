import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, loginAs, test, unique } from './fixtures';

const here = path.dirname(fileURLToPath(import.meta.url));
const REFERENCE_XLSX = path.resolve(here, '../../../reference/Wellthyfy_Outreach_CRM.xlsx');

test.describe('import flow', () => {
  test('reference workbook: 26 columns pre-mapped, SAMPLE rows skipped', async ({ page }) => {
    await loginAs(page, 'researcher');
    await page.goto('/organisations/import');
    await page.getByLabel('Spreadsheet file').setInputFiles(REFERENCE_XLSX);
    await expect(page.getByTestId('import-summary')).toContainText('2 rows, 26 columns');
    // Mapping pre-filled from the reference headers.
    await expect(page.getByLabel('Map Organisation name *')).toHaveValue('Organisation Name');
    await expect(page.getByLabel('Map Opt-out (YES/NO)')).toHaveValue('Opt-out? (YES/NO)');
    await page.getByRole('button', { name: 'Check interpretation' }).click();
    await expect(page.getByText('skip: SAMPLE- placeholder row').first()).toBeVisible();
    await page.getByRole('button', { name: /Import 2 rows/ }).click();
    await expect(page.getByTestId('import-report')).toContainText('Created: 0');
    await expect(page.getByTestId('import-report')).toContainText('Skipped: 2');
  });

  test('CSV with real rows creates organisations and reports results', async ({ page }) => {
    await loginAs(page, 'researcher');
    const slug = unique('imp');
    const csv = [
      'Record ID,Organisation Name,Organisation Type,Industry / Department,City,State,Official Website,Contact Person,Designation,Official Email,Contact Source URL,Contact Verified (YES/NO),Approval Status,Outreach Status,Opt-out? (YES/NO)',
      `,${slug} College of Engineering,College / University,Engineering,Coimbatore,Tamil Nadu,https://${slug}.edu.in,Dr. Rao,Principal,principal@${slug}.edu.in,https://${slug}.edu.in/principal,YES,APPROVED FOR DRAFT,Research Needed,NO`,
      `,${slug} Foods Pvt Ltd,Company,FMCG,Chennai,Tamil Nadu,https://${slug}foods.com,,,hr@${slug}foods.com,https://${slug}foods.com/contact,NO,NOT READY,Research Needed,NO`,
      `SAMPLE-9,Sample Row,Company,FMCG,,,,,,,,,,,`,
    ].join('\n');
    await page.goto('/organisations/import');
    await page
      .getByLabel('Spreadsheet file')
      .setInputFiles({ name: 'orgs.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(page.getByTestId('import-summary')).toContainText('3 rows');
    await page.getByRole('button', { name: /Import 3 rows/ }).click();
    await expect(page.getByTestId('import-report')).toContainText('Created: 2');
    await expect(page.getByTestId('import-report')).toContainText('Skipped: 1');
    await page.getByRole('link', { name: new RegExp(`${slug} College of Engineering`) }).click();
    await expect(page.getByTestId('org-name')).toHaveText(`${slug} College of Engineering`);
    await expect(page.getByText('Engineering').first()).toBeVisible();
  });

  test('viewers cannot open the import page', async ({ page }) => {
    await loginAs(page, 'viewer');
    await page.goto('/organisations');
    await expect(page.getByRole('link', { name: 'Import' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New organisation' })).toHaveCount(0);
  });
});
