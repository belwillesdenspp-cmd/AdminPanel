export type FaviconState = {
  v: number;
  custom: boolean;
  href: string;
  type: string;
  darkHref: string | null;
  darkType: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
  iconName?: string | null;
  darkName?: string | null;
};

function upsert(id: string, rel: string, href: string, type: string | null, media?: string) {
  let link = document.getElementById(id) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.id = id;
    link.rel = rel;
    document.head.appendChild(link);
  }
  link.href = href;
  if (type) link.type = type;
  if (media) link.media = media;
  else link.removeAttribute('media');
}

export function mountFavicon(state: FaviconState) {
  upsert('ap-favicon', 'icon', state.href, state.type);
  if (state.darkHref) upsert('ap-favicon-dark', 'icon', state.darkHref, state.darkType, '(prefers-color-scheme: dark)');
  else document.getElementById('ap-favicon-dark')?.remove();

  const touch = state.custom && state.type !== 'image/svg+xml' && state.type !== 'image/gif';
  if (touch) upsert('ap-apple', 'apple-touch-icon', state.href, state.type);
  else document.getElementById('ap-apple')?.remove();

  let manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!manifest) {
    manifest = document.createElement('link');
    manifest.rel = 'manifest';
    document.head.appendChild(manifest);
  }
  manifest.href = `/api/brand/manifest.webmanifest?v=${state.v}`;
}

export async function applyFavicon() {
  try {
    const res = await fetch('/api/brand/favicon', { credentials: 'include', cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as FaviconState;
    mountFavicon(data);
    return data;
  } catch {
    return null;
  }
}
