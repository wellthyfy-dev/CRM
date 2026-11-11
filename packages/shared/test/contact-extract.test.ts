import { describe, expect, it } from 'vitest';
import {
  designationFromMailbox,
  extractContactDetails,
  pickPrimaryEmail,
  selectContactsToSave,
} from '../src/contact-extract';
import { decodeCfEmail, htmlToText } from '../src/server/crawl';

const page = (url: string, text: string) => ({ url, text });

describe('extractContactDetails', () => {
  it('finds addresses and phones on the page they appear on, including [at]/[dot] obfuscation', () => {
    const { emails, phones } = extractContactDetails([
      page(
        'https://abc.ac.in/',
        'Welcome. Mail us at info@abc.ac.in or call 0422-2345678. logo@2x.png noreply@abc.ac.in',
      ),
      page(
        'https://abc.ac.in/contact',
        'Principal: principal [at] abc [dot] ac [dot] in\nPlacement cell: tpo@abc.ac.in, +91 97519 45999\nInfo again INFO@abc.ac.in',
      ),
    ]);
    expect(emails).toEqual([
      { email: 'info@abc.ac.in', sourceUrl: 'https://abc.ac.in/', designation: 'Office' },
      { email: 'principal@abc.ac.in', sourceUrl: 'https://abc.ac.in/contact', designation: 'Principal' },
      {
        email: 'tpo@abc.ac.in',
        sourceUrl: 'https://abc.ac.in/contact',
        designation: 'Placement / Training Officer',
      },
    ]);
    expect(phones).toEqual([
      { phone: '+91 4222345678', sourceUrl: 'https://abc.ac.in/' },
      { phone: '+91 9751945999', sourceUrl: 'https://abc.ac.in/contact' },
    ]);
  });

  it('drops example domains, vendor widgets, system mailboxes and digit runs that are not phone numbers', () => {
    const { emails, phones } = extractContactDetails([
      page(
        'https://x.com/',
        'a@example.com 123@sentry.io postmaster@x.com Reg No 202412345678 Pincode 641004 Year 2019-2024 hr@x.com',
      ),
    ]);
    expect(emails.map((e) => e.email)).toEqual(['hr@x.com']);
    expect(phones).toEqual([]);
  });

  it('accepts a bare 10-digit mobile number', () => {
    expect(extractContactDetails([page('https://y.in/', 'Call 9876543210 today')]).phones).toEqual([
      { phone: '+91 9876543210', sourceUrl: 'https://y.in/' },
    ]);
  });
});

describe('designationFromMailbox', () => {
  it('maps mailbox names to roles and leaves personal names alone', () => {
    expect(designationFromMailbox('principal.abc@gmail.com')).toBe('Principal');
    expect(designationFromMailbox('careers@co.com')).toBe('HR');
    expect(designationFromMailbox('enquiry@co.com')).toBe('Office');
    expect(designationFromMailbox('ravi.kumar@co.com')).toBeNull();
  });
});

describe('pickPrimaryEmail', () => {
  const found = [
    { email: 'info@abc.ac.in', sourceUrl: 'u', designation: 'Office' },
    { email: 'abcprincipal@gmail.com', sourceUrl: 'u', designation: 'Principal' },
    { email: 'principal@abc.ac.in', sourceUrl: 'u', designation: 'Principal' },
    { email: 'hr@abc.ac.in', sourceUrl: 'u', designation: 'HR' },
  ];

  it('prefers the segment playbook role on the official domain', () => {
    expect(pickPrimaryEmail(found, 'college_university', 'abc.ac.in')?.email).toBe('principal@abc.ac.in');
    expect(pickPrimaryEmail(found, 'company', 'abc.ac.in')?.email).toBe('hr@abc.ac.in');
  });

  it('falls back to whatever exists, and null when nothing was found', () => {
    expect(pickPrimaryEmail([found[1]!], 'company', 'abc.ac.in')?.email).toBe('abcprincipal@gmail.com');
    expect(pickPrimaryEmail([], 'company', null)).toBeNull();
  });
});

describe('website text for contact extraction', () => {
  const CF = '5a2a28333439332a3b361a3b3839743b39743334'; // principal@abc.ac.in, Cloudflare-encoded

  it('decodes Cloudflare-protected addresses in spans and links', () => {
    expect(decodeCfEmail(CF)).toBe('principal@abc.ac.in');
    const { text } = htmlToText(
      `<p>Principal: <a href="/cdn-cgi/l/email-protection#${CF}"><span class="__cf_email__" data-cfemail="${CF}">[email&#160;protected]</span></a></p>`,
    );
    expect(text).toContain('principal@abc.ac.in');
    expect(text).not.toContain('protected');
  });

  it('reads addresses past the AI clip (footer) via fullText', () => {
    const footer = 'x'.repeat(20_000) + ' office@abc.ac.in';
    const { emails } = extractContactDetails([
      { url: 'https://abc.ac.in/', text: footer.slice(0, 16_000), fullText: footer },
    ]);
    expect(emails.map((e) => e.email)).toEqual(['office@abc.ac.in']);
  });
});

describe('selectContactsToSave', () => {
  const e = (email: string) => ({ email, sourceUrl: 'u', designation: null });

  it('keeps only official-domain addresses when the site has any (drops alumni/testimonial addresses)', () => {
    const found = [e('alumnus41295@gmail.com'), e('someone@medtronic.com'), e('principal@mvit.edu.in')];
    expect(selectContactsToSave(found, 'mvit.edu.in').map((f) => f.email)).toEqual(['principal@mvit.edu.in']);
  });

  it('keeps free-mail addresses when the organisation publishes no official one, up to the limit', () => {
    const found = ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => e(`${x}college@gmail.com`));
    expect(selectContactsToSave(found, 'govtcollege.in')).toHaveLength(5);
  });
});
