import { Navigate, Route, Routes } from 'react-router-dom';
import { ShellLayout } from './components/ShellLayout';
import { RequireAuth } from './components/RequireAuth';
import { LoginPage } from './pages/LoginPage';
import { CatalogPage } from './pages/CatalogPage';
import { AppFramePage } from './pages/AppFramePage';
import { UsersAdminPage } from './pages/UsersAdminPage';
import { AppsAdminPage } from './pages/AppsAdminPage';
import { ExtrasPage } from './pages/ExtrasPage';
import { IpScanPage } from './pages/IpScanPage';
import { CardCheckPage } from './pages/CardCheckPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <ShellLayout />
          </RequireAuth>
        }
      >
        <Route index element={<CatalogPage />} />
        <Route path="extras" element={<ExtrasPage />} />
        <Route path="extras/ip-scan" element={<IpScanPage />} />
        <Route path="extras/card-check" element={<CardCheckPage />} />
        <Route path="app/:appId" element={<AppFramePage />} />
        <Route
          path="admin/users"
          element={
            <RequireAuth adminOnly>
              <UsersAdminPage />
            </RequireAuth>
          }
        />
        <Route
          path="admin/apps"
          element={
            <RequireAuth adminOnly>
              <AppsAdminPage />
            </RequireAuth>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
