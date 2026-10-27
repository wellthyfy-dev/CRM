import { simpleParser, type AddressObject } from 'mailparser';
import { parseMessageIdHeader } from '@wellthyfy/shared';
import type { ParsedMail } from '../runtime';

function addresses(a: AddressObject | AddressObject[] | undefined): string[] {
  const list = Array.isArray(a) ? a : a ? [a] : [];
  return list.flatMap((x) => x.value.map((v) => v.address ?? '')).filter(Boolean);
}

/** Parse a raw RFC 822 message into the fields reply tracking needs. */
export async function parseMail(raw: Buffer): Promise<ParsedMail> {
  const m = await simpleParser(raw, { skipHtmlToText: false, skipImageLinks: true });
  const headers: Record<string, string> = {};
  for (const [k, v] of m.headers) headers[k.toLowerCase()] = typeof v === 'string' ? v : JSON.stringify(v);
  const ct = m.headers.get('content-type') as { value?: string } | string | undefined;
  return {
    messageId: m.messageId ?? null,
    inReplyTo: parseMessageIdHeader(m.inReplyTo)[0] ?? null,
    references: parseMessageIdHeader(m.references),
    fromAddress: addresses(m.from)[0] ?? '',
    to: addresses(m.to),
    subject: m.subject ?? '',
    text: m.text ?? '',
    date: m.date ?? null,
    headers,
    contentType: typeof ct === 'string' ? ct : (ct?.value ?? ''),
  };
}
