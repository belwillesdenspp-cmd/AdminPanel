import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth';
import type { AppInfo } from '../types';

const SIDEBAR_KEY = 'adminpanel.sidebarCollapsed';

function readCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

function AppGlyph({ id }: { id: string }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };

  switch (id) {
    case 'instructions':
      return (
        <svg {...common}>
          <path d="M5 4.5h10.5A2.5 2.5 0 0 1 18 7v12.5H7.5A2.5 2.5 0 0 1 5 17V4.5Z" />
          <path d="M5 17a2.5 2.5 0 0 1 2.5-2.5H18" />
          <path d="M9 8.5h5.5M9 12h4" />
        </svg>
      );
    case 'tmc':
      return (
        <svg {...common}>
          <path d="M4.5 8.5 12 4l7.5 4.5v7L12 20l-7.5-4.5v-7Z" />
          <path d="M12 12v8M12 12 4.5 8.5M12 12l7.5-3.5" />
        </svg>
      );
    case 'torcy':
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="12" rx="2" />
          <path d="M8 21h8M12 17v4" />
          <path d="M8 9.5h8M8 13h5" />
        </svg>
      );
    case 'compusers':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3.25" />
          <path d="M5.5 18.5c1.4-2.8 3.6-4.2 6.5-4.2s5.1 1.4 6.5 4.2" />
          <path d="M17.5 7.5a2.5 2.5 0 0 1 0 5" />
          <path d="M19.8 18.2c.7-1.3 1.1-2.4 1.1-3.4" />
        </svg>
      );
    case 'citrix':
      return (
        <svg {...common}>
          <rect x="3.5" y="4.5" width="17" height="12.5" rx="2" />
          <path d="M8 20h8M12 17v3" />
          <circle cx="9" cy="10.5" r="1.6" />
          <path d="M13 9.2h4.2M13 12h3" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="4" y="4" width="7" height="7" rx="1.5" />
          <rect x="13" y="4" width="7" height="7" rx="1.5" />
          <rect x="4" y="13" width="7" height="7" rx="1.5" />
          <rect x="13" y="13" width="7" height="7" rx="1.5" />
        </svg>
      );
  }
}

function NavGlyph({ kind }: { kind: 'home' | 'users' | 'apps' }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };

  if (kind === 'home') {
    return (
      <svg {...common}>
        <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" />
      </svg>
    );
  }
  if (kind === 'users') {
    return (
      <svg {...common}>
        <circle cx="9" cy="8.5" r="3" />
        <path d="M3.5 18.5c1.2-2.6 3.1-3.9 5.5-3.9s4.3 1.3 5.5 3.9" />
        <path d="M16.5 8a2.7 2.7 0 1 1 0 5.4" />
        <path d="M19.2 18.3c.8-1.4 1.2-2.6 1.2-3.7" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M5 7h14M5 12h14M5 17h10" />
      <circle cx="8" cy="7" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="11" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9" cy="17" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ShellLayout() {
  const { user, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const { appId } = useParams();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [apps, setApps] = useState<AppInfo[]>([]);

  const loadApps = useCallback(async () => {
    try {
      const data = await api.listApps();
      setApps(data.apps);
      await refresh();
    } catch {
      // keep previous list
    }
  }, [refresh]);

  useEffect(() => {
    void loadApps();
    const id = window.setInterval(() => void loadApps(), 15000);
    return () => window.clearInterval(id);
  }, [loadApps]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  }

  if (!user) return <Outlet />;

  return (
    <div className={`app-shell${collapsed ? ' app-shell--collapsed' : ''}`}>
      <aside className="sidebar" aria-label="Навигация">
        <div className="sidebar-top">
          <div className="sidebar-brand" title="AdminPanel">
            <span className="sidebar-brand-mark" aria-hidden>
              AP
            </span>
            {!collapsed && (
              <div className="sidebar-brand-text">
                <strong>AdminPanel</strong>
                <span>Сектор ТП</span>
              </div>
            )}
          </div>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={toggleCollapsed}
            title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
            aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
            aria-expanded={!collapsed}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              {collapsed ? (
                <path
                  d="M9 6l6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : (
                <path
                  d="M15 6l-6 6 6 6"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>
          </button>
        </div>

        <nav className="sidebar-section" aria-label="Разделы панели">
          {!collapsed && <div className="sidebar-label">Панель</div>}
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `sidebar-link${isActive && !appId ? ' active' : ''}`
            }
            title="Обзор"
          >
            <span className="sidebar-link-icon">
              <NavGlyph kind="home" />
            </span>
            {!collapsed && <span className="sidebar-link-text">Обзор</span>}
          </NavLink>
          {user.role === 'admin' && (
            <>
              <NavLink
                to="/admin/users"
                className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
                title="Пользователи"
              >
                <span className="sidebar-link-icon">
                  <NavGlyph kind="users" />
                </span>
                {!collapsed && <span className="sidebar-link-text">Пользователи</span>}
              </NavLink>
              <NavLink
                to="/admin/apps"
                className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
                title="Управление приложениями"
              >
                <span className="sidebar-link-icon">
                  <NavGlyph kind="apps" />
                </span>
                {!collapsed && (
                  <span className="sidebar-link-text">Управление приложениями</span>
                )}
              </NavLink>
            </>
          )}
        </nav>

        <div className="sidebar-divider" role="separator" />

        <nav className="sidebar-section sidebar-section--apps" aria-label="Приложения">
          {!collapsed && (
            <div className="sidebar-label-row">
              <div className="sidebar-label">Приложения</div>
              <button
                type="button"
                className="sidebar-refresh"
                onClick={() => void loadApps()}
                title="Обновить статус"
                aria-label="Обновить статус приложений"
              >
                ↻
              </button>
            </div>
          )}
          {apps.length === 0 && !collapsed && (
            <p className="sidebar-empty">Нет доступных приложений</p>
          )}
          {apps.map((app) => {
            const inactive = !app.enabled;
            const statusClass = inactive
              ? 'inactive'
              : app.online
                ? 'online'
                : 'offline';
            return (
              <NavLink
                key={app.id}
                to={inactive ? '#' : `/app/${app.id}`}
                onClick={(e) => {
                  if (inactive) e.preventDefault();
                }}
                className={({ isActive }) =>
                  `sidebar-link sidebar-app${isActive && !inactive ? ' active' : ''}${
                    inactive ? ' is-disabled' : ''
                  }`
                }
                title={
                  inactive
                    ? `${app.title} (неактивно)`
                    : `${app.title}${app.online ? ' · онлайн' : ' · офлайн'}`
                }
                aria-disabled={inactive}
              >
                <span className="sidebar-link-icon">
                  <AppGlyph id={app.id} />
                  <span className={`sidebar-status ${statusClass}`} aria-hidden />
                </span>
                {!collapsed && (
                  <span className="sidebar-link-text">
                    <span className="sidebar-app-title">{app.title}</span>
                    <span className="sidebar-app-meta">
                      {inactive ? 'неактивно' : app.online ? 'онлайн' : 'офлайн'}
                    </span>
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user" title={`${user.displayName} · ${user.role}`}>
            <span className="sidebar-user-avatar" aria-hidden>
              {(user.displayName || user.username || '?').slice(0, 1).toUpperCase()}
            </span>
            {!collapsed && (
              <span className="sidebar-user-text">
                <strong>{user.displayName}</strong>
                <span>{user.role === 'admin' ? 'админ' : 'специалист'}</span>
              </span>
            )}
          </div>
          <button
            type="button"
            className="sidebar-logout"
            title="Выход"
            aria-label="Выход"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
              <path
                d="M10 12h9M15.5 8.5 19 12l-3.5 3.5"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {!collapsed && <span>Выход</span>}
          </button>
        </div>
      </aside>

      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  );
}
