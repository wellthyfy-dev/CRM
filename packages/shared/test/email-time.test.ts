import { describe, expect, it } from 'vitest';
import { isExampleDomain, isSendableAddress, isValidEmailSyntax, normaliseDomain } from '../src/email';
import {
  istParts,
  istWallClockToUtc,
  isWithinSendWindow,
  nextSendOpportunity,
  startOfIstDay,
  startOfIstHour,
} from '../src/time';

describe('email helpers', () => {
  it('validates syntax', () => {
    expect(isValidEmailSyntax('a.b@college.ac.in')).toBe(true);
    expect(isValidEmailSyntax('a@b')).toBe(false);
    expect(isValidEmailSyntax('a..b@x.com')).toBe(false);
    expect(isValidEmailSyntax('a b@x.com')).toBe(false);
  });
  it('detects example/sample domains', () => {
    for (const e of [
      'x@example.com',
      'x@example.edu',
      'x@mail.example.org',
      'x@sample.in',
      'x@foo.test',
      'x@foo.invalid',
    ]) {
      expect(isExampleDomain(e)).toBe(true);
    }
    expect(isExampleDomain('ceo@wellthyfy.in')).toBe(false);
    expect(isSendableAddress('principal@psgcas.ac.in')).toBe(true);
  });
  it('normalises domains', () => {
    expect(normaliseDomain('https://www.PSGTech.edu/about')).toBe('psgtech.edu');
    expect(normaliseDomain('www.abc.co.in')).toBe('abc.co.in');
    expect(normaliseDomain('hr@abc.co.in')).toBe('abc.co.in');
    expect(normaliseDomain('nonsense')).toBeNull();
    expect(normaliseDomain('')).toBeNull();
  });
});

describe('IST time helpers', () => {
  it('converts wall clock to UTC (+05:30)', () => {
    expect(istWallClockToUtc(2026, 10, 27, 10, 0).toISOString()).toBe('2026-10-27T04:30:00.000Z');
    expect(istParts(new Date('2026-10-27T18:45:00Z'))).toMatchObject({
      day: 28,
      hour: 0,
      minute: 15,
      weekday: 'Wed',
    });
  });
  it('computes IST day/hour starts', () => {
    const d = new Date('2026-10-27T05:10:00Z'); // 10:40 IST
    expect(startOfIstDay(d).toISOString()).toBe('2026-10-26T18:30:00.000Z');
    expect(startOfIstHour(d).toISOString()).toBe('2026-10-27T04:30:00.000Z');
  });
  it('checks the send window', () => {
    expect(isWithinSendWindow(istWallClockToUtc(2026, 10, 27, 10, 0), '10:00', '17:00')).toBe(true);
    expect(isWithinSendWindow(istWallClockToUtc(2026, 10, 27, 16, 59), '10:00', '17:00')).toBe(true);
    expect(isWithinSendWindow(istWallClockToUtc(2026, 10, 27, 17, 0), '10:00', '17:00')).toBe(false);
  });
  it('finds the next send opportunity', () => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    // Saturday 31 Oct 2026 18:00 IST → Monday 2 Nov 10:00 IST
    const next = nextSendOpportunity(istWallClockToUtc(2026, 10, 31, 18, 0), '10:00', '17:00', days);
    expect(next?.toISOString()).toBe(istWallClockToUtc(2026, 11, 2, 10, 0).toISOString());
    const inside = istWallClockToUtc(2026, 10, 27, 12, 0);
    expect(nextSendOpportunity(inside, '10:00', '17:00', days)).toEqual(inside);
    expect(nextSendOpportunity(inside, '10:00', '17:00', [])).toBeNull();
  });
});
