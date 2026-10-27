// Rule-based reply classification (runs before any AI). Pure and unit-tested.

export type RuleClassification = 'bounce' | 'unsubscribe' | 'not_interested' | 'out_of_office';

export interface InboundSummary {
  fromAddress: string;
  subject: string;
  text: string;
  /** Lowercased header names → values. */
  headers: Record<string, string>;
  contentType?: string;
}

/** Remove quoted history ("> …" lines and everything after "On … wrote:" / Outlook separators). */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (
      /^on .+wrote:$/i.test(t) ||
      /^-{2,}\s*original message\s*-{2,}$/i.test(t) ||
      (/^from:\s.+/i.test(t) && out.length > 0)
    )
      break;
    if (/^_{5,}$/.test(t)) break;
    if (t.startsWith('>')) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}

const BOUNCE_FROM = /(mailer-daemon|postmaster|mail delivery (sub)?system)/i;
const BOUNCE_SUBJECT =
  /(delivery status notification|undeliverable|undelivered mail|delivery (has )?failed|failure notice|returned mail|mail delivery failed|delivery failure)/i;
const OOO_SUBJECT =
  /(out of (the )?office|auto(matic)?[- ]?reply|autoreply|on leave|on vacation|away from (the )?office|absence)/i;
const OOO_BODY = /(i am|i'm|i will be) (currently )?(out of (the )?office|on leave|on vacation|away)/i;
const UNSUBSCRIBE =
  /(^|\b)(stop|unsubscribe|remove me|take me off|do not (contact|email) me|don't (contact|email) me)(\b|$)/i;
const NOT_INTERESTED = /\bnot interested\b/i;

export function classifyByRules(msg: InboundSummary): RuleClassification | null {
  const from = msg.fromAddress.toLowerCase();
  const subject = msg.subject ?? '';
  if (
    BOUNCE_FROM.test(from) ||
    BOUNCE_SUBJECT.test(subject) ||
    /multipart\/report/i.test(msg.contentType ?? '') ||
    /delivery-status/i.test(msg.contentType ?? '')
  ) {
    return 'bounce';
  }
  const autoSubmitted = (msg.headers['auto-submitted'] ?? '').toLowerCase();
  const fresh = stripQuoted(msg.text ?? '');
  if (
    OOO_SUBJECT.test(subject) ||
    (autoSubmitted && autoSubmitted !== 'no') ||
    'x-autoreply' in msg.headers ||
    OOO_BODY.test(fresh)
  ) {
    return 'out_of_office';
  }
  // Opt-out keywords are checked on the reply's own text (not quoted history, which contains our STOP line).
  const firstPart = fresh.slice(0, 1000);
  if (NOT_INTERESTED.test(firstPart) || NOT_INTERESTED.test(subject)) return 'not_interested';
  if (UNSUBSCRIBE.test(firstPart) || /^\s*(re:\s*)?(stop|unsubscribe)\s*$/i.test(subject))
    return 'unsubscribe';
  return null;
}

/** Message-IDs (<…@…>) mentioned anywhere in a text — used to match bounces to the original email. */
export function extractMessageIds(text: string): string[] {
  return [...new Set(text.match(/<[^<>\s@]+@[^<>\s]+>/g) ?? [])];
}

/** Parse an In-Reply-To / References header into Message-IDs. */
export function parseMessageIdHeader(value: string | string[] | undefined | null): string[] {
  if (!value) return [];
  const s = Array.isArray(value) ? value.join(' ') : value;
  return extractMessageIds(s);
}

/** Short one-line snippet of the reply's own text. */
export function replySnippet(text: string, max = 280): string {
  const s = stripQuoted(text).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
