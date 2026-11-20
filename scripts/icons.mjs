// Draws Burrow's icon (a burrow entrance in a hill) as PNGs, with no dependencies.
// Run: npm run icons   → writes public/icons/icon-{16,32,48,128}.png
// Shapes are defined in a 0..1 box and rendered with 4x4 supersampling for smooth edges.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZES = [16, 32, 48, 128];
const OUT = new URL('../public/icons/', import.meta.url);

const SKY = [26, 115, 232]; // --accent
const HILL = [255, 255, 255];
const HOLE = [11, 45, 102];
const GROUND = [16, 82, 170];

/** Signed-ish inside test for a rounded square covering [p, 1-p]. */
function inRoundedSquare(x, y, p, r) {
  const lo = p + r;
  const hi = 1 - p - r;
  const dx = Math.max(lo - x, 0, x - hi);
  const dy = Math.max(lo - y, 0, y - hi);
  return x >= p && x <= 1 - p && y >= p && y <= 1 - p && dx * dx + dy * dy <= r * r;
}

const inEllipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

/** Colour at a point, or null for transparent. `pad` is the empty margin (Chrome asks for one on the 128px icon). */
function shade(x, y, pad) {
  // Map into the artwork box.
  const s = 1 - 2 * pad;
  const u = (x - pad) / s;
  const v = (y - pad) / s;
  if (!inRoundedSquare(u, v, 0, 0.22)) return null;
  const ground = 0.78;
  if (v > ground) return GROUND;
  if (inEllipse(u, v, 0.5, ground, 0.15, 0.21)) return HOLE;
  if (inEllipse(u, v, 0.5, ground, 0.38, 0.46)) return HILL;
  return SKY;
}

function render(size) {
  const pad = size >= 128 ? 16 / 128 : 0;
  const N = 4;
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const c = shade((px + (sx + 0.5) / N) / size, (py + (sy + 0.5) / N) / size, pad);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a++;
        }
      }
      const i = (py * size + px) * 4;
      if (a > 0) {
        rgba[i] = Math.round(r / a);
        rgba[i + 1] = Math.round(g / a);
        rgba[i + 2] = Math.round(b / a);
      }
      rgba[i + 3] = Math.round((a / (N * N)) * 255);
    }
  }
  return encodePng(size, size, rgba);
}

// --- Minimal PNG encoder (RGBA, 8-bit, no interlace) ---
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(OUT, { recursive: true });
  for (const size of SIZES) {
    const png = render(size);
    writeFileSync(new URL(`icon-${size}.png`, OUT), png);
    console.log(`icon-${size}.png  ${png.length} bytes`);
  }
}
