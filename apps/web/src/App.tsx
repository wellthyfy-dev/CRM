import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { useAuth } from '@/lib/auth';
import { canAccess } from '@/lib/nav';
import { LoginPage } from '@/pages/LoginPage';
import { PlaceholderPage } from '@/pages/PlaceholderPage';

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
          <Route index element={<PlaceholderPage title="Dashboard" />} />
          <Route path="*" element={<PlaceholderPage title="Coming soon" />} />
        </Route>
      </Route>
    </Routes>
  );
}
