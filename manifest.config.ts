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

export default defineManifest((env) => ({
  manifest_version: 3,
  name: 'Burrow',
  description: 'Scores your open tabs, archives the clutter, and keeps everything searchable.',
  version: pkg.version,
  minimum_chrome_version: '121',
  // Burrow never runs in, reads, or stores anything from incognito windows.
  incognito: 'not_allowed',
  action: { default_title: 'Open Burrow' },
  // Type "burrow" then a space in the address bar to search archived pages. Needs no permission.
  omnibox: { keyword: 'burrow' },
  side_panel: { default_path: 'src/sidepanel/index.html' },
  background: { service_worker: 'src/background/service-worker.ts', type: 'module' },
  permissions: ['tabs', 'storage', 'sidePanel', 'idle'],
  // Optional ones are asked for only when the user turns on the feature that needs them.
  // scripting: only for "save page text". alarms: only for automatic archiving.
  optional_permissions: ['scripting', 'alarms'],
  optional_host_permissions: ['https://*/*', 'http://*/*'],
  ...(env.mode === 'production' ? { content_security_policy: { extension_pages: CSP_PROD } } : {}),
}));
