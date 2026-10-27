import {
  BarChart3,
  Building2,
  CheckSquare,
  ClipboardList,
  FileText,
  GraduationCap,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  ListOrdered,
  Mail,
  Search,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@wellthyfy/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
}

const ALL: Role[] = ['admin', 'researcher', 'viewer'];

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ALL },
  { to: '/organisations', label: 'Organisations', icon: Building2, roles: ALL },
  { to: '/pipeline', label: 'Pipeline', icon: KanbanSquare, roles: ALL },
  { to: '/discovery', label: 'Discovery', icon: Search, roles: ['admin', 'researcher'] },
  { to: '/approvals', label: 'Approvals', icon: CheckSquare, roles: ['admin'] },
  { to: '/emails', label: 'Emails', icon: Mail, roles: ALL },
  { to: '/queue', label: 'Queue', icon: ListOrdered, roles: ['admin'] },
  { to: '/replies', label: 'Replies', icon: Inbox, roles: ALL },
  { to: '/proposals', label: 'Proposals', icon: FileText, roles: ALL },
  { to: '/templates', label: 'Templates', icon: ClipboardList, roles: ALL },
  { to: '/programmes', label: 'Programmes', icon: GraduationCap, roles: ALL },
  { to: '/reports', label: 'Reports', icon: BarChart3, roles: ALL },
  { to: '/settings', label: 'Settings', icon: Settings, roles: ['admin'] },
  { to: '/users', label: 'Users', icon: Users, roles: ['admin'] },
];

export function navFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((i) => i.roles.includes(role));
}

export function canAccess(path: string, role: Role): boolean {
  const item = NAV_ITEMS.filter((i) => i.to !== '/').find(
    (i) => path === i.to || path.startsWith(`${i.to}/`),
  );
  return item ? item.roles.includes(role) : true;
}
