#!/usr/bin/env node
/* ==========================================================================
   tools/gen-icons.js — deterministic PWA icon generator

   Dependency-free: rasterises the brand mark (dark surface + champagne gold
   calendar glyph) with 4x supersampling and encodes real PNGs via zlib.
   Re-run after any brand token change:  node tools/gen-icons.js
   ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* --------------------------------------------------------------- palette */
/* mirrors :root in styles.css — surface #12161f, gold #e4c278 */
const SURFACE = [18, 22, 31, 255];
const GOLD = [228, 194, 120, 255];

/* ------------------------------------------------------------ png encoder */

const CRC_TABLE = (function () {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  ihdr[10] = 0;   // deflate
  ihdr[11] = 0;   // adaptive filtering
  ihdr[12] = 0;   // no interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;                                   // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ------------------------------------------------------------- rasteriser */

/** rounded-rectangle hit test in pixel space */
function inRoundRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  r = Math.min(r, w / 2, h / 2);
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx, dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

/**
 * shapes: painter's-algorithm list, each { x, y, w, h, r, color } in pixels.
 * Rendered with SS x SS supersampling for clean edges at every size.
 */
function render(size, shapes, opaqueBg) {
  const SS = 4;
  const out = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          let col = opaqueBg;                                    // null = transparent
          for (let i = 0; i < shapes.length; i++) {
            const s = shapes[i];
            if (inRoundRect(px, py, s.x, s.y, s.w, s.h, s.r)) col = s.color;
          }
          if (col) { r += col[0]; g += col[1]; b += col[2]; a += col[3]; }
        }
      }

      const n = SS * SS;
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

/* ------------------------------------------------------------- brand mark */

/** calendar glyph: two hangers, gold body, dark page, 3x2 gold day dots */
function markShapes(mx, my, mw, mh) {
  const shapes = [];
  const stroke = mw * 0.075;

  // hangers
  shapes.push({ x: mx + mw * 0.22, y: my, w: mw * 0.11, h: mh * 0.20, r: mw * 0.055, color: GOLD });
  shapes.push({ x: mx + mw * 0.67, y: my, w: mw * 0.11, h: mh * 0.20, r: mw * 0.055, color: GOLD });

  // body
  const by = my + mh * 0.10;
  const bh = mh * 0.90;
  shapes.push({ x: mx, y: by, w: mw, h: bh, r: mw * 0.16, color: GOLD });

  // page (dark inner area, gold header band stays visible above it)
  const ix = mx + stroke;
  const iy = by + bh * 0.30;
  const iw = mw - stroke * 2;
  const ih = bh - (bh * 0.30) - stroke;
  shapes.push({ x: ix, y: iy, w: iw, h: ih, r: mw * 0.07, color: SURFACE });

  // day dots — 3 columns x 2 rows
  const cols = 3, rows = 2;
  const d = iw * 0.17;
  const padX = iw * 0.13, padY = ih * 0.20;
  const gapX = (iw - padX * 2 - cols * d) / (cols - 1);
  const gapY = (ih - padY * 2 - rows * d) / (rows - 1);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      shapes.push({
        x: ix + padX + col * (d + gapX),
        y: iy + padY + row * (d + gapY),
        w: d, h: d, r: d * 0.34, color: GOLD
      });
    }
  }
  return shapes;
}

/**
 * variant 'rounded'  — app-shaped tile (Android/Chrome "any", favicons)
 * variant 'square'   — full-bleed square (iOS applies its own mask)
 * variant 'maskable' — full bleed, mark shrunk into the 80% safe zone
 */
function iconShapes(size, variant) {
  const shapes = [];

  if (variant === 'rounded') {
    shapes.push({ x: 0, y: 0, w: size, h: size, r: size * 0.22, color: SURFACE });
  } else {
    shapes.push({ x: 0, y: 0, w: size, h: size, r: 0, color: SURFACE });
  }

  const scale = variant === 'maskable' ? 0.46 : 0.56;
  const mw = size * scale;
  const mh = mw * 1.06;
  return shapes.concat(markShapes((size - mw) / 2, (size - mh) / 2, mw, mh));
}

/* ------------------------------------------------------------------- main */

const TARGETS = [
  { file: 'icons/icon-192.png', size: 192, variant: 'rounded' },
  { file: 'icons/icon-512.png', size: 512, variant: 'rounded' },
  { file: 'icons/maskable-512.png', size: 512, variant: 'maskable' },
  { file: 'icons/apple-touch-icon-180.png', size: 180, variant: 'square' },
  { file: 'icons/favicon-32.png', size: 32, variant: 'rounded' }
];

const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'icons'), { recursive: true });

TARGETS.forEach(t => {
  const rgba = render(t.size, iconShapes(t.size, t.variant), null);
  const buf = encodePNG(t.size, t.size, rgba);
  fs.writeFileSync(path.join(root, t.file), buf);
  console.log('  wrote ' + t.file + '  (' + t.size + 'x' + t.size + ', ' + buf.length + ' bytes)');
});

console.log('\n  ' + TARGETS.length + ' icons generated.\n');
