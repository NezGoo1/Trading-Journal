/* Generate app icons as PNGs with zero dependencies (Node built-in zlib).
   Draws an upward candlestick chart on a dark gradient — the app's identity.
   Usage: node scripts/gen-icons.js */

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

/* ---------- tiny canvas (RGBA buffer) ---------- */
function makeCanvas(size) {
  const data = new Uint8ClampedArray(size * size * 4);
  return { size, data };
}
function px(cv, x, y, r, g, b, a = 255) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= cv.size || y >= cv.size) return;
  const i = (y * cv.size + x) * 4;
  const ia = a / 255, na = 1 - ia;
  cv.data[i]     = cv.data[i] * na + r * ia;
  cv.data[i + 1] = cv.data[i + 1] * na + g * ia;
  cv.data[i + 2] = cv.data[i + 2] * na + b * ia;
  cv.data[i + 3] = Math.max(cv.data[i + 3], a);
}
function fillRect(cv, x0, y0, w, h, col) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++)
      px(cv, x, y, col[0], col[1], col[2], col[3] == null ? 255 : col[3]);
}
function roundRectFill(cv, x0, y0, w, h, r, col) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let inside = true;
      // corner rounding
      const cx = x < r ? r : (x >= w - r ? w - r - 1 : x);
      const cy = y < r ? r : (y >= h - r ? h - r - 1 : y);
      const dx = x - cx, dy = y - cy;
      if ((x < r || x >= w - r) && (y < r || y >= h - r)) {
        if (dx * dx + dy * dy > r * r) inside = false;
      }
      if (inside) px(cv, x0 + x, y0 + y, col[0], col[1], col[2], col[3] == null ? 255 : col[3]);
    }
  }
}
// thick anti-aliased-ish line
function drawLine(cv, x1, y1, x2, y2, col, width) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const steps = Math.ceil(len * 2);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = x1 + dx * t, y = y1 + dy * t;
    for (let ox = -width; ox <= width; ox++)
      for (let oy = -width; oy <= width; oy++)
        if (ox * ox + oy * oy <= width * width)
          px(cv, x + ox, y + oy, col[0], col[1], col[2], col[3] == null ? 255 : col[3]);
  }
}

function drawIcon(size, maskable) {
  const cv = makeCanvas(size);
  const S = size;

  // Background gradient (top -> bottom), full-bleed square (iOS masks corners itself)
  const top = [18, 26, 40], bot = [8, 12, 20];
  for (let y = 0; y < S; y++) {
    const t = y / S;
    const r = top[0] + (bot[0] - top[0]) * t;
    const g = top[1] + (bot[1] - top[1]) * t;
    const b = top[2] + (bot[2] - top[2]) * t;
    fillRect(cv, 0, y, S, 1, [r, g, b, 255]);
  }

  // Content area (safe zone for maskable icons)
  const inset = maskable ? S * 0.20 : S * 0.14;
  const cw = S - inset * 2;
  const baseX = inset, baseY = inset;

  const green = [63, 185, 80], greenSoft = [63, 185, 80, 40];
  const red = [248, 81, 73];
  const line = [88, 200, 120];

  // Candlesticks ascending
  const candles = [
    { c: green, o: 0.62, cl: 0.42, hi: 0.36, lo: 0.68 },
    { c: red,   o: 0.52, cl: 0.60, hi: 0.44, lo: 0.66 },
    { c: green, o: 0.55, cl: 0.34, hi: 0.28, lo: 0.60 },
    { c: green, o: 0.40, cl: 0.22, hi: 0.16, lo: 0.46 },
  ];
  const n = candles.length;
  const slot = cw / n;
  const bodyW = slot * 0.42;
  const wickW = Math.max(1, Math.round(S * 0.012));

  candles.forEach((cd, i) => {
    const cx = baseX + slot * (i + 0.5);
    const yOf = (v) => baseY + v * cw;
    // wick
    fillRect(cv, Math.round(cx - wickW / 2), Math.round(yOf(cd.hi)), wickW, Math.round(yOf(cd.lo) - yOf(cd.hi)), [...cd.c, 255]);
    // body
    const bodyTop = yOf(Math.min(cd.o, cd.cl));
    const bodyH = Math.max(S * 0.03, Math.abs(yOf(cd.o) - yOf(cd.cl)));
    roundRectFill(cv, Math.round(cx - bodyW / 2), Math.round(bodyTop), Math.round(bodyW), Math.round(bodyH), Math.max(1, Math.round(bodyW * 0.18)), [...cd.c, 255]);
  });

  // Upward trend line across the candle closes
  const pts = candles.map((cd, i) => [baseX + slot * (i + 0.5), baseY + cd.cl * cw]);
  // extend a leading point from bottom-left and a trailing arrow up-right
  pts.unshift([baseX + slot * 0.05, baseY + 0.72 * cw]);
  pts.push([baseX + cw * 0.99, baseY + 0.14 * cw]);
  const lw = Math.max(1, Math.round(S * 0.016));
  for (let i = 0; i < pts.length - 1; i++) {
    drawLine(cv, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], line, lw);
  }
  // arrow head at the end
  const end = pts[pts.length - 1];
  const ah = S * 0.06;
  drawLine(cv, end[0], end[1], end[0] - ah, end[1], line, lw);
  drawLine(cv, end[0], end[1], end[0], end[1] + ah, line, lw);

  return cv;
}

/* ---------- PNG encoding ---------- */
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(cv) {
  const S = cv.size;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // raw scanlines with filter byte 0
  const stride = S * 4;
  const raw = Buffer.alloc((stride + 1) * S);
  for (let y = 0; y < S; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(cv.data.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- run ---------- */
const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { name: 'icon-180.png', size: 180, maskable: false },
  { name: 'icon-192.png', size: 192, maskable: false },
  { name: 'icon-512.png', size: 512, maskable: false },
  { name: 'icon-maskable-512.png', size: 512, maskable: true },
];
targets.forEach((t) => {
  const cv = drawIcon(t.size, t.maskable);
  fs.writeFileSync(path.join(outDir, t.name), encodePNG(cv));
  console.log('wrote', t.name, t.size + 'px');
});
console.log('done');
