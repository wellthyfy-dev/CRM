import type { ServerEnv } from './env';

// Internal staff notifications via Resend. NEVER used for prospects (Resend forbids cold outreach):
// recipients are always ALERT_EMAIL_TO, never a caller-supplied address.

export interface StaffNotifier {
  readonly configured: boolean;
  send(message: { subject: string; text: string; html?: string }): Promise<void>;
}

export function staffRecipients(env: Pick<ServerEnv, 'ALERT_EMAIL_TO'>): string[] {
  return (env.ALERT_EMAIL_TO ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function resendNotifier(
  env: Pick<ServerEnv, 'RESEND_API_KEY' | 'RESEND_FROM' | 'ALERT_EMAIL_TO'>,
  fetchImpl: typeof fetch = fetch,
): StaffNotifier {
  const to = staffRecipients(env);
  const configured = !!env.RESEND_API_KEY && !!env.RESEND_FROM && to.length > 0;
  return {
    configured,
    async send({ subject, text, html }) {
      if (!configured) return;
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: env.RESEND_FROM,
          to,
          subject: `[Wellthyfy CRM] ${subject}`,
          text,
          html,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Resend HTTP ${res.status}`);
    },
  };
}
