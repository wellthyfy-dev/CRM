import { describe, expect, it } from 'vitest';
import { fetchSitePages } from '../src/server/crawl';
import { assertPublicUrl, isPrivateIp } from '../src/server/url-guard';

const resolveTo = (address: string) => (async () => [{ address, family: 4 }]) as never;

describe('SSRF guard', () => {
  it('classifies private and reserved addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.5.4',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      '::ffff:10.0.0.1',
    ]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
    for (const ip of ['8.8.8.8', '103.21.244.1', '2606:4700::1111']) expect(isPrivateIp(ip)).toBe(false);
  });

  it('rejects non-http schemes, odd ports, credentials, internal names and private resolutions', async () => {
    await expect(assertPublicUrl('ftp://x.in/', resolveTo('8.8.8.8'))).rejects.toThrow(/http/);
    await expect(assertPublicUrl('http://x.in:8080/', resolveTo('8.8.8.8'))).rejects.toThrow(/ports/);
    await expect(assertPublicUrl('http://u:p@x.in/', resolveTo('8.8.8.8'))).rejects.toThrow(/credentials/);
    await expect(assertPublicUrl('http://localhost/', resolveTo('8.8.8.8'))).rejects.toThrow(/Internal/);
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/private/);
    await expect(assertPublicUrl('https://evil.in/', resolveTo('10.0.0.5'))).rejects.toThrow(/private/);
    await expect(
      assertPublicUrl('https://college.ac.in/', resolveTo('103.21.244.1')),
    ).resolves.toBeInstanceOf(URL);
  });

  it('crawler re-checks every redirect hop', async () => {
    const fetchImpl = (async (url: string) => {
      if (url === 'https://college.ac.in/') {
        return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } });
      }
      return new Response('<html>secret</html>', { headers: { 'content-type': 'text/html' } });
    }) as unknown as typeof fetch;
    const guard = async (u: string) => {
      if (new URL(u).hostname.startsWith('169.')) throw new Error('blocked');
    };
    expect(await fetchSitePages('https://college.ac.in/', fetchImpl, guard)).toEqual([]);
  });

  it('crawler fetches the home page and relevant same-domain links', async () => {
    const pages: Record<string, string> = {
      'https://college.ac.in/':
        '<title>Home</title><a href="/placement">Placement</a><a href="https://facebook.com/x">fb</a>',
      'https://college.ac.in/placement': '<p>Dr. Rao, Placement Officer, placement@college.ac.in</p>',
    };
    const fetchImpl = (async (url: string) =>
      new Response(pages[url] ?? '', {
        status: pages[url] ? 200 : 404,
        headers: { 'content-type': 'text/html' },
      })) as unknown as typeof fetch;
    const result = await fetchSitePages('https://college.ac.in/', fetchImpl, async () => {});
    expect(result.map((p) => p.url)).toEqual(['https://college.ac.in/', 'https://college.ac.in/placement']);
    expect(result[1]!.text).toContain('placement@college.ac.in');
  });
});
