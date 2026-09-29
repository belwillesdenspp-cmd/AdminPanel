export const APP_ICON_KEYS = [
  'instructions',
  'tmc',
  'torcy',
  'compusers',
  'citrix',
  'glpi',
  'equipment',
  'grid',
  'folder',
  'users',
  'wrench',
  'database',
  'network',
  'chart',
  'printer',
  'shield',
  'ticket',
  'monitor',
];

export function isAllowedAppIcon(value) {
  return APP_ICON_KEYS.includes(String(value || ''));
}
