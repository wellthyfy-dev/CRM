// Email-address and domain helpers (ported from isValidEmail_ in the reference script, broadened).

const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]{2,}$/;

const RESERVED_TLDS = new Set(['example', 'test', 'invalid', 'localhost', 'local']);
const PLACEHOLDER_LABELS = new Set(['example', 'sample', 'test', 'dummy', 'placeholder']);

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmailSyntax(email: string): boolean {
  const e = email.trim();
  if (e.length > 254 || !EMAIL_RE.test(e)) return false;
  const [local, domain] = e.split('@') as [string, string];
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  return domain
    .split('.')
    .every((label) => label.length > 0 && !label.startsWith('-') && !label.endsWith('-'));
}

/** True for example/sample/test domains that must never be emailed (e.g. example.edu, sample.com). */
export function isExampleDomain(email: string): boolean {
  const domain = normaliseEmail(email).split('@')[1] ?? '';
  if (!domain) return true;
  const labels = domain.split('.');
  const tld = labels[labels.length - 1] ?? '';
  if (RESERVED_TLDS.has(tld)) return true;
  return labels.some((l) => PLACEHOLDER_LABELS.has(l));
}

export function isSendableAddress(email: string | null | undefined): boolean {
  return !!email && isValidEmailSyntax(email) && !isExampleDomain(email);
}

export function isHttpUrl(value: string | null | undefined): boolean {
  return !!value && /^https?:\/\//i.test(value.trim());
}

/** "https://www.Example.co.in/about" → "example.co.in". Returns null when no hostname can be parsed. */
export function normaliseDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let value = input.trim().toLowerCase();
  if (!value) return null;
  if (value.includes('@') && !value.includes('/')) value = value.split('@')[1] ?? '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(value)) value = `https://${value}`;
  try {
    const host = new URL(value).hostname.replace(/^www\d?\./, '').replace(/\.$/, '');
    return host.includes('.') ? host : null;
  } catch {
    return null;
  }
}

/** Ensure a website value has a scheme, so links work. */
export function normaliseWebsite(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = input.trim();
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export function emailDomain(email: string): string {
  return normaliseEmail(email).split('@')[1] ?? '';
}
