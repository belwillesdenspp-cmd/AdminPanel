async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 204) return null as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Ошибка запроса (${res.status})`);
  }
  return data as T;
}

export const api = {
  login(username: string, password: string) {
    return request<{ user: import('../types').User; appIds: string[] | null }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      },
    );
  },
  logout() {
    return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
  },
  me() {
    return request<import('../types').MeResponse>('/api/auth/me');
  },
  listApps() {
    return request<{ apps: import('../types').AppInfo[] }>('/api/apps');
  },
  listAllApps() {
    return request<{ apps: import('../types').AppInfo[] }>('/api/apps/all');
  },
  setAppEnabled(id: string, enabled: boolean) {
    return request<{ app: import('../types').AppInfo }>(`/api/apps/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
  },
  updateApp(
    id: string,
    body: Partial<{
      title: string;
      description: string;
      icon: string;
      sortOrder: number;
      enabled: boolean;
    }>,
  ) {
    return request<{ app: import('../types').AppInfo }>(`/api/apps/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },
  uploadAppIcon(id: string, dataUrl: string) {
    return request<{ app: import('../types').AppInfo }>(`/api/apps/${id}/icon`, {
      method: 'POST',
      body: JSON.stringify({ dataUrl }),
    });
  },
  clearAppIcon(id: string) {
    return request<{ app: import('../types').AppInfo }>(`/api/apps/${id}/icon`, {
      method: 'DELETE',
    });
  },
  restoreAppAppearance(id: string) {
    return request<{ app: import('../types').AppInfo }>(`/api/apps/${id}/restore`, {
      method: 'POST',
    });
  },
  moveApp(id: string, direction: 'up' | 'down') {
    return request<{ app: import('../types').AppInfo }>(`/api/apps/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ direction }),
    });
  },
  setAppPinned(id: string, pinned: boolean) {
    return request<{ prefs: { pinned: boolean } }>(`/api/apps/${id}/prefs`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned }),
    });
  },
  listUsers() {
    return request<{ users: import('../types').User[] }>('/api/users');
  },
  createUser(body: {
    username: string;
    password: string;
    displayName: string;
    role: import('../types').Role;
    appIds: string[];
  }) {
    return request<{ user: import('../types').User }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  updateUser(
    id: number,
    body: Partial<{
      displayName: string;
      password: string;
      role: import('../types').Role;
      isActive: boolean;
      appIds: string[];
    }>,
  ) {
    return request<{ user: import('../types').User }>(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },
  deleteUser(id: number) {
    return request<{ ok: boolean }>(`/api/users/${id}`, { method: 'DELETE' });
  },
  listTools() {
    return request<{ tools: import('../types').ToolInfo[] }>('/api/tools');
  },
  listNetworkInterfaces() {
    return request<{ interfaces: import('../types').NetInterface[] }>(
      '/api/tools/interfaces',
    );
  },
  scanSubnet(cidr: string) {
    return request<import('../types').IpScanResult>('/api/tools/ip-scan', {
      method: 'POST',
      body: JSON.stringify({ cidr }),
    });
  },
  checkItemCards(
    barcodes: string,
    source: import('../types').CardCheckSourceId,
    fusion?: { username?: string; password?: string; save?: boolean },
  ) {
    return request<import('../types').CardCheckResult>('/api/tools/card-check', {
      method: 'POST',
      body: JSON.stringify({
        barcodes,
        source,
        fusionUsername: fusion?.username,
        fusionPassword: fusion?.password,
        saveCredentials: Boolean(fusion?.save),
      }),
    });
  },
  getFusionLogin(source: import('../types').CardCheckSourceId) {
    return request<import('../types').FusionLoginStatus>(
      `/api/tools/card-check/fusion?source=${encodeURIComponent(source)}`,
    );
  },
  saveFusionLogin(
    source: import('../types').CardCheckSourceId,
    username: string,
    password: string,
  ) {
    return request<import('../types').FusionLoginStatus>('/api/tools/card-check/fusion', {
      method: 'PUT',
      body: JSON.stringify({ source, username, password }),
    });
  },
  deleteFusionLogin(source: import('../types').CardCheckSourceId) {
    return request<import('../types').FusionLoginStatus>(
      `/api/tools/card-check/fusion?source=${encodeURIComponent(source)}`,
      { method: 'DELETE' },
    );
  },
  async glpiAiStatus() {
    try {
      const res = await fetch('/apps/glpi/api/ai-status', { credentials: 'include' });
      if (!res.ok) return null;
      return (await res.json()) as {
        ok?: boolean;
        unavailable?: boolean;
        reason?: string;
        lastCheckAt?: string | null;
        unavailableSince?: string | null;
        recoveredAt?: string | null;
      };
    } catch {
      return null;
    }
  },
  async glpiRuntimeFocus(instance: string, focused: boolean) {
    try {
      const res = await fetch('/apps/glpi/api/runtime/focus', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Shell-Instance': instance,
        },
        body: JSON.stringify({ instance, focused: Boolean(focused) }),
      });
      if (!res.ok) return null;
      return (await res.json()) as { ok?: boolean; focused?: boolean };
    } catch {
      return null;
    }
  },
  async torcyAlerts(params: { limit?: number; afterId?: number } = {}) {
    try {
      const qs = new URLSearchParams();
      if (params.limit) qs.set('limit', String(params.limit));
      if (params.afterId != null && Number(params.afterId) >= 0) {
        qs.set('afterId', String(params.afterId));
      }
      const res = await fetch(`/apps/torcy/api/alerts?${qs.toString()}`, { credentials: 'include' });
      if (!res.ok) return null;
      return (await res.json()) as {
        alerts?: Array<{
          id: number;
          message?: string;
          kind?: string;
          shopName?: string;
          createdAt?: string;
        }>;
        total?: number;
      };
    } catch {
      return null;
    }
  },
  async notifyPrefs() {
    return request<{ prefs: import('../types').NotifyPrefs }>('/api/apps/notifications');
  },
  async saveNotifyPrefs(body: Partial<import('../types').NotifyPrefs>) {
    return request<{ prefs: import('../types').NotifyPrefs }>('/api/apps/notifications', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },
  faviconState() {
    return request<import('../favicon').FaviconState>('/api/brand/favicon');
  },
  saveFavicon(body: {
    iconDataUrl?: string;
    iconName?: string;
    darkDataUrl?: string;
    darkName?: string;
    clearDark?: boolean;
  }) {
    return request<import('../favicon').FaviconState>('/api/brand/favicon', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  resetFavicon() {
    return request<import('../favicon').FaviconState>('/api/brand/favicon', { method: 'DELETE' });
  },
};
