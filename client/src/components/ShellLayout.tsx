import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { AppMenuIcon } from '../appIcons';
import { useAuth } from '../auth';
import type { AppInfo, NotifyPrefs } from '../types';

const SIDEBAR_KEY = 'adminpanel.sidebarCollapsed';
const DEFAULT_NOTIFY: NotifyPrefs = { position: 'top-center', opacity: 0.92, hideSec: 20 };
let notifyCache: NotifyPrefs | null = null;

function readCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

function PinGlyph({ filled }: { filled: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3.6 14.4 9l6 .7-4.4 4.1 1.2 5.9L12 16.8 6.8 19.7 8 13.8 3.6 9.7l6-.7L12 3.6Z" />
    </svg>
  );
}

function NavGlyph({ kind }: { kind: 'home' | 'users' | 'apps' | 'tools' }) {
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
  if (kind === 'tools') {
    return (
      <svg {...common}>
        <rect x="4" y="4" width="7" height="7" rx="1.5" />
        <rect x="13" y="4" width="7" height="7" rx="1.5" />
        <rect x="4" y="13" width="7" height="7" rx="1.5" />
        <path d="M13.5 16.5h6.5M16.75 13.25v6.5" />
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

function formatWhen(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ru');
}

function shellInstanceId() {
  try {
    const key = 'adminpanel.shellInstance';
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = globalThis.crypto?.randomUUID?.() || `shell-${Date.now()}`;
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch {
    return `shell-${Date.now()}`;
  }
}

function GlpiFocusHeartbeat({ focused, enabled }: { focused: boolean; enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return undefined;
    const instance = shellInstanceId();
    const send = (value: boolean) => {
      void api.glpiRuntimeFocus(instance, value);
    };
    send(focused);
    const id = window.setInterval(() => send(focused), 10000);
    return () => {
      window.clearInterval(id);
      send(false);
    };
  }, [focused, enabled]);
  return null;
}

function GlpiAiOverlay({ hideSec }: { hideSec: number }) {
  const [status, setStatus] = useState<{
    unavailable?: boolean;
    reason?: string;
    lastCheckAt?: string | null;
    recoveredAt?: string | null;
    unavailableSince?: string | null;
  } | null>(null);
  const [hiddenKey, setHiddenKey] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      const next = await api.glpiAiStatus();
      if (!cancelled) setStatus(next);
    }
    void tick();
    const id = window.setInterval(() => void tick(), 10000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const recoveredFresh =
    Boolean(status?.recoveredAt) &&
    !status?.unavailable &&
    Date.now() - Date.parse(status?.recoveredAt || '') < 60_000;
  const showDown = Boolean(status?.unavailable);
  const showUp = recoveredFresh && !showDown;
  const key =
    !showDown && !showUp
      ? ''
      : showDown
        ? `down:${status?.unavailableSince || status?.lastCheckAt || '1'}`
        : `up:${status?.recoveredAt}`;

  useEffect(() => {
    if (!key || hiddenKey === key) return undefined;
    const timer = window.setTimeout(() => setHiddenKey(key), Math.max(5, hideSec) * 1000);
    return () => window.clearTimeout(timer);
  }, [key, hiddenKey, hideSec]);

  if (!key || hiddenKey === key) return null;

  return (
    <div
      className={`shell-ai-alert${showDown ? ' is-down' : ' is-up'}`}
      role="status"
      aria-live="polite"
    >
      <div className="shell-ai-alert__text">
        {showDown ? (
          <>
            <strong>ИИ недоступен.</strong>{' '}
            {status?.reason ? `${status.reason}. ` : ''}
            Анализ и автоназначение заявок GLPI приостановлены.
            {status?.lastCheckAt ? ` Проверка: ${formatWhen(status.lastCheckAt)}.` : ''}
          </>
        ) : (
          <>
            <strong>Связь с ИИ восстановлена.</strong> Автообработка новых заявок GLPI возобновлена.
          </>
        )}
      </div>
      <button
        type="button"
        className="icon-btn shell-ai-alert__close"
        title="Скрыть уведомление"
        aria-label="Скрыть уведомление"
        onClick={() => setHiddenKey(key)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

type TorcyAlert = {
  id: number;
  message?: string;
  kind?: string;
  shopName?: string;
};

function TorcyAlertOverlay({ hide, enabled, hideSec }: { hide: boolean; enabled: boolean; hideSec: number }) {
  const navigate = useNavigate();
  const [toasts, setToasts] = useState<TorcyAlert[]>([]);
  const afterIdRef = useRef(0);
  const primedRef = useRef(false);
  const seenRef = useRef(new Set<number>());
  const hideRef = useRef(hide);
  hideRef.current = hide;

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    async function tick() {
      const afterId = primedRef.current ? afterIdRef.current : 0;
      const data = await api.torcyAlerts({
        limit: 20,
        afterId: primedRef.current ? afterId : undefined,
      });
      if (cancelled || !data?.alerts) return;
      const rows = data.alerts;
      if (!primedRef.current) {
        for (const row of rows) {
          const id = Number(row.id);
          if (!id) continue;
          seenRef.current.add(id);
          afterIdRef.current = Math.max(afterIdRef.current, id);
        }
        primedRef.current = true;
        return;
      }
      const fresh = rows.filter((row) => {
        const id = Number(row.id);
        if (!id || seenRef.current.has(id)) return false;
        seenRef.current.add(id);
        afterIdRef.current = Math.max(afterIdRef.current, id);
        return true;
      });
      if (!fresh.length || hideRef.current) return;
      setToasts((prev) => [...prev, ...fresh].slice(-3));
    }
    void tick();
    const id = window.setInterval(() => void tick(), 8000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled]);

  useEffect(() => {
    if (!toasts.length) return undefined;
    const ms = Math.max(5, hideSec) * 1000;
    const timers = toasts.map((row) =>
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== row.id));
      }, ms),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [toasts, hideSec]);

  if (hide || !toasts.length) return null;

  return (
    <>
      {toasts.map((alert) => {
        const online = alert.kind === 'online';
        return (
          <div
            key={alert.id}
            className={`shell-ai-alert${online ? ' is-up' : ' is-down'}`}
            role="status"
            aria-live="polite"
          >
            <button
              type="button"
              className="shell-ai-alert__text shell-ai-alert__open"
              onClick={() => navigate('/app/torcy')}
              title="Открыть Торцы"
            >
              <strong>{online ? 'Связь восстановлена.' : 'Потеряна связь с торцами.'}</strong>{' '}
              {alert.message || (alert.shopName ? alert.shopName : 'Открыть приложение «Торцы».')}
            </button>
            <button
              type="button"
              className="icon-btn shell-ai-alert__close"
              title="Скрыть уведомление"
              aria-label="Скрыть уведомление"
              onClick={() => setToasts((prev) => prev.filter((row) => row.id !== alert.id))}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        );
      })}
    </>
  );
}

export function ShellLayout() {
  const { user, logout, refresh, apps: authApps } = useAuth();
  const navigate = useNavigate();
  const { appId } = useParams();
  const location = useLocation();
  const extrasActive = location.pathname.startsWith('/extras');
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [notify, setNotify] = useState<NotifyPrefs>(notifyCache || DEFAULT_NOTIFY);

  useEffect(() => {
    if (notifyCache) return;
    void api
      .notifyPrefs()
      .then((data) => {
        notifyCache = data.prefs;
        setNotify(data.prefs);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    function onNotify(event: Event) {
      const prefs = (event as CustomEvent<NotifyPrefs>).detail;
      if (!prefs) return;
      notifyCache = prefs;
      setNotify(prefs);
    }
    window.addEventListener('adminpanel:notify', onNotify);
    return () => window.removeEventListener('adminpanel:notify', onNotify);
  }, []);

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

  async function togglePin(event: MouseEvent, app: AppInfo) {
    event.preventDefault();
    event.stopPropagation();
    try {
      await api.setAppPinned(app.id, !app.pinned);
      await loadApps();
    } catch {
      // keep previous list
    }
  }

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

  const menuApps = apps.length ? apps : authApps;
  const hasGlpi = menuApps.some((item) => item.id === 'glpi');
  const hasTorcy = menuApps.some((item) => item.id === 'torcy');

  return (
    <div className={`app-shell${collapsed ? ' app-shell--collapsed' : ''}`}>
      <div
        className={`shell-alerts is-${notify.position}`}
        style={{ opacity: notify.opacity }}
      >
        <GlpiFocusHeartbeat focused={appId === 'glpi'} enabled={hasGlpi} />
        <GlpiAiOverlay hideSec={notify.hideSec} />
        <TorcyAlertOverlay hide={appId === 'torcy'} enabled={hasTorcy} hideSec={notify.hideSec} />
      </div>
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
          <NavLink
            to="/extras"
            className={() => `sidebar-link${extrasActive ? ' active' : ''}`}
            title="Доп. ПО"
          >
            <span className="sidebar-link-icon">
              <NavGlyph kind="tools" />
            </span>
            {!collapsed && <span className="sidebar-link-text">Доп. ПО</span>}
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
              <div key={app.id} className="sidebar-app-row">
              <NavLink
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
                  <AppMenuIcon
                    icon={app.icon || app.id}
                    iconUrl={app.iconUrl}
                    title={app.title}
                  />
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
                {!collapsed && (
                  <button
                    type="button"
                    className={`sidebar-pin${app.pinned ? ' is-on' : ''}`}
                    title={app.pinned ? 'Открепить' : 'Закрепить сверху'}
                    aria-label={app.pinned ? 'Открепить' : 'Закрепить сверху'}
                    onClick={(e) => void togglePin(e, app)}
                  >
                    <PinGlyph filled={Boolean(app.pinned)} />
                  </button>
                )}
              </div>
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
