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
};
