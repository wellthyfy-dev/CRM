import { describe, expect, it } from 'vitest';
import { canAccess, navFor } from './nav';

describe('role-aware navigation', () => {
  it('admins see everything', () => {
    expect(navFor('admin').map((i) => i.label)).toEqual([
      'Dashboard',
      'Organisations',
      'Pipeline',
      'Discovery',
      'Approvals',
      'Emails',
      'Queue',
      'Replies',
      'Proposals',
      'Templates',
      'Programmes',
      'Reports',
      'Settings',
      'Users',
    ]);
  });
  it('researchers cannot see approvals, queue, settings or users', () => {
    const labels = navFor('researcher').map((i) => i.label);
    expect(labels).not.toContain('Approvals');
    expect(labels).not.toContain('Queue');
    expect(labels).not.toContain('Settings');
    expect(labels).not.toContain('Users');
    expect(labels).toContain('Discovery');
  });
  it('viewers have read-only pages only', () => {
    expect(navFor('viewer').map((i) => i.label)).not.toContain('Discovery');
    expect(canAccess('/settings', 'viewer')).toBe(false);
    expect(canAccess('/organisations/abc', 'viewer')).toBe(true);
  });
});
