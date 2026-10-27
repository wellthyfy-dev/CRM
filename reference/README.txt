WELLTHYFY TRAINING OUTREACH AUTOMATION — QUICK START

FILES
- Wellthyfy_Outreach_CRM.xlsx: spreadsheet template with Organisations, Email Drafts, Templates and Dashboard tabs.
- Wellthyfy_Outreach.gs: Apps Script that adds a Wellthyfy Outreach menu and creates Gmail drafts only.
- README.txt: this guide.

SETUP
1. Download Wellthyfy_Outreach_CRM.xlsx and upload it to Google Drive.
2. Right-click > Open with > Google Sheets. Save/convert it as a Google Sheets file.
3. Open Extensions > Apps Script.
4. Replace the editor contents with Wellthyfy_Outreach.gs. Save the project.
5. Reload the spreadsheet. You should see the “Wellthyfy Outreach” menu.
6. Run the menu command “Create Gmail drafts for approved rows”. Google will ask you to authorise access to Gmail and Sheets.
7. In the Organisations tab, replace the SAMPLE rows with real organisations. Do not use the sample emails.
8. Add the official website, contact person's name/designation, official email and source URL. Confirm the contact is relevant and email is published/verified.
9. Set Contact Verified (YES/NO) to YES and Approval Status to APPROVED FOR DRAFT.
10. Run the menu command. The script creates drafts in your Gmail Drafts folder; it never sends.

REQUIRED SAFETY CONDITIONS
- Record ID must be unique.
- Contact Verified = YES.
- Approval Status = APPROVED FOR DRAFT.
- Opt-out? must not be YES.
- Email must be valid and must not be a sample example address.
- Contact Source URL must start with http:// or https://.
- Draft Created? must not already be YES.

CUSTOMISATION
- Email Subject can be edited in the Organisations row.
- If Email Body Override is filled, the script uses it instead of the generated body.
- Otherwise the script uses a college or company-oriented template based on Organisation Type.
- Use Personalisation Note and Likely Training Need / Website Evidence to tailor the message. Do not insert unsupported claims.
- For specific industries, set Industry / Department, Recommended Programme and Duration / Format.

IMPORTANT LIMITATION
This starter version does not automatically search Google or crawl websites. Research contacts from official public pages and record the source URL. Automatic web search can be added later through an approved search API or a research workflow.

OUTREACH PRACTICES
Use relevant professional contact details, send individual targeted emails, honour opt-outs, avoid repeated unwanted follow-ups, and check the current Gmail/Workspace quotas before scaling. Keep a record of sent date and follow-up date manually. The script creates drafts only; you manually review and send from Gmail.

BRAND DETAILS
Selvaganapathy V.
CEO, Wellthyfy Lifestyle Ventures Pvt. Ltd.
97519 45999 | ceo@wellthyfy.in | https://wellthyfy.in
“22 Years in Industry. Now Bringing Industry Experience to the Classroom.”
