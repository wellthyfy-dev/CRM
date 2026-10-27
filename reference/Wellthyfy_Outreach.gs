/**
 * WELLTHYFY TRAINING OUTREACH AUTOMATION — STARTER VERSION
 * Creates Gmail drafts only. It never sends emails.
 *
 * Install:
 * 1. Upload Wellthyfy_Outreach_CRM.xlsx to Drive and open as Google Sheets.
 * 2. Extensions > Apps Script.
 * 3. Replace the editor contents with this file, save, then reload the spreadsheet.
 * 4. Use menu: Wellthyfy Outreach > Create Gmail drafts for approved rows.
 *
 * Safety gate: Contact Verified must be YES, Approval Status must be
 * APPROVED FOR DRAFT, Opt-out must not be YES, and recipient email must look valid.
 */

const SHEET_ORGS = 'Organisations';
const SHEET_LOG = 'Email Drafts';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Wellthyfy Outreach')
    .addItem('Create Gmail drafts for approved rows', 'createApprovedDrafts')
    .addItem('Create draft for selected row', 'createDraftForSelectedRow')
    .addItem('Update dashboard formulas', 'refreshDashboard')
    .addToUi();
}

function createApprovedDrafts() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEET_ORGS);
  if (!sheet) throw new Error('Missing Organisations sheet.');
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    SpreadsheetApp.getUi().alert('No organisation rows found yet.');
    return;
  }
  const headers = values[0].map(String);
  const idx = headerMap_(headers);
  const required = ['Record ID','Organisation Name','Organisation Type','Contact Person',
    'Designation','Official Email','Contact Source URL','Contact Verified (YES/NO)',
    'Likely Training Need / Website Evidence','Recommended Programme','Duration / Format',
    'Personalisation Note','Email Subject','Email Body Override (optional)','Approval Status',
    'Draft Created?','Draft Created At','Outreach Status','Opt-out? (YES/NO)'];
  required.forEach(h => { if (idx[h] === undefined) throw new Error('Missing column: ' + h); });

  let created = 0, skipped = 0;
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (String(row[idx['Record ID']] || '').startsWith('SAMPLE-')) { skipped++; continue; }
    const result = createDraftForRow_(sheet, row, idx, r + 1);
    if (result === 'created') created++; else skipped++;
  }
  SpreadsheetApp.getUi().alert('Draft creation complete.\nCreated: ' + created + '\nSkipped: ' + skipped +
    '\n\nOpen Gmail > Drafts to review each message. Nothing was sent.');
}

function createDraftForSelectedRow() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getActiveSheet();
  if (sheet.getName() !== SHEET_ORGS) {
    SpreadsheetApp.getUi().alert('Select a row in the Organisations sheet first.');
    return;
  }
  const activeRow = sheet.getActiveRange().getRow();
  if (activeRow < 2) {
    SpreadsheetApp.getUi().alert('Select an organisation data row, not the header.');
    return;
  }
  const values = sheet.getDataRange().getValues();
  const idx = headerMap_(values[0].map(String));
  const result = createDraftForRow_(sheet, values[activeRow - 1], idx, activeRow);
  SpreadsheetApp.getUi().alert(result === 'created'
    ? 'Gmail draft created. Review it in Gmail > Drafts. Nothing was sent.'
    : 'Draft not created. Check verification, approval, email, opt-out and existing-draft fields.');
}

function createDraftForRow_(sheet, row, idx, sheetRow) {
  const get = h => row[idx[h]];
  const recordId = String(get('Record ID') || '').trim();
  const organisation = String(get('Organisation Name') || '').trim();
  const recipient = String(get('Official Email') || '').trim();
  const verified = String(get('Contact Verified (YES/NO)') || '').toUpperCase() === 'YES';
  const approved = String(get('Approval Status') || '').toUpperCase() === 'APPROVED FOR DRAFT';
  const optedOut = String(get('Opt-out? (YES/NO)') || '').toUpperCase() === 'YES';
  const alreadyDrafted = String(get('Draft Created?') || '').toUpperCase() === 'YES';
  const source = String(get('Contact Source URL') || '').trim();

  if (!recordId || !organisation || !verified || !approved || optedOut || alreadyDrafted ||
      !isValidEmail_(recipient) || !/^https?:\/\//i.test(source)) return 'skipped';

  const contact = String(get('Contact Person') || '').trim();
  const designation = String(get('Designation') || '').trim();
  const type = String(get('Organisation Type') || '').trim();
  const need = String(get('Likely Training Need / Website Evidence') || '').trim();
  const programme = String(get('Recommended Programme') || '').trim();
  const duration = String(get('Duration / Format') || '').trim();
  const note = String(get('Personalisation Note') || '').trim();
  let subject = String(get('Email Subject') || '').trim();
  let body = String(get('Email Body Override (optional)') || '').trim();

  if (!subject) subject = defaultSubject_(type, organisation, programme);
  if (!body) body = buildBody_({
    contact, designation, type, organisation, need, programme, duration, note
  });
  body = body
    .replace(/\[Organisation Name\]/g, organisation)
    .replace(/\[Contact Name\]/g, contact || 'Sir/Madam')
    .replace(/\[Company Name\]/g, organisation);

  // Draft only. This is intentionally not GmailApp.sendEmail().
  const draft = GmailApp.createDraft(recipient, subject, body, {
    name: 'Selvaganapathy V. | Wellthyfy Lifestyle Ventures',
    replyTo: 'ceo@wellthyfy.in'
  });

  const now = new Date();
  sheet.getRange(sheetRow, idx['Draft Created?'] + 1).setValue('YES');
  sheet.getRange(sheetRow, idx['Draft Created At'] + 1).setValue(now);
  sheet.getRange(sheetRow, idx['Outreach Status'] + 1).setValue('Draft Created');

  const log = SpreadsheetApp.getActive().getSheetByName(SHEET_LOG);
  if (log) {
    log.appendRow([now, recordId, organisation, recipient, subject, 'Created — review in Gmail',
      draft.getId(), 'Draft only; not sent. Source: ' + source]);
  }
  return 'created';
}

function defaultSubject_(type, organisation, programme) {
  const t = (type + ' ' + programme).toLowerCase();
  if (t.includes('company') || /fmcg|pharma|otc|sales team|startup|business development/.test(t)) {
    return 'Customised Training Proposal | ' + organisation;
  }
  return 'Training Proposal | Career Readiness & Industry-Oriented Skills';
}

function buildBody_(d) {
  const greeting = d.contact ? 'Dear ' + d.contact + ' Sir/Madam,' : 'Dear Sir/Madam,';
  const org = d.organisation;
  const isCompany = String(d.type).toLowerCase().includes('company');
  let body = greeting + '\n\nGreetings from Wellthyfy Lifestyle Ventures.\n\n';

  if (isCompany) {
    body += 'I am reaching out to explore a customised training programme for ' + org +
      '. My 22+ years of industry experience spans frontline sales, territory management, distribution development, sales planning and team leadership across FMCG, consumer healthcare and pharma-related businesses.\n\n';
    body += 'Based on the potential focus area—' + (d.need || d.programme || 'sales capability development') +
      '—possible modules include frontline sales effectiveness, territory and beat planning, distributor management, customer engagement, sales coaching and mid-level manager development.\n\n';
    body += 'The programme can be customised to your business priorities and delivered as a one-day workshop, multi-day programme or contract-based engagement' +
      (d.duration ? ' (' + d.duration + ')' : '') + '.\n\n';
  } else {
    body += 'I would like to explore a customised career-development and employability programme for students at ' + org +
      '. With 22+ years of corporate experience in sales, marketing, distribution and team leadership, I aim to help students connect academic learning with workplace expectations.\n\n';
    body += 'Based on the potential focus area—' + (d.need || d.programme || 'career readiness') +
      '—suggested topics may include communication and presentation skills, interview readiness, campus-to-corporate transition, career opportunities across industries, business development and leadership.\n\n';
    body += 'The content can be customised for the relevant department and delivered as a one-hour guest session, half-day/full-day workshop or multi-day programme' +
      (d.duration ? ' (' + d.duration + ')' : '') + '.\n\n';
  }

  if (d.note) body += 'A relevant point for your organisation: ' + d.note + '\n\n';
  body += 'If this aligns with your current priorities, I would be pleased to discuss the requirements and share a detailed proposal.\n\n';
  body += 'Warm regards,\nSelvaganapathy V.\nMBA – Marketing | Corporate Trainer & Sales Mentor\n' +
    'CEO, Wellthyfy Lifestyle Ventures Pvt. Ltd.\n97519 45999 | ceo@wellthyfy.in | https://wellthyfy.in';
  if (d.designation) body += '\n\nPrepared for: ' + d.designation;
  return body;
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    !/example\.com|example\.edu/i.test(email);
}

function headerMap_(headers) {
  const map = {};
  headers.forEach((h, i) => map[String(h).trim()] = i);
  return map;
}

function refreshDashboard() {
  const ss = SpreadsheetApp.getActive();
  const dash = ss.getSheetByName('Dashboard');
  if (!dash) {
    SpreadsheetApp.getUi().alert('Dashboard sheet not found.');
    return;
  }
  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert('Dashboard formulas refreshed.');
}
