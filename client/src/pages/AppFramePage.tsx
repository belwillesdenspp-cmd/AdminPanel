import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth';
import type { AppInfo } from '../types';

const EXTERNAL_PROTOCOL_RE = /^(vnc|ssh|rdp|telnet):\/\//i;
const FOLDER_PROTOCOL_RE = /^adminpanel-folder:/i;

function launchExternalProtocol(url: string) {
  if (!EXTERNAL_PROTOCOL_RE.test(url) && !FOLDER_PROTOCOL_RE.test(url)) return;
  const a = document.createElement('a');
  a.href = url;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function AppFramePage() {
  const { appId } = useParams();
  const { apps } = useAuth();
  const [resolved, setResolved] = useState<AppInfo | null>(
    () => apps.find((a) => a.id === appId) || null,
  );
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== 'adminpanel:open-external') return;
      launchExternalProtocol(String(data.url || ''));
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    setMissing(false);
    const fromAuth = apps.find((a) => a.id === appId) || null;
    if (fromAuth) {
      setResolved(fromAuth);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await api.listApps();
        if (cancelled) return;
        const found = data.apps.find((a) => a.id === appId) || null;
        setResolved(found);
        if (!found) setMissing(true);
      } catch {
        if (!cancelled) {
          setResolved(null);
          setMissing(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appId, apps]);

  if (missing) {
    return <Navigate to="/" replace />;
  }

  if (!resolved) {
    return (
      <div className="page">
        <div className="panel muted">Загрузка приложения…</div>
      </div>
    );
  }

  if (resolved.enabled === false) {
    return <Navigate to="/" replace />;
  }

  const src = `${resolved.publicPath.replace(/\/$/, '')}/`;

  return (
    <div className="app-frame-shell">
      <iframe
        title={resolved.title || appId || 'Приложение'}
        src={src}
        allow="fullscreen; clipboard-read *; clipboard-write *"
        allowFullScreen
      />
    </div>
  );
}
