// Packs dist/ into release/burrow-<version>.zip for Chrome Web Store upload, with no dependencies.
// Run after a production build: npm run package
// Refuses to pack if the build looks wrong (missing manifest, version mismatch, network APIs,
// source maps, or remote URLs in code), so a bad zip never reaches the store.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { crc32 } from './icons.mjs';

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function fail(msg) {
  console.error(`package: ${msg}`);
  process.exit(1);
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

// --- Pre-flight checks ---
let manifest;
try {
  manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
} catch {
  fail('dist/manifest.json missing. Run npm run build first.');
}
if (manifest.version !== pkg.version) fail(`manifest version ${manifest.version} != package.json ${pkg.version}`);
if (!manifest.content_security_policy?.extension_pages?.includes("connect-src 'none'")) {
  fail('production CSP missing. Build with npm run build, not npm run dev.');
}
if (manifest.incognito !== 'not_allowed') fail('incognito must stay "not_allowed"');
for (const size of ['16', '32', '48', '128']) {
  if (!manifest.icons?.[size]) fail(`manifest has no ${size}px icon`);
}

const files = walk(dist).sort();
for (const file of files) {
  const rel = relative(dist, file);
  if (rel.endsWith('.map')) fail(`source map in build: ${rel}`);
  if (!/\.(js|html|css|json)$/.test(rel)) continue;
  const text = readFileSync(file, 'utf8');
  if (/fetch\(|XMLHttpRequest|WebSocket\(|sendBeacon/.test(text)) fail(`network API in ${rel}`);
  // The license signing key must never ship. A private JWK has a "d" member; the public one doesn't.
  if (/["']?\bd["']?\s*:\s*["'][A-Za-z0-9_-]{40,}["']/.test(text) && /\bcrv\b/.test(text)) fail(`private key material in ${rel}`);
  // Remote code is banned in MV3. Host patterns like https://*/* in the manifest are fine.
  if (rel !== 'manifest.json' && /<script[^>]+src=["']https?:|import\(["']https?:/.test(text)) fail(`remote code in ${rel}`);
}

// --- Minimal ZIP writer (deflate, fixed timestamp so builds are reproducible) ---
const DOS_TIME = 0; // 00:00:00
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01
const locals = [];
const centrals = [];
let offset = 0;
for (const file of files) {
  const name = Buffer.from(relative(dist, file).split(sep).join('/'), 'utf8');
  const data = readFileSync(file);
  const packed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  locals.push(local, name, packed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); // version made by
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);

  offset += local.length + name.length + packed.length;
}
const centralSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

const outDir = join(root, 'release');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `burrow-${pkg.version}.zip`);
const zip = Buffer.concat([...locals, ...centrals, end]);
writeFileSync(out, zip);
console.log(`package: ${relative(root, out)}  ${files.length} files, ${(zip.length / 1024).toFixed(1)} KB`);
