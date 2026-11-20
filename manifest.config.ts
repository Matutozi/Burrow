import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

export default defineManifest({
  manifest_version: 3,
  name: 'Burrow',
  description: 'Scores your open tabs, archives the clutter, and keeps everything searchable.',
  version: pkg.version,
  minimum_chrome_version: '121',
  action: { default_title: 'Open Burrow' },
  side_panel: { default_path: 'src/sidepanel/index.html' },
  background: { service_worker: 'src/background/service-worker.ts', type: 'module' },
  permissions: ['tabs', 'storage', 'sidePanel'],
});
