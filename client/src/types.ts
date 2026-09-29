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
  icon?: string;
  iconUrl?: string | null;
  sortOrder?: number;
  pinned?: boolean;
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

export interface ToolInfo {
  id: string;
  title: string;
  description: string;
  path: string;
}

export interface NetInterface {
  name: string;
  address: string;
  netmask: string;
  cidr: string;
  mac: string;
}

export interface IpScanHost {
  ip: string;
  status: 'busy' | 'free';
  rttMs: number | null;
  mac: string;
  hostname: string;
  self: boolean;
}

export interface IpScanResult {
  ok: boolean;
  cidr: string;
  network: string;
  broadcast: string;
  prefix: number;
  elapsedMs: number;
  totals: { total: number; busy: number; free: number };
  hosts: IpScanHost[];
}

export type CardCheckDestination = 'nsi' | 'pricing';
export type CardCheckStatus = 'ok' | 'missing' | 'error';
export type CardCheckSourceId = 'bmk' | 'bvd';

export interface FusionLoginStatus {
  saved: boolean;
  username: string | null;
  source: CardCheckSourceId;
  sourceLabel?: string;
}

export interface CardCheckItem {
  barcode: string;
  source: CardCheckSourceId;
  sourceLabel: string;
  found: boolean;
  status: CardCheckStatus;
  error: string | null;
  id: string | null;
  guid: string | null;
  name: string | null;
  nameItemGroup: string | null;
  flags: { entered: boolean; processed: boolean; inactive: boolean };
  allBarcodes: string;
  destination: CardCheckDestination;
  destinationLabel: string;
  reason: string;
  doubt: boolean;
}

export interface NotifyPrefs {
  position: 'top-center' | 'top-right' | 'bottom-right';
  opacity: number;
  hideSec: number;
}

export interface CardCheckResult {
  ok: boolean;
  source: CardCheckSourceId;
  sourceLabel: string;
  authRequired?: boolean;
  savedLogin?: boolean;
  savedUsername?: string | null;
  elapsedMs: number;
  truncated: boolean;
  max: number;
  invalid: string[];
  totals: {
    total: number;
    nsi: number;
    pricing: number;
    missing: number;
    error: number;
  };
  items: CardCheckItem[];
}
