export type Role = 'admin' | 'specialist';

export interface User {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  appIds?: string[];
}

export interface AppInfo {
  id: string;
  title: string;
  description: string;
  publicPath: string;
  enabled?: boolean;
  online?: boolean;
  internalPort?: number;
  health?: { ok: boolean; error?: string };
  runtime?: {
    running: boolean;
    pid: number | null;
    startedAt: number | null;
    exitCode: number | null;
  };
}

export interface MeResponse {
  user: User;
  appIds: string[] | null;
  apps: AppInfo[];
}
