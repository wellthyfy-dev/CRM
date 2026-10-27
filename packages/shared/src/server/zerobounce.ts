import type { EmailCheckStatus } from '../constants';

/** Map a ZeroBounce v2 status to our email_check_status. Role-based "do_not_mail" (e.g. placement@) is risky, not invalid. */
export function mapZeroBounceStatus(status: string, subStatus = ''): EmailCheckStatus {
  switch (status.toLowerCase()) {
    case 'valid':
      return 'valid';
    case 'invalid':
    case 'spamtrap':
      return 'invalid';
    case 'catch-all':
      return 'catch_all';
    case 'abuse':
      return 'risky';
    case 'do_not_mail':
      return ['disposable', 'toxic', 'global_suppression'].includes(subStatus.toLowerCase())
        ? 'invalid'
        : 'risky';
    default:
      return 'unknown';
  }
}

export interface EmailVerifier {
  readonly configured: boolean;
  verify(email: string): Promise<EmailCheckStatus>;
}

export function zeroBounceVerifier(
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): EmailVerifier {
  return {
    configured: !!apiKey,
    async verify(email) {
      if (!apiKey) return 'unknown';
      const url = new URL('https://api.zerobounce.net/v2/validate');
      url.searchParams.set('api_key', apiKey);
      url.searchParams.set('email', email);
      url.searchParams.set('ip_address', '');
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`ZeroBounce HTTP ${res.status}`);
      const body = (await res.json()) as { status?: string; sub_status?: string; error?: string };
      if (body.error) throw new Error('ZeroBounce error');
      return mapZeroBounceStatus(body.status ?? 'unknown', body.sub_status ?? '');
    },
  };
}
