import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

/**
 * Production pages may load only the extension's own files and may not open any network
 * connection, so "your data never leaves this device" is enforced by Chrome, not just promised.
 * Dev builds relax connect-src so Vite's hot reload can reach localhost.
 */
const CSP_PROD = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Drawn by scripts/icons.mjs into public/icons (npm run icons). */
const ICONS = {
  16: 'icons/icon-16.png',
  32: 'icons/icon-32.png',
  48: 'icons/icon-48.png',
  128: 'icons/icon-128.png',
};

export default defineManifest((env) => ({
  manifest_version: 3,
  name: 'Burrow',
  description: 'Scores your open tabs, archives the clutter, and keeps everything searchable.',
  version: pkg.version,
  minimum_chrome_version: '121',
  // Burrow never runs in, reads, or stores anything from incognito windows.
  incognito: 'not_allowed',
  homepage_url: 'https://github.com/Matutozi/Burrow',
  icons: ICONS,
  action: { default_title: 'Open Burrow', default_icon: ICONS },
  // Type "burrow" then a space in the address bar to search archived pages. Needs no permission.
  omnibox: { keyword: 'burrow' },
  // Keyboard shortcut to archive the tab in front. Needs no permission; users can change it in
  // chrome://extensions/shortcuts.
  commands: {
    'archive-current-tab': {
      suggested_key: { default: 'Alt+Shift+A' },
      description: 'Archive the current tab',
    },
  },
  side_panel: { default_path: 'src/sidepanel/index.html' },
  background: { service_worker: 'src/background/service-worker.ts', type: 'module' },
  permissions: ['tabs', 'storage', 'sidePanel', 'idle'],
  // Optional ones are asked for only when the user turns on the feature that needs them.
  // scripting: only for "save page text". alarms: only for automatic archiving.
  // tabGroups: only for tab group support and "Organise tabs".
  optional_permissions: ['scripting', 'alarms', 'tabGroups'],
  optional_host_permissions: ['https://*/*', 'http://*/*'],
  ...(env.mode === 'production' ? { content_security_policy: { extension_pages: CSP_PROD } } : {}),
}));
