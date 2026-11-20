import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config.ts';

export default defineConfig({
  plugins: [preact(), crx({ manifest })],
  build: {
    // Extension pages load from disk, so skip modulepreload polyfills and keep output readable for store review.
    modulePreload: false,
    minify: true,
    sourcemap: false,
  },
});
