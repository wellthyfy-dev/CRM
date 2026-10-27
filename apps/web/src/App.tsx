import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { useAuth } from '@/lib/auth';
import { canAccess } from '@/lib/nav';
import { DashboardPage } from '@/pages/DashboardPage';
import { ApprovalsPage } from '@/pages/emails/ApprovalsPage';
import { EmailDetailPage } from '@/pages/emails/EmailDetailPage';
import { EmailsPage } from '@/pages/emails/EmailsPage';
import { LoginPage } from '@/pages/LoginPage';
import { ImportPage } from '@/pages/organisations/ImportPage';
import { OrganisationDetailPage } from '@/pages/organisations/OrganisationDetailPage';
import { OrganisationsPage } from '@/pages/organisations/OrganisationsPage';
import { PipelinePage } from '@/pages/PipelinePage';
import { PlaceholderPage } from '@/pages/PlaceholderPage';
import { ProgrammesPage } from '@/pages/ProgrammesPage';
import { QueuePage } from '@/pages/QueuePage';
import { RepliesPage } from '@/pages/RepliesPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { TemplatesPage } from '@/pages/TemplatesPage';
import { UsersPage } from '@/pages/UsersPage';

function RequireAuth() {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!canAccess(location.pathname, me.role)) {
    return <div className="p-8 text-sm text-destructive">You do not have access to this page.</div>;
  }
  return <Outlet />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="organisations" element={<OrganisationsPage />} />
          <Route path="organisations/import" element={<ImportPage />} />
          <Route path="organisations/:id" element={<OrganisationDetailPage />} />
          <Route path="pipeline" element={<PipelinePage />} />
          <Route path="discovery" element={<PlaceholderPage title="Discovery" />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="emails" element={<EmailsPage />} />
          <Route path="emails/:id" element={<EmailDetailPage />} />
          <Route path="queue" element={<QueuePage />} />
          <Route path="replies" element={<RepliesPage />} />
          <Route path="proposals" element={<PlaceholderPage title="Proposals" />} />
          <Route path="templates" element={<TemplatesPage />} />
          <Route path="programmes" element={<ProgrammesPage />} />
          <Route path="reports" element={<PlaceholderPage title="Reports" />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="*" element={<PlaceholderPage title="Not found" />} />
        </Route>
      </Route>
    </Routes>
  );
}
