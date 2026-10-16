'use strict';
// Пиксельная графика Reifenwerk в духе 16-бит (SNES / Mega Drive).
// Мир рисуется в холст 24 px на клетку: станки — объёмные модели (синий + жёлтый), палитры по 5–6 тонов,
// мягкие тени, дизеринг, блики; рабочие в синих комбинезонах и наушниках-антифонах; 8 кадров ходьбы, дыхание,
// своя работа руками для каждого инструмента, вращающиеся шины на 48 шагов, качающиеся крюки, искры, пар, пыль.
// Производительность: всё статичное (пол, стены, рельсы, корпуса станков, кадры спрайтов, надписи) кэшируется
// один раз; каждый кадр — только видимая часть и только то, что движется. Симуляция та же, API window.PixelGfx прежний.
(() => {
const PT = 12;            // единица камеры (как раньше: 12 px на клетку) — для toTile/zoomAt/pan/cam
const Q = 24;             // разрешение мира: 24 px на клетку
const LQ = 6;             // разрешение карты освещения: 6 px на клетку
const OUT = '#16131d';    // контур
const TAU = Math.PI * 2;
const NF = 48;            // кадров на оборот у вращающихся шин
let V = null, wc = null, g = null, bg = null, lightC = null, lampMask = null, warmMask = null;
let time = 0, lastNow = 0, dt = 0, VX = 0, VY = 0, VW = 1, VH = 1;
const LAMPS = [];

// ---------- камера ----------
const cam = { z: 1.1, cx: 25.4 * PT, cy: 14.6 * PT };
function clampCam() {
  if (!V) return; const W = V.MW * PT, H = V.MH * PT;
  cam.z = Math.max(1, Math.min(4, cam.z));
  const vw = W / cam.z, vh = H / cam.z;
  cam.cx = Math.max(vw / 2, Math.min(W - vw / 2, cam.cx)); cam.cy = Math.max(vh / 2, Math.min(H - vh / 2, cam.cy));
}
function viewRect() { const W = V.MW * PT, H = V.MH * PT, vw = W / cam.z, vh = H / cam.z; return [cam.cx - vw / 2, cam.cy - vh / 2, vw, vh]; }
// доля экрана (0..1) → координаты в клетках
function toTile(fx, fy) { if (!V) return [fx * 48, fy * 30]; const [sx, sy, sw, sh] = viewRect(); return [(sx + fx * sw) / PT, (sy + fy * sh) / PT]; }
function zoomAt(f, fx, fy) {
  if (!V) return; const [sx, sy, sw, sh] = viewRect(), wx = sx + fx * sw, wy = sy + fy * sh;
  cam.z *= f; clampCam(); const [, , sw2, sh2] = viewRect();
  cam.cx = wx - (fx - 0.5) * sw2; cam.cy = wy - (fy - 0.5) * sh2; clampCam();
}
function pan(dfx, dfy) { if (!V) return; const [, , sw, sh] = viewRect(); cam.cx += dfx * sw; cam.cy += dfy * sh; clampCam(); }

// ---------- цвет и мелочи ----------
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
const memo = new Map();
const rgbOf = h => { const n = parseInt(h.slice(1, 7), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const hexOf = (r, gg, b) => '#' + (16777216 + (clamp(Math.round(r), 0, 255) << 16) + (clamp(Math.round(gg), 0, 255) << 8) + clamp(Math.round(b), 0, 255)).toString(16).slice(1);
function shade(h, f) {
  const k = h + '/' + f; let v = memo.get(k); if (v !== undefined) return v;
  const [r, gg, b] = rgbOf(h);
  v = f >= 0 ? hexOf(r + (255 - r) * f, gg + (255 - gg) * f, b + (255 - b) * f) : hexOf(r * (1 + f), gg * (1 + f), b * (1 + f));
  memo.set(k, v); return v;
}
function mix(a, b, t) {
  const k = a + '*' + b + '*' + t; let v = memo.get(k); if (v !== undefined) return v;
  const A = rgbOf(a), B = rgbOf(b); v = hexOf(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)); memo.set(k, v); return v;
}
// Таблица прозрачностей цвета (17 шагов) — без сборки строк в горячих циклах
const AT = new Map();
function alphas(h) { let a = AT.get(h); if (!a) { const [r, gg, b] = rgbOf(h); a = []; for (let k = 0; k <= 16; k++) a.push(`rgba(${r},${gg},${b},${k / 16})`); AT.set(h, a); } return a; }
const rgba = (h, a) => alphas(h)[clamp(Math.round(a * 16), 0, 16)];
// Тоновая лестница: 0 — глубокая тень (сдвиг в сине-фиолетовый) … 3 — основной … 5 — блик (сдвиг в тёплый)
function ramp(h) {
  const k = 'R' + h; let v = memo.get(k); if (v) return v;
  v = [mix(shade(h, -0.62), '#1a1440', 0.25), mix(shade(h, -0.38), '#2a2050', 0.12), shade(h, -0.17), h, mix(shade(h, 0.28), '#fff4d0', 0.15), shade(h, 0.58)];
  memo.set(k, v); return v;
}
function mk(w, h, rf) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); if (rf) c.getContext('2d', { willReadFrequently: true }); return c; }
function paint(c, fn) { const keep = g; g = c.getContext('2d'); g.imageSmoothingEnabled = false; fn(); g = keep; return c; }
const CC = new Map();
const cache = (k, fn) => { let v = CC.get(k); if (v === undefined) { v = fn(); CC.set(k, v); } return v; };
const vis = (x, y, w, h) => x + w > VX - 8 && y + h > VY - 8 && x < VX + VW + 8 && y < VY + VH + 8;

// ---------- палитры (0 — самый тёмный … 5 — блик) ----------
const BLUE = ['#0f1b3a', '#18305f', '#22468a', '#2d5cad', '#4a80d0', '#86b2ec'];
const YEL = ['#4a2c06', '#94590b', '#cf8a12', '#f0b622', '#ffd650', '#fff0a6'];
const STEEL = ['#21242c', '#383d48', '#545b69', '#77808f', '#a0a9b8', '#d4dbe6'];
const DARK = ['#0d0e13', '#17191f', '#22252d', '#2f333d', '#444a57', '#646b7b'];
const RED = ['#3a0b10', '#6c1820', '#a32629', '#d2423a', '#ef7660', '#ffb69e'];
const GRN = ['#0c2a1a', '#164a30', '#216e45', '#33985d', '#5fc57c', '#a6eeae'];
const ORG = ['#461806', '#86320c', '#c45214', '#ea7822', '#ffa24a', '#ffd398'];
const TEAL = ['#0a2729', '#12464a', '#1c6a6a', '#29908a', '#4bbdb0', '#9ce8dc'];
const PURP = ['#22153a', '#3a285e', '#544086', '#705ea8', '#988acc', '#cec4ee'];
const WOOD = ['#36200f', '#5a381b', '#7c5028', '#9c6836', '#c08850', '#e0b07c'];
const LIDP = ['#1c1f26', '#30353f', '#4a515e', '#69717f', '#8e97a6', '#c3cad6'];
const CARD = ['#4a3418', '#6e5026', '#93703a', '#b48c4e', '#d0aa6a', '#ecd29c'];
const SHADOW = 'rgba(12,8,26,0.2)', SHADOW2 = 'rgba(12,8,26,0.13)';

// ---------- примитивы (рисуют в текущий контекст g) ----------
function R(x, y, w, h, c) { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
function px(x, y, c) { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), 1, 1); }
function ell(x, y, w, h, c) { // эллипс, вписанный в прямоугольник
  g.fillStyle = c; const rx = w / 2, ry = h / 2, n = Math.round(h), y0 = Math.round(y);
  for (let j = 0; j < n; j++) { const t = (j + 0.5 - ry) / ry, hw = rx * Math.sqrt(Math.max(0, 1 - t * t)), a = Math.round(x + rx - hw), b = Math.round(x + rx + hw); if (b > a) g.fillRect(a, y0 + j, b - a, 1); }
}
function ellO(cx, cy, rx, ry, c) { ell(cx - rx - 1, cy - ry - 1, rx * 2 + 2, ry * 2 + 2, OUT); ell(cx - rx, cy - ry, rx * 2, ry * 2, c); }
const disc = (cx, cy, r, c) => ell(cx - r, cy - r, r * 2, r * 2, c);
const discO = (cx, cy, r, c) => { disc(cx, cy, r + 1, OUT); disc(cx, cy, r, c); };
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function dith(x, y, w, h, c, lv) { // упорядоченный дизеринг: закрашено ≈ lv доли пикселей
  if (lv <= 0) return; g.fillStyle = c; x = Math.round(x); y = Math.round(y); const th = lv * 16;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (BAYER[((y + j) & 3) * 4 + ((x + i) & 3)] < th) g.fillRect(x + i, y + j, 1, 1);
}
function hazard(x, y, w, h) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, ((i + j) >> 2) & 1 ? '#1d1b22' : YEL[3]); }
function line(x0, y0, x1, y1, c, t = 1) {
  const n = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)))), o = t >> 1; g.fillStyle = c;
  for (let i = 0; i <= n; i++) g.fillRect(Math.round(x0 + (x1 - x0) * i / n) - o, Math.round(y0 + (y1 - y0) * i / n) - o, t, t);
}
function beam(x0, y0, x1, y1, P, t) { line(x0, y0, x1, y1, OUT, t + 2); line(x0, y0, x1, y1, P[3], t); line(x0, y0 - (t >> 1), x1, y1 - (t >> 1), P[4], 1); }
// Короб в виде 3/4: верхняя грань и передняя стенка высотой d
function box3(x, y, w, h, d, P) {
  x = Math.round(x); y = Math.round(y); const th = h - d;
  R(x, y, w, h, OUT);
  R(x + 1, y + 1, w - 2, th - 1, P[3]);
  if (th > 10) dith(x + 1, y + Math.round(th * 0.6), w - 2, th - 1 - Math.round(th * 0.6) + 1, P[2], 0.25);
  R(x + 1, y + 1, w - 2, 1, P[4]); R(x + 1, y + 1, 1, th - 1, P[4]); px(x + 1, y + 1, P[5]);
  R(x + w - 2, y + 2, 1, th - 2, P[2]);
  R(x + 1, y + th, w - 2, d - 1, P[2]);
  R(x + 1, y + th, w - 2, 1, P[4]);
  if (d > 4) dith(x + 1, y + th + 1 + ((d - 2) >> 1), w - 2, d - 2 - ((d - 2) >> 1), P[1], 0.5);
  R(x + w - 2, y + th + 1, 1, d - 2, P[1]); R(x + 1, y + h - 2, w - 2, 1, P[1]);
}
// Тот же короб, но из кэша спрайтов (для движущихся частей — без попиксельного дизеринга в каждом кадре)
const BOXC = new Map();
function boxS(x, y, w, h, d, P) { let m = BOXC.get(P); if (!m) { m = new Map(); BOXC.set(P, m); } const k = (w * 128 + h) * 32 + d; let c = m.get(k); if (!c) { c = paint(mk(w, h), () => box3(0, 0, w, h, d, P)); m.set(k, c); } g.drawImage(c, Math.round(x), Math.round(y)); }
// Боковина вертикального цилиндра (вид 3/4): верхний эллипс (cx, cy, rx, ry), высота h; свет слева
function cylSide(cx, cy, rx, ry, h, P) {
  for (let i = -rx - 1; i <= rx; i++) {
    const u = (i + 0.5) / rx, e = ry * Math.sqrt(Math.max(0, 1 - u * u)), y0 = Math.round(cy + e), y1 = Math.round(cy + h + e), edge = i === -rx - 1 || i === rx;
    R(cx + i, y0, 1, y1 - y0 + 1, edge ? OUT : P[u < -0.6 ? 4 : u < -0.15 ? 3 : u < 0.4 ? 2 : u < 0.78 ? 1 : 0]);
    if (!edge) px(cx + i, y1 + 1, OUT);
  }
}
// Горизонтальный цилиндр (вал, ствол экструдера) — полосы сверху вниз
function hcyl(x, y, w, h, P) { R(x, y, w, h, OUT); for (let j = 1; j < h - 1; j++) { const t = j / (h - 1); R(x + 1, y + j, w - 2, 1, P[t < 0.2 ? 5 : t < 0.4 ? 4 : t < 0.62 ? 3 : t < 0.82 ? 2 : 1]); } }
function shadowBlob(x, y, w, h) { ell(x, y, w, h, SHADOW); ell(x + w * 0.1, y + h * 0.18, w * 0.8, h * 0.64, SHADOW2); }
function bolt(x, y, P) { px(x, y, P[5]); px(x + 1, y + 1, P[1]); }
function grille(x, y, w, h, c, step = 3) { for (let j = 0; j < h; j += step) R(x, y + j, w, 1, c); }

// ---------- шрифт 5×7 (пропорциональный) и мелкий 3×5 для табло ----------
const F5 = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14],
  4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8],
  8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
  '.': [0, 0, 0, 0, 0, 0, 4], ',': [0, 0, 0, 0, 0, 4, 8], ':': [0, 0, 4, 0, 0, 4, 0], '-': [0, 0, 0, 14, 0, 0, 0], '+': [0, 4, 4, 31, 4, 4, 0],
  '/': [1, 1, 2, 4, 8, 16, 16], '!': [4, 4, 4, 4, 4, 0, 4], '?': [14, 17, 1, 2, 4, 0, 4], '%': [25, 25, 2, 4, 8, 19, 19],
  '(': [2, 4, 8, 8, 8, 4, 2], ')': [8, 4, 2, 2, 2, 4, 8], "'": [4, 4, 0, 0, 0, 0, 0], '#': [10, 10, 31, 10, 31, 10, 10], '_': [0, 0, 0, 0, 0, 0, 31],
  'Ж': [21, 21, 14, 4, 14, 21, 21], 'Ф': [4, 14, 21, 21, 21, 14, 4], '°': [12, 18, 12, 0, 0, 0, 0], '×': [0, 17, 10, 4, 10, 17, 0],
};
const GL = {};
for (const [ch, rows] of Object.entries(F5)) { let lo = 5, hi = -1; for (const r of rows) for (let b = 0; b < 5; b++) if (r & (16 >> b)) { lo = Math.min(lo, b); hi = Math.max(hi, b); } GL[ch] = { w: hi - lo + 1, l: lo, rows }; }
GL[' '] = { w: 3, l: 0, rows: [0, 0, 0, 0, 0, 0, 0] };
const CYR = { К: 'K', С: 'C', Р: 'P', М: 'M', З: '3', А: 'A', В: 'B', Е: 'E', Н: 'H', О: 'O', Т: 'T', Х: 'X', У: 'Y', Г: 'G', Л: 'L', П: 'P', Д: 'D', И: 'I', Б: 'B', Я: 'R', Ш: 'W', Щ: 'W', Ч: '4', Ц: 'C', Ы: 'B', Ь: 'B', Ъ: 'B', Э: 'E', Ю: 'U', Й: 'I' };
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'SS').replace(/[łŁ]/g, 'L').replace(/[ıİ]/g, 'I').toUpperCase().replace(/[А-ЯЁ]/g, c => c === 'Ж' || c === 'Ф' ? c : CYR[c] || '?');
const G3 = { // 3×5 для табло станков
  0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110', 4: '101101111001001', 5: '111100110001110',
  6: '011100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001110', O: '010101101101010', K: '101101110101101',
  '-': '000000111000000', ' ': '000000000000000', '°': '010101010000000', M: '101111111101101',
};
function lcd(s, x, y, c) { g.fillStyle = c; let cx = Math.round(x); for (const ch of s) { const gl = G3[ch]; if (gl) for (let i = 0; i < 15; i++) if (gl.charCodeAt(i) === 49) g.fillRect(cx + i % 3, y + ((i / 3) | 0), 1, 1); cx += 4; } }
// мелкий шрифт 3×5 для подписей на среднем зуме
const F3 = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100',
  G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100', Q: '010101101110011', R: '110101110101101',
  S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001110',
  '.': '000000000000010', ':': '000010000010000', '/': '001001010100100', '-': '000000111000000', '%': '101001010100101', '!': '010010010000010',
  '?': '110001010000010', '+': '000010111010000', '(': '010100100100010', ')': '010001001001010', "'": '010010000000000', '#': '101111101111101',
  'Ж': '101111010111101', 'Ф': '010111101111010', '°': '010101010000000', ',': '000000000010100', '_': '000000000000111',
};
// Надпись → маленький спрайт (кэш): контур или табличка; f3 — шрифт 3×5
const TXT = new Map();
function textSprite(s, col, plate, f3) {
  const key = s + '\u0001' + col + (plate ? '\u0002' : '') + (f3 ? '\u0003' : ''); let c = TXT.get(key); if (c) return c;
  const str = norm(s), fh = f3 ? 5 : 7; let w = 0; const gs = [];
  for (const ch of str) { if (f3) { const gl = F3[ch] || (ch === ' ' ? null : F3['?']); gs.push(gl); w += 4; } else { const gl = GL[ch] || GL['?']; gs.push(gl); w += gl.w + 1; } }
  w = Math.max(1, w - 1);
  const pad = plate ? (f3 ? 2 : 3) : 1, W = w + pad * 2, H = fh + pad * 2;
  c = mk(W, H);
  paint(c, () => {
    if (plate) { R(1, 0, W - 2, H, '#0b0d14'); R(0, 1, W, H - 2, '#0b0d14'); R(1, 1, W - 2, H - 2, '#253048'); R(1, 1, W - 2, 1, '#3e4d72'); R(1, H - 2, W - 2, 1, '#1a2236'); }
    const draw = (ox, oy, cl) => {
      g.fillStyle = cl; let x = pad + ox;
      if (f3) { for (const gl of gs) { if (gl) for (let i = 0; i < 15; i++) if (gl.charCodeAt(i) === 49) g.fillRect(x + i % 3, pad + oy + ((i / 3) | 0), 1, 1); x += 4; } }
      else for (const gl of gs) { for (let j = 0; j < 7; j++) { const r = gl.rows[j]; for (let b = 0; b < 5; b++) if (r & (16 >> b)) g.fillRect(x + b - gl.l, pad + j + oy, 1, 1); } x += gl.w + 1; }
    };
    if (!plate) for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) draw(ox, oy, OUT);
    else draw(0, 1, '#090b10');
    draw(0, 0, col);
  });
  TXT.set(key, c); if (TXT.size > 800) TXT.delete(TXT.keys().next().value); return c;
}
// Надписи копятся за кадр и рисуются поверх картинки в экранных пикселях (чётко при любом зуме).
// Уровень детализации: мелкий зум — 5×7 в 1 px, средний — 3×5 в 2 px, крупный — 5×7 в 2 px.
const LB = []; let nLB = 0;
function label(e, x, y, al, small) { let o = LB[nLB]; if (!o) { o = {}; LB[nLB] = o; } nLB++; o.e = e; o.x = x; o.y = y; o.a = al; o.m = small; }
const SL = new WeakMap(); // подписи станций/рабочих — запись на объект
function objLabel(o, text, col, plate) { let e = SL.get(o); if (!e || e.t !== text) { e = { t: text, c: col, p: plate, s5: null, s3: null }; SL.set(o, e); } return e; }
const lblSprite = (e, f3) => f3 ? (e.s3 || (e.s3 = textSprite(e.t, e.c, e.p, true))) : (e.s5 || (e.s5 = textSprite(e.t, e.c, e.p, false)));

// ---------- шины ----------
const TPH = { // тона резины: протектор t, боковина w, канавки gr, блик hl, контур o
  new: { t: ['#0d0d11', '#16161c', '#202028', '#2c2c36', '#40404c'], w: ['#111116', '#1a1a21', '#24242c', '#30303b', '#464656'], gr: '#07070a', hl: '#767a94', o: '#050507' },
  old: { t: ['#191715', '#24211e', '#302c28', '#3e3934', '#524b44'], w: ['#1a1817', '#252220', '#312d2a', '#3f3a36', '#55504a'], gr: '#100f0e', hl: '#6a645c', o: '#0a0909' },
  buffed: { t: ['#2c231e', '#3a2e27', '#4a3b31', '#5a483b', '#6e5848'], w: ['#1a1817', '#252220', '#312d2a', '#3f3a36', '#55504a'], gr: '#100f0e', hl: '#6a645c', o: '#0a0909' },
  raw: { t: ['#111014', '#18171c', '#201f25', '#29282f', '#34333b'], w: ['#1a1817', '#252220', '#312d2a', '#3f3a36', '#55504a'], gr: '#0b0a0d', hl: '#4c4a54', o: '#08070a' },
};
const KINDS = ['old', 'buffed', 'raw', 'new'];
const TP = KINDS.map(k => { const p = TPH[k], c = h => rgbOf(h); return { t: p.t.map(c), w: p.w.map(c), gr: c(p.gr), hl: c(p.hl), o: c(p.o) }; });
const STEELRGB = STEEL.map(rgbOf), STICK = rgbOf('#ff9a2c'), STICK2 = rgbOf('#ffd27a');
const ST_NEW = new Set(['presse', 'entgr', 'scan', 'endk', 'fertig']), ST_BUF = new Set(['rauen', 'ausschl', 'pflaster', 'spray', 'fuellen']);
const kindOf = t => !t ? 0 : ST_NEW.has(t.stage) ? 3 : t.stage === 'aufbau' ? 2 : ST_BUF.has(t.stage) ? 1 : 0;
const tireK = id => kindOf(V.S.tires.get(id));
const isOtr = id => { const t = V.S.tires.get(id); return !!t && t.prod === 'otr'; }; // карьерные OTR — крупнее
const rT = (id, r) => isOtr(id) ? r + 3 : r;
const TS = new Map();
// Шина боком к камере: протектор по кругу, боковина (тор) с надписями и бликом, борт; hub — на ступице станка
function tireSide(r, kind, f, hub) {
  f = ((f | 0) % NF + NF) % NF; const key = ((kind * 40 + r) * 2 + (hub ? 1 : 0)) * NF + f; let c = TS.get(key); if (c) return c;
  const P = TP[kind], S = 2 * r + 2, cx = S / 2, cy = S / 2, rot = f / NF * TAU, nb = r >= 14 ? 20 : r >= 10 ? 16 : 12;
  const tw = Math.max(2, Math.round(r * 0.26)), rw = r - tw, rin = r * (hub ? 0.5 : 0.56), rm = (rw + rin) / 2, hw = Math.max(1, (rw - rin) / 2);
  c = mk(S, S, true); const x = c.getContext('2d'), im = x.createImageData(S, S), d = im.data;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const dx = i + 0.5 - cx, dy = j + 0.5 - cy, dd = Math.sqrt(dx * dx + dy * dy); if (dd > r) continue;
    const a = Math.atan2(dy, dx), lit = Math.cos(a + 2.2); let col;
    if (dd > r - 1) col = P.o;
    else if (dd > rw) { // протектор
      const la = (((a - rot) / TAU * nb) % 1 + 1) % 1;
      let li = 2 + Math.round(lit * 1.6);
      if (kind === 1) li += hash(i * 7 + f, j * 3) > 0.8 ? 1 : hash(i, j + f * 5) < 0.12 ? -1 : 0;
      if (kind === 2 && ((dd * 1.7 + (a - rot) * 1.4) % 2 + 2) % 2 < 0.55) li -= 1;
      const groove = (kind === 3 && la < 0.36) || (kind === 0 && la < 0.2 && dd > rw + 1);
      col = groove ? P.gr : P.t[clamp(li, 0, 4)];
      if (!groove && dd > r - 2 && lit > 0.55 && kind !== 1) col = P.t[4];
    } else if (dd > rin + 1) { // боковина
      const s = (dd - rm) / hw; let li = 2 + Math.round(lit * (0.5 + s * 0.9) * 1.5);
      const la = (((a - rot) / TAU) % 1 + 1) % 1;
      if (Math.abs(dd - (rm + hw * 0.15)) < 1.1 && ((la > 0.05 && la < 0.3) || (la > 0.55 && la < 0.7)) && hash(Math.floor(la * 70), r) > 0.35) li += 1;
      col = P.w[clamp(li, 0, 4)];
      if (kind === 3 && lit > 0.8 && s > 0.3 && s < 0.9) col = P.hl;
      if (kind === 3 && la > 0.86 && la < 0.93 && s > -0.3 && s < 0.6) col = la < 0.875 ? STICK2 : STICK;
      if (kind === 0 && hash(i * 13 + 5, j * 11) > 0.95) col = P.t[3];
    } else if (dd > rin) col = P.o;
    else if (hub) { // обод и ступица
      const s = dd / rin; let li = s > 0.84 ? 4 : s > 0.68 ? 3 : 2; li += lit > 0.3 ? 1 : lit < -0.4 ? -1 : 0;
      col = STEELRGB[clamp(li, 0, 5)];
      if (Math.abs(s - 0.52) < 0.13) { const ba = (((a - rot) / TAU * 8) % 1 + 1) % 1; if (ba < 0.24) col = STEELRGB[0]; }
      if (s < 0.24) col = s < 0.13 ? STEELRGB[1] : STEELRGB[4];
    } else continue;
    const o = (j * S + i) * 4; d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
  }
  x.putImageData(im, 0, 0); TS.set(key, c); return c;
}
// Шина ребром к камере (катится к нам/от нас, висит на вертикальной ветке): виден протектор
function tireTread(r, kind, f) {
  f = ((f | 0) % NF + NF) % NF; const key = -(((kind * 40 + r) * NF + f) + 1); let c = TS.get(key); if (c) return c;
  const P = TP[kind], w = Math.max(6, Math.round(r * 0.66)), h = 2 * r + 1, nb = r >= 10 ? 16 : 12;
  c = mk(w, h, true); const x = c.getContext('2d'), im = x.createImageData(w, h), d = im.data;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const u = (i + 0.5) / w * 2 - 1, v = (j + 0.5) / h * 2 - 1, se = Math.pow(Math.abs(u), 3) + Math.pow(Math.abs(v), 8); if (se > 1) continue;
    let col;
    if (se > 0.8 || Math.abs(u) > 0.86) col = P.o;
    else {
      const th = Math.asin(clamp(v, -1, 1)), s = ((th / TAU * nb * 2 + f / NF * nb) % 1 + 1) % 1, au = Math.abs(u);
      let li = 2 + Math.round(-u * 1.1 - Math.pow(Math.abs(v), 3) * 1.8 + 0.4);
      let groove = false;
      if (kind === 3) groove = ((s + au * 0.3) % 1) < 0.32 || au < 0.1;
      else if (kind === 0) groove = ((s + au * 0.25) % 1) < 0.16 && au < 0.75;
      else if (kind === 2) { if (((u * 2.5 + s * 2) % 1 + 1) % 1 < 0.3) li -= 1; }
      else if (hash(i * 5 + f, j) > 0.82) li += 1;
      col = groove ? P.gr : P.t[clamp(li, 0, 4)];
    }
    const o = (j * w + i) * 4; d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
  }
  x.putImageData(im, 0, 0); TS.set(key, c); return c;
}
// Шина плашмя (вид 3/4): сверху кольцо, спереди полоса протектора; для стопок, тележек, погрузчика
const TF = [];
function tireFlat(kind, big) {
  const ix = kind + (big ? 4 : 0); if (TF[ix]) return TF[ix];
  const P = TP[kind], W = big ? 30 : 24, H = big ? 24 : 19, c = mk(W, H, true), x = c.getContext('2d'), im = x.createImageData(W, H), d = im.data;
  const cx = W / 2, cy = big ? 8 : 6.5, rx = big ? 13.5 : 10.5, ry = big ? 6.6 : 5.2, bh = big ? 7 : 5, hx = big ? 6.5 : 5, hy = big ? 3.2 : 2.5;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const X = i + 0.5, Y = j + 0.5, ux = (X - cx) / rx, top = ux * ux + ((Y - cy) / ry) ** 2 <= 1, band = Math.abs(ux) <= 1 && Y >= cy && ux * ux + ((Y - cy - bh) / ry) ** 2 <= 1;
    if (!top && !band) continue;
    let col;
    if (top) {
      const hole = ((X - cx) / hx) ** 2 + ((Y - cy) / hy) ** 2 <= 1;
      if (hole) col = Y < cy - 0.6 ? P.w[2] : P.w[0];
      else { const a = Math.atan2((Y - cy) / ry, (X - cx) / rx), lit = Math.cos(a + 2.2), rr = Math.sqrt(ux * ux + ((Y - cy) / ry) ** 2); col = P.w[clamp(2 + Math.round(lit * 1.4 + (rr > 0.86 ? 0.6 : 0)), 0, 4)]; if (kind === 3 && lit > 0.75 && rr > 0.62 && rr < 0.85) col = P.hl; }
    } else {
      let li = clamp(3 - Math.round((ux + 1) * 1.3), 0, 4); const groove = kind === 3 ? i % 3 === 0 : kind === 0 ? i % 4 === 0 && j % 2 === 0 : false;
      if (kind === 2 && j % 2 === 0) li = Math.max(0, li - 1); if (kind === 1 && hash(i, j) > 0.75) li = Math.min(4, li + 1);
      col = groove ? P.gr : P.t[li];
      if (kind === 3 && i >= W * 0.62 && i <= W * 0.62 + 1 && Y > cy + 2) col = STICK;
    }
    const o = (j * W + i) * 4; d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
  }
  x.putImageData(im, 0, 0); selOut(c, true); TF[ix] = c; return c;
}
// стопка плашмя: (x, y) — середина низа
function stack(x, y, ids, from, n) { let yy = y; for (let k = 0; k < n; k++) { const id = ids[from + k]; if (id === undefined) return; const t = V.S.tires.get(id), big = !!t && t.prod === 'otr', sp = tireFlat(kindOf(t), big); g.drawImage(sp, x - (sp.width >> 1), yy - sp.height + 1); yy -= big ? 7 : 5; } }
// Контур спрайта: прозрачный пиксель рядом с непрозрачным → затемнённый цвет соседа (мягкий 16-битный контур)
function selOut(c, hard) {
  const x = c.getContext('2d'), W = c.width, H = c.height, im = x.getImageData(0, 0, W, H), d = im.data, s = new Uint8ClampedArray(d);
  const A = (i, j) => i >= 0 && j >= 0 && i < W && j < H && s[(j * W + i) * 4 + 3] > 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const o = (j * W + i) * 4; if (s[o + 3]) continue;
    const n = A(i + 1, j) ? o + 4 : A(i - 1, j) ? o - 4 : A(i, j + 1) ? o + W * 4 : A(i, j - 1) ? o - W * 4 : -1; if (n < 0) continue;
    if (hard) { d[o] = 8; d[o + 1] = 7; d[o + 2] = 12; } else { d[o] = s[n] * 0.2 + 10; d[o + 1] = s[n + 1] * 0.18 + 8; d[o + 2] = s[n + 2] * 0.24 + 18; }
    d[o + 3] = 255;
  }
  x.putImageData(im, 0, 0);
}

// ---------- рабочие: 16-битные спрайты 32×48, синий комбинезон, рубашка цвета рабочего, наушники ----------
const SKINS = [['#f7d5b3', '#ecbe98', '#cf9873'], ['#ecc19a', '#dca67d', '#b9845d'], ['#d29a6c', '#bd8156', '#98613a'], ['#a8704a', '#8f5a37', '#6c4026'], ['#7c4c30', '#673c24', '#4b2a18']];
const HAIRS = ['#2c1e16', '#141117', '#b9873c', '#8a3b1e', '#5d4a3a', '#d9b866', '#9c9ca4', '#5a2418'];
const MUFF = [['#4a0b0e', '#8e1c1a', '#cf342c', '#f0634e', '#ffa894'], ['#5e3a04', '#b47a08', '#efb81d', '#ffd84e', '#fff2ae']]; // красные и жёлтые чашки
const OVR = ['#0e1a38', '#162856', '#203c7c', '#2c519e', '#4470c2', '#78a0e0'];
const BOOT = ['#110c0a', '#241a15', '#38291f', '#5a4636'];
const GLOVE = ['#1e2027', '#353943', '#525866', '#7a8294'];
const BAND = '#2b2e37', BANDL = '#5f6676';
const FEM = /^(Anna|Svetlana|Fatma|Olga|Sophie|Leonie|Ayşe|Ayse|Katarina|Irina|Lena|Maria|Julia|Laura|Lea|Emma|Mia|Hannah|Elena|Natalia|Sarah|Nina|Jana|Petra|Sabine|Monika|Elif|Zeynep)$/;
function looksOf(w) { // внешность рабочего: постоянная, по номеру, имени и роли
  const id = w.id | 0, first = String(w.name || '').split(' ')[0], fem = FEM.test(first) || /in$/.test(w.role || '');
  const style = fem ? 10 + id % 3 : id % 5;
  return { skin: SKINS[(id * 7 + 3) % SKINS.length], hair: HAIRS[(id * 5 + 1) % HAIRS.length], shirt: w.color || '#d9534f', vest: w.color, muff: id % 2, beard: !fem && (id % 5 === 2 || style === 4), style, fem, helmet: null };
}
const normSkin = s => !Array.isArray(s) ? SKINS[0] : s.length >= 3 ? s : [shade(s[0], 0.18), s[0], s[1] || shade(s[0], -0.2)];
function poseInfo(view, pose) {
  let k = -1, oy = 0, sit = false;
  if (pose.startsWith('walk')) { k = (parseInt(pose.slice(4), 10) || 0) & 7; oy = view === 'side' ? (k % 4 === 0 ? -1 : 0) : (k % 4 === 2 ? -1 : 0); }
  else if (pose === 'breathe') oy = -1;
  else if (pose === 'sit') { oy = 3; sit = true; }
  return { k, oy, sit };
}
const S1 = (y, x0, x1, c) => R(x0, y, x1 - x0 + 1, 1, c);
function boot(x, y, w, back) { R(x, y, w, 4, BOOT[2]); if (!back) R(x + 1, y, w - 2, 1, BOOT[3]); R(x, y + 3, w, 1, BOOT[0]); R(x + w - 1, y + 1, 1, 2, BOOT[1]); }
function legF(x, lift, right, back) {
  const bot = 41 - lift, h = bot - 33;
  R(x, 34, 5, h, OVR[3]);
  if (right) { R(x + 3, 34, 2, h, OVR[2]); R(x, 34, 1, h, OVR[2]); } else { R(x, 34, 1, h, OVR[4]); R(x + 4, 34, 1, h, OVR[2]); }
  R(x, bot - 3, 5, 1, '#eef3f8'); R(x, bot - 2, 5, 1, '#a9b5c2');                   // светоотражающая полоса
  boot(right ? x : x - 1, bot + 1, 6, back);
}
function legsFront(k, sit, back) {
  if (sit) {
    R(10, 32, 13, 5, OVR[3]); R(10, 32, 13, 1, OVR[4]); R(16, 33, 1, 4, OVR[1]); R(21, 33, 2, 4, OVR[2]);
    R(11, 37, 5, 4, OVR[2]); R(17, 37, 5, 4, OVR[2]); R(11, 37, 1, 4, OVR[3]); R(17, 37, 1, 4, OVR[3]);
    boot(10, 41, 6, back); boot(17, 41, 6, back); return;
  }
  const s = k >= 0 ? Math.sin(k / 8 * TAU) : 0, lL = Math.round(Math.max(0, s) * 2), lR = Math.round(Math.max(0, -s) * 2);
  R(11, 31, 11, 3, OVR[3]); R(11, 31, 1, 3, OVR[4]); R(20, 31, 2, 3, OVR[2]); R(16, 32, 1, 2, OVR[1]);
  if (back) { R(12, 31, 3, 2, OVR[2]); R(18, 31, 3, 2, OVR[2]); }
  legF(11, lL, false, back); legF(17, lR, true, back);
}
function legS(f, lift, near) {
  const top = 34, bot = 41 - lift, c1 = near ? OVR[3] : OVR[1], c2 = near ? OVR[4] : OVR[2];
  for (let y = top; y <= bot; y++) { const cx = Math.round(16 + f * (y - top) / Math.max(1, bot - top)); R(cx - 2, y, 4, 1, y === bot - 3 ? (near ? '#eef3f8' : '#8e9aa8') : c1); px(cx - 2, y, y === bot - 3 ? (near ? '#ffffff' : '#a9b5c2') : c2); }
  const bx = Math.round(16 + f) - 2; R(bx, bot + 1, 7, 3, near ? BOOT[2] : BOOT[1]); R(bx + 3, bot + 1, 4, 1, near ? BOOT[3] : BOOT[2]); R(bx, bot + 4, 7, 1, BOOT[0]);
}
function legsSide(k, sit) {
  if (sit) {
    R(12, 31, 11, 4, OVR[3]); R(12, 31, 11, 1, OVR[4]); R(19, 35, 4, 7, OVR[2]); R(19, 35, 1, 7, OVR[3]);
    R(18, 42, 7, 3, BOOT[2]); R(21, 42, 4, 1, BOOT[3]); R(18, 45, 7, 1, BOOT[0]); return;
  }
  R(12, 31, 9, 3, OVR[3]); R(12, 31, 1, 3, OVR[4]); R(19, 31, 2, 3, OVR[2]);
  let fN = 1, fF = -1, lN = 0, lF = 0;
  if (k >= 0) { const ph = k / 8 * TAU, s = Math.sin(ph), c = Math.cos(ph); fN = Math.round(s * 4); fF = -fN; lN = c > 0.3 ? Math.round(c * 2) : 0; lF = c < -0.3 ? Math.round(-c * 2) : 0; }
  legS(fF, lF, false); legS(fN, lN, true);
}
function torsoFront(sh, oy, back) {
  const y = 20 + oy, hh = 31 - y;
  S1(y, 11, 21, sh[3]); R(10, y + 1, 13, hh, sh[3]); R(10, y + 1, 1, hh, sh[4]); R(21, y + 1, 2, hh, sh[2]); R(22, y + 3, 1, hh - 2, sh[1]);
  if (!back) {
    const by = y + 4, bh = 31 - by + 1;
    R(12, by, 9, bh, OVR[3]); R(12, by, 1, bh, OVR[4]); R(20, by, 1, bh, OVR[2]); S1(by, 12, 20, OVR[4]);
    R(14, by + 2, 5, 3, OVR[2]); S1(by + 2, 14, 18, OVR[4]); R(16, by + 3, 1, 2, OVR[1]);                     // карман
    R(12, y, 2, 4, OVR[3]); R(19, y, 2, 4, OVR[3]); R(12, y, 1, 4, OVR[4]); R(19, y, 1, 4, OVR[4]);           // лямки
    R(12, by, 2, 1, '#e8c25a'); R(19, by, 2, 1, '#e8c25a'); px(13, by, '#a8862a'); px(20, by, '#a8862a');     // пряжки
    R(15, y, 2, 1, sh[1]);
  } else {
    for (let i = 0; i < 6; i++) { R(12 + i, y + i, 2, 1, OVR[3]); R(19 - i, y + i, 2, 1, OVR[3]); }
    const by = y + 6; R(11, by, 11, 31 - by + 1, OVR[3]); S1(by, 11, 21, OVR[4]); R(20, by + 1, 2, 31 - by, OVR[2]);
  }
}
function torsoSide(sh, oy) {
  const y = 20 + oy;
  S1(y, 13, 19, sh[3]); R(12, y + 1, 9, 31 - y, sh[3]); R(12, y + 1, 1, 31 - y, sh[4]); R(19, y + 1, 2, 31 - y, sh[2]);
  R(18, y + 3, 3, 31 - y - 2, OVR[3]); R(20, y + 3, 1, 31 - y - 2, OVR[2]); px(18, y + 3, OVR[4]);
  for (let i = 0; i < 4; i++) R(14 + i, y + i, 2, 1, OVR[3]);
  R(12, 28, 9, 4, OVR[3]); S1(28, 12, 20, OVR[4]); R(19, 29, 2, 3, OVR[2]);
}
function cup(x, y, M, inner) { // чашка наушника: inner — сторона подушки (−1 слева, 1 справа, 0 — не видно)
  S1(y, x + 1, x + 3, M[2]); R(x, y + 1, 5, 5, M[2]); S1(y + 6, x + 1, x + 3, M[1]);
  R(x, y + 1, 1, 5, M[3]); R(x + 4, y + 2, 1, 4, M[1]); px(x + 1, y + 1, M[4]); px(x + 2, y + 1, M[3]); S1(y + 5, x + 1, x + 3, M[1]);
  if (inner < 0) R(x, y + 1, 1, 5, '#202128'); if (inner > 0) R(x + 4, y + 1, 1, 5, '#202128');
}
function muffsFB(M, y, back) {
  S1(1 + y, 12, 19, BAND); S1(1 + y, 13, 18, BANDL); R(10, 2 + y, 2, 2, BAND); R(20, 2 + y, 2, 2, BAND);
  R(8, 4 + y, 2, 5, BAND); R(22, 4 + y, 2, 5, BAND); R(8, 4 + y, 1, 4, BANDL); px(10, 2 + y, BANDL);
  cup(6, 9 + y, M, back ? 0 : 1); cup(21, 9 + y, M, back ? 0 : -1);
}
function hairFront(h, hl, hd, st, y, sk) {
  const S = (yy, a, b, c = h) => S1(yy + y, a, b, c);
  switch (st) {
    case 1: S(2, 13, 18); S(3, 11, 20); for (let r = 4; r <= 7; r++) S(r, 10, 21); S(8, 10, 12); S(8, 16, 21); S(9, 18, 21); S(9, 10, 10); S(10, 21, 21); S(3, 14, 14, hd); S(3, 12, 13, hl); S(4, 11, 12, hl); S(5, 15, 18, hl); break;
    case 2: S(4, 12, 19, hd); S(5, 11, 20, hd); S(6, 10, 21); S(7, 10, 11); S(7, 20, 21); S(8, 10, 10); S(8, 21, 21); for (let i = 12; i < 20; i += 2) px(i, 5 + y, h); px(13, 4 + y, hl); px(15, 4 + y, hl); break;
    case 3: for (let i = 11; i <= 20; i += 2) px(i, 2 + y, h); S(3, 10, 21); for (let r = 4; r <= 7; r++) S(r, 9, 22); S(8, 9, 11); S(8, 20, 22); for (let r = 9; r <= 10; r++) { S(r, 9, 10); S(r, 21, 22); } for (const [a, b] of [[12, 4], [15, 3], [18, 5], [11, 6], [16, 6], [20, 4], [13, 7]]) px(a, b + y, hl); break;
    case 4: S(3, 12, 19, sk[1]); S(4, 11, 20, sk[1]); S(5, 10, 21, sk[1]); S(6, 10, 21, sk[1]); S(4, 13, 15, sk[0]); S(5, 12, 13, sk[0]); S(6, 20, 21, sk[2]); for (let r = 8; r <= 11; r++) { S(r, 10, 10); S(r, 21, 21); } break;
    case 11: S(3, 12, 19); S(4, 11, 20); S(5, 10, 21); S(6, 9, 22); S(7, 9, 22); S(8, 9, 13); S(8, 18, 22); for (let r = 9; r <= 17; r++) { S(r, 9, 10); S(r, 21, 22); } S(4, 13, 15, hl); S(5, 12, 13, hl); S(6, 20, 22, hd); break;
    default: // 0 коротко, 10 хвост, 12 пучок
      if (st === 12) { S(0, 14, 17); S(1, 13, 18); px(14, 0 + y, hl); }
      S(3, 12, 19); S(4, 11, 20); for (let r = 5; r <= 7; r++) S(r, 10, 21); S(8, 10, 11); S(8, 20, 21);
      if (st >= 10) { S(8, 12, 19); S(9, 10, 11); S(9, 20, 21); S(10, 10, 10); S(10, 21, 21); S(8, 15, 16, hd); } else { S(8, 12, 14); S(9, 10, 10); S(9, 21, 21); }
      S(4, 13, 15, hl); S(5, 12, 13, hl); S(6, 20, 21, hd);
  }
}
function headFront(o, sk, hair, M, st, oy, blink) {
  const y = oy, hl = shade(hair, 0.3), hd = shade(hair, -0.35);
  R(14, 18 + y, 4, 2, sk[2]);
  S1(7 + y, 12, 19, sk[1]); S1(8 + y, 11, 20, sk[1]); R(10, 9 + y, 12, 7, sk[1]); S1(16 + y, 11, 20, sk[1]); S1(17 + y, 12, 19, sk[1]); S1(18 + y, 13, 18, sk[2]);
  R(20, 9 + y, 2, 7, sk[2]); S1(16 + y, 19, 20, sk[2]); S1(17 + y, 18, 19, sk[2]); R(11, 9 + y, 1, 5, sk[0]); S1(8 + y, 12, 14, sk[0]);
  if (blink) { S1(13 + y, 12, 13, '#4a2e28'); S1(13 + y, 18, 19, '#4a2e28'); }
  else { R(12, 12 + y, 2, 2, '#1e1620'); R(18, 12 + y, 2, 2, '#1e1620'); px(12, 12 + y, '#ffffff'); px(18, 12 + y, '#ffffff'); }
  S1(10 + y, 12, 14, hd); S1(10 + y, 17, 19, hd);
  S1(14 + y, 15, 16, sk[2]); S1(16 + y, 14, 17, '#95463f'); px(17, 16 + y, '#b8665a');
  const bl = mix(sk[1], '#e0505a', 0.3); px(11, 14 + y, bl); px(20, 14 + y, bl);
  if (o.beard) { const b = hair, bd = hd; S1(15 + y, 10, 11, b); S1(15 + y, 20, 21, b); S1(16 + y, 10, 13, b); S1(16 + y, 18, 21, b); S1(17 + y, 11, 20, b); S1(18 + y, 12, 19, b); S1(19 + y, 13, 18, bd); S1(15 + y, 13, 18, b); S1(16 + y, 14, 17, '#95463f'); px(14, 18 + y, hl); px(17, 17 + y, hl); }
  hairFront(hair, hl, hd, st, y, sk);
  muffsFB(M, y, false);
}
function headBack(o, sk, hair, M, st, oy) {
  const y = oy, hl = shade(hair, 0.3), hd = shade(hair, -0.35), S = (yy, a, b, c = hair) => S1(yy + y, a, b, c);
  R(13, 16 + y, 6, 4, sk[2]); px(13, 16 + y, sk[1]);
  if (st === 4) { S(3, 12, 19, sk[1]); S(4, 11, 20, sk[1]); for (let r = 5; r <= 10; r++) S(r, 10, 21, sk[1]); S(4, 13, 15, sk[0]); for (let r = 11; r <= 14; r++) S(r, 10, 21); S(15, 11, 20); }
  else {
    const wide = st === 3 ? 1 : 0;
    S(3, 12, 19); S(4, 11, 20); for (let r = 5; r <= 14; r++) S(r, 10 - wide, 21 + wide); S(15, 11, 20); S(16, 12, 19);
    S(4, 13, 16, hl); S(5, 12, 14, hl); S(6, 12, 13, hl); for (let r = 6; r <= 14; r++) S(r, 20 + wide, 21 + wide, hd); S(16, 15, 16, hd);
    if (st === 10) { R(15, 13 + y, 3, 8, hair); R(15, 13 + y, 1, 8, hl); R(16, 21 + y, 2, 2, hd); S1(13 + y, 15, 17, '#d24a5a'); }
    if (st === 11) { S(15, 9, 22); S(16, 9, 22); S(17, 10, 21, hd); }
    if (st === 12) { S(0, 14, 17); S(1, 13, 18); S(2, 13, 18); px(14, y, hl); }
  }
  muffsFB(M, y, true);
}
function headSide(o, sk, hair, M, st, oy, blink) {
  const y = oy, hl = shade(hair, 0.3), hd = shade(hair, -0.35), S = (yy, a, b, c = hair) => S1(yy + y, a, b, c);
  R(15, 18 + y, 4, 3, sk[2]);
  S(7, 15, 20, sk[1]); S(8, 14, 21, sk[1]); for (let r = 9; r <= 15; r++) S(r, 13, 22, sk[1]); S(16, 14, 21, sk[1]); S(17, 15, 20, sk[1]); S(18, 16, 19, sk[2]);
  R(23, 12 + y, 1, 2, sk[1]); px(23, 14 + y, sk[2]); px(22, 15 + y, sk[2]); R(21, 9 + y, 1, 7, sk[2]); px(22, 9 + y, sk[2]);
  if (blink) S(12, 20, 21, '#4a2e28'); else { R(20, 11 + y, 1, 2, '#1e1620'); px(21, 11 + y, '#f4f0f0'); }
  S(9, 19, 21, hd); S(16, 21, 22, '#95463f'); px(20, 14 + y, mix(sk[1], '#e0505a', 0.3));
  if (o.beard) { S(15, 15, 21); S(16, 15, 20); S(17, 15, 21); S(18, 16, 20, hd); S(16, 21, 22, '#95463f'); }
  if (st === 4) { S(3, 13, 19, sk[1]); S(4, 12, 21, sk[1]); S(5, 11, 22, sk[1]); S(6, 11, 22, sk[1]); S(4, 14, 17, sk[0]); for (let r = 9; r <= 14; r++) S(r, 11, 13); }
  else {
    const wide = st === 3 ? 1 : 0;
    S(3, 13, 19); S(4, 12, 21); S(5, 11 - wide, 22); S(6, 11 - wide, 22); S(7, 11 - wide, 14); S(7, 20, 22);
    for (let r = 8; r <= 15; r++) S(r, 11 - wide, r < 12 ? 14 : 13); S(16, 12, 14);
    if (st >= 10 || st === 1) S(8, 20, 22);
    S(4, 14, 17, hl); S(5, 13, 15, hl); for (let r = 8; r <= 15; r++) px(11 - wide, r + y, hd);
    if (st === 10) { R(8, 9 + y, 3, 7, hair); R(8, 9 + y, 3, 1, hl); px(9, 16 + y, hd); R(11, 9 + y, 1, 2, '#d24a5a'); }
    if (st === 11) { for (let r = 15; r <= 18; r++) S(r, 10, 14); S(18, 11, 14, hd); }
    if (st === 12) { R(9, 4 + y, 4, 4, hair); px(10, 4 + y, hl); }
  }
  // наушник: чашка и дужка через макушку
  R(14, 2 + y, 2, 7, BAND); R(14, 2 + y, 1, 7, BANDL); S1(1 + y, 14, 16, BAND);
  cup(13, 9 + y, M, 0);
}
// Рука: рукав (цвет рубашки) → предплечье → перчатка; толщина 3, мягкий контур
function limb(x0, y0, x1, y1, cS, cK, far) {
  const n = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  const sl = far ? shade(cS, -0.35) : cS, hl = far ? sl : shade(cS, 0.32), sk = far ? shade(cK, -0.28) : cK, gl = far ? GLOVE[1] : GLOVE[2];
  g.fillStyle = OUT;
  for (let i = 0; i <= n; i++) g.fillRect(Math.round(x0 + (x1 - x0) * i / n) - 2, Math.round(y0 + (y1 - y0) * i / n) - 2, 5, 5);
  for (let i = 0; i <= n; i++) { const t = i / n, x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t); g.fillStyle = t < 0.42 ? sl : t < 0.78 ? sk : gl; g.fillRect(x - 1, y - 1, 3, 3); if (t < 0.42) { g.fillStyle = hl; g.fillRect(x - 1, y - 1, 1, 1); } }
  const hx = Math.round(x1), hy = Math.round(y1); g.fillStyle = gl; g.fillRect(hx - 1, hy - 1, 3, 3); g.fillStyle = far ? GLOVE[2] : GLOVE[3]; g.fillRect(hx - 1, hy - 1, 1, 1);
}
// Рука из кэша спрайтов рабочего (по смещению кисти от плеча) — вместо десятков fillRect в каждом кадре
function arm(st, x0, y0, x1, y1, far) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = x1 - x0, dy = y1 - y0, key = ((dx + 40) * 128 + (dy + 64)) * 2 + (far ? 1 : 0);
  let c = st.arms.get(key);
  if (!c) { const ox = dx < 0 ? 3 - dx : 3, oy = dy < 0 ? 3 - dy : 3; c = paint(mk(Math.abs(dx) + 7, Math.abs(dy) + 7), () => limb(ox, oy, ox + dx, oy + dy, st.look.shirt, st.look.skin[1], far)); c.ox = ox; c.oy = oy; st.arms.set(key, c); }
  g.drawImage(c, x0 - c.ox, y0 - c.oy);
}
const SPW = 32, SPH = 48;
const PC = new Map();
// Детальный спрайт человечка (холст 32×48, ноги в точке 16,46). Без каски — наушники-антифоны поверх волос.
// view: front/back/side (side — смотрит вправо); pose: stand, breathe, sit, walk0…walk7; arms: none — руки рисует кадр
function personHR(o) {
  o = o || {};
  const view = o.view === 'back' || o.view === 'side' ? o.view : 'front', pose = String(o.pose || 'stand');
  const sk = normSkin(o.skin), hair = o.hair || HAIRS[0], shirt = o.shirt || o.vest || '#d9534f', mi = (o.muff | 0) % MUFF.length, M = MUFF[mi];
  const st = o.style | 0, arms = o.arms === undefined || o.arms === null ? 'hang' : String(o.arms), blink = !!o.blink && view !== 'back';
  const key = sk[1] + hair + shirt + mi + (o.beard ? 1 : 0) + st + view + pose + arms + (blink ? 1 : 0);
  let c = PC.get(key); if (c) return c;
  const { k, oy, sit } = poseInfo(view, pose);
  c = mk(SPW, SPH, true);
  paint(c, () => {
    const sh = ramp(shirt);
    if (view === 'side') { legsSide(k, sit); torsoSide(sh, oy); headSide(o, sk, hair, M, st, oy, blink); }
    else { legsFront(k, sit, view === 'back'); torsoFront(sh, oy, view === 'back'); if (view === 'back') headBack(o, sk, hair, M, st, oy); else headFront(o, sk, hair, M, st, oy, blink); }
    if (arms !== 'none') { // руки для внешних вызовов
      const y = 21 + oy;
      if (view === 'side') limb(16, y, arms === 'up' ? 21 : arms === 'carry' ? 23 : 17, arms === 'up' ? 10 + oy : arms === 'carry' ? 26 + oy : 30 + oy, shirt, sk[1], false);
      else { const up = arms === 'up', ca = arms === 'carry'; limb(10, y, up ? 8 : ca ? 12 : 9, up ? 12 + oy : ca ? 26 + oy : 30 + oy, shirt, sk[1], false); limb(22, y, up ? 24 : ca ? 20 : 23, up ? 12 + oy : ca ? 26 + oy : 30 + oy, shirt, sk[1], false); }
    }
  });
  selOut(c); c.oy = oy; PC.set(key, c); return c;
}

// ---------- инструменты в руке (рука в точке hx,hy, человечек смотрит вправо) ----------
function toolPose(tool, on, t) { // [ближняя рука x,y, дальняя рука x,y] от точки ног
  const s = Math.sin;
  switch (tool) {
    case 'grinder': return on ? [9 + Math.round(Math.cos(t * 4) * 1.5 + Math.random() - 0.5), -20 + Math.round(s(t * 4) * 1.5 + Math.random() - 0.5), 6, -18] : [8, -19, 5, -17];
    case 'spray': return [9, -22 + Math.round(on ? s(t * 2.4) * 4 : 0), 4, -18];
    case 'extruder': return [8 + Math.round(on ? s(t * 1.3) * 2 : 0), -20, 5, -17];
    case 'roller': return [8 + Math.round(on ? s(t * 5) * 3 : 0), -18, 4, -17];
    case 'lamp': return [9, -24 + Math.round(on ? s(t * 1.6) * 3 : 0), 1, -16];
    case 'tablet': return [6, -21, 7, on && s(t * 7) > 0.4 ? -21 : -20];
    case 'clipboard': return [6, -20, 8, on && s(t * 9) > 0 ? -20 : -19];
    case 'pendant': return [6, on && s(t * 3) > 0.8 ? -21 : -22, 1, -16];
    case 'wrench': return [8, -21 + Math.round(on ? s(t * 5) * 3 : 0), 5, -17];
    case 'broom': { const b = on ? Math.round(s(t * 4) * 3) : 0; return [5 + b, -20, 3 + b, -14]; }
    case 'scangun': return [8, -22, 1, -16];
    case 'knife': { const p = on ? (t * 1.6) % 1 : 0.3; return [7 + Math.round(p * 5), -18 + Math.round(p * 2), 4, -19]; }
    case 'canister': case 'toolbox': return [3, -14, -1, -16];
    case 'cup': return on && (t * 0.45) % 1 < 0.25 ? [5, -31, -1, -16] : [6, -21, -1, -16];
    case 'sign': return [6, -29 + (on ? Math.round(s(t * 4) * 2) : 0), 3, -26 + (on ? Math.round(s(t * 4) * 2) : 0)];
    case 'book': return [6, -17, 3, -17];
    default: { const a = on ? s(t * 5) : 0; return [8, -20 + Math.round(a * 3), 6, -19 - Math.round(a * 3)]; }
  }
}
function drawTool(tool, on, t, hx, hy) {
  const f2 = Math.floor(t * 12) & 1;
  switch (tool) {
    case 'grinder': // пневмошлифовка: корпус, круг под кожухом
      R(hx - 6, hy - 3, 11, 5, OUT); R(hx - 5, hy - 2, 9, 3, BLUE[3]); R(hx - 5, hy - 2, 9, 1, BLUE[5]); R(hx - 5, hy, 9, 1, BLUE[1]);
      R(hx + 4, hy - 7, 4, 12, OUT); R(hx + 5, hy - 6, 2, 10, on ? (f2 ? STEEL[5] : STEEL[2]) : STEEL[4]); if (on) px(hx + 5 + f2, hy - 4 + f2 * 3, '#ffffff');
      R(hx + 3, hy - 8, 4, 3, DARK[4]); R(hx - 8, hy - 1, 2, 1, DARK[3]); break;
    case 'spray': // краскопульт с бачком и шлангом
      R(hx - 2, hy - 4, 9, 4, OUT); R(hx - 1, hy - 3, 7, 2, STEEL[4]); R(hx - 1, hy - 3, 7, 1, STEEL[5]); R(hx + 7, hy - 3, 2, 2, DARK[3]);
      R(hx, hy - 9, 5, 6, OUT); R(hx + 1, hy - 8, 3, 4, '#dfeaf2'); px(hx + 1, hy - 8, '#ffffff'); R(hx - 1, hy, 2, 4, DARK[2]); break;
    case 'extruder': { // большой пистолет-экструдер: корпус, бункер со шнуром, горячее сопло
      R(hx - 6, hy - 7, 15, 7, OUT); R(hx - 5, hy - 6, 13, 5, STEEL[3]); R(hx - 5, hy - 6, 13, 1, STEEL[5]); R(hx - 5, hy - 2, 13, 1, STEEL[1]);
      R(hx - 2, hy - 6, 3, 5, on ? (f2 ? ORG[4] : ORG[3]) : ORG[2]);
      R(hx - 3, hy - 12, 7, 6, OUT); R(hx - 2, hy - 11, 5, 4, DARK[3]); R(hx - 1, hy - 14, 2, 3, '#1b1b20');
      R(hx + 9, hy - 5, 4, 3, OUT); R(hx + 9, hy - 4, 3, 1, on ? (f2 ? '#ff7a2a' : '#ffc060') : '#9a6a4a'); if (on) px(hx + 12, hy - 4, '#fff0c0');
      R(hx - 1, hy, 2, 3, DARK[2]); break;
    }
    case 'roller': // прикаточный ролик
      R(hx, hy - 1, 7, 2, WOOD[3]); R(hx, hy - 1, 7, 1, WOOD[4]); R(hx + 6, hy - 4, 5, 8, OUT); R(hx + 7, hy - 3, 3, 6, DARK[3]); px(hx + 7, hy - 3, DARK[5]); break;
    case 'lamp': // лампа осмотра со световым конусом
      R(hx - 2, hy - 4, 8, 6, OUT); R(hx - 1, hy - 3, 6, 4, YEL[3]); R(hx - 1, hy - 3, 6, 1, YEL[5]); R(hx + 6, hy - 4, 2, 6, '#fffbe0');
      if (on) for (let k = 0; k < 12; k++) R(hx + 8 + k, hy - 3 - Math.round(k * 0.35), 1, 4 + Math.round(k * 0.7), 'rgba(255,240,160,0.22)');
      break;
    case 'tablet': R(hx - 2, hy - 8, 9, 8, OUT); R(hx - 1, hy - 7, 7, 6, '#123'); R(hx, hy - 6, 5, 4, on && f2 ? '#62e08a' : '#3fa060'); R(hx, hy - 6, 5, 1, '#a8f0c0'); break;
    case 'clipboard': R(hx - 2, hy - 10, 8, 11, OUT); R(hx - 1, hy - 9, 6, 9, WOOD[3]); R(hx, hy - 8, 4, 7, '#f4f4f0'); R(hx + 1, hy - 7, 2, 1, '#888'); R(hx + 1, hy - 5, 3, 1, '#888'); R(hx + 1, hy - 3, 2, 1, '#888'); R(hx + 1, hy - 11, 2, 2, STEEL[4]); break;
    case 'pendant': R(hx - 2, hy - 7, 6, 10, OUT); R(hx - 1, hy - 6, 4, 8, YEL[3]); R(hx - 1, hy - 6, 4, 1, YEL[5]); px(hx, hy - 4, '#ff4d4d'); px(hx + 1, hy - 4, '#5ad65a'); px(hx, hy - 2, OUT); px(hx + 1, hy - 2, OUT); R(hx, hy - 30, 1, 23, DARK[2]); break;
    case 'wrench': R(hx - 1, hy - 1, 9, 3, OUT); R(hx, hy, 7, 1, STEEL[5]); R(hx + 6, hy - 3, 4, 7, OUT); R(hx + 7, hy - 2, 2, 5, STEEL[4]); px(hx + 7, hy, OUT);
      if (on && Math.random() < 0.15) px(hx + 10, hy - 3, '#ffe066'); break;
    case 'toolbox': R(hx - 5, hy, 11, 8, OUT); R(hx - 4, hy + 1, 9, 6, RED[3]); R(hx - 4, hy + 1, 9, 1, RED[5]); R(hx - 4, hy + 4, 9, 1, RED[1]); R(hx - 1, hy - 1, 3, 1, OUT); break;
    case 'canister': R(hx - 4, hy, 9, 11, OUT); R(hx - 3, hy + 1, 7, 9, BLUE[3]); R(hx - 3, hy + 1, 1, 9, BLUE[5]); R(hx - 2, hy + 4, 5, 3, '#eef3f8'); R(hx - 1, hy - 1, 3, 1, OUT); break;
    case 'broom': { // метла: черенок к полу, щётка метёт
      const bx = hx + 9, by = -2; line(hx, hy, bx, by - 1, WOOD[2], 1); line(hx + 1, hy, bx + 1, by - 1, WOOD[4], 1);
      R(bx - 4, by - 1, 10, 3, OUT); R(bx - 3, by, 8, 2, '#d9b25a'); R(bx - 3, by + 1, 8, 1, '#a8822e'); break;
    }
    case 'scangun': R(hx - 2, hy - 4, 8, 5, OUT); R(hx - 1, hy - 3, 6, 3, DARK[3]); px(hx + 5, hy - 2, '#ff3030'); R(hx - 1, hy, 2, 3, DARK[2]);
      if (on && f2) R(hx + 7, hy - 2, 10, 1, 'rgba(255,50,50,0.7)'); break;
    case 'knife': R(hx - 2, hy - 1, 4, 3, WOOD[2]); R(hx + 2, hy - 1, 6, 1, '#e8ecf2'); R(hx + 2, hy, 6, 1, STEEL[3]); R(hx + 7, hy - 3, 1, 3, '#e8ecf2'); break;
    case 'sign': // плакат забастовки на палке
      R(hx, hy - 14, 1, 16, WOOD[2]); R(hx - 8, hy - 24, 17, 11, OUT); R(hx - 7, hy - 23, 15, 9, '#f4f2ea'); R(hx - 7, hy - 23, 15, 1, '#ffffff');
      R(hx - 5, hy - 21, 11, 2, RED[3]); R(hx - 5, hy - 17, 7, 1, '#3a3a44'); R(hx + 3, hy - 17, 3, 1, '#3a3a44'); break;
    case 'book': R(hx - 6, hy - 5, 13, 7, OUT); R(hx - 5, hy - 4, 5, 5, '#f4f2ea'); R(hx + 1, hy - 4, 5, 5, '#e8e4d8'); R(hx, hy - 4, 1, 5, RED[2]); R(hx - 4, hy - 2, 3, 1, '#9a9a9a'); R(hx + 2, hy - 2, 3, 1, '#9a9a9a'); break;
    case 'cup': R(hx - 2, hy - 4, 5, 5, OUT); R(hx - 1, hy - 3, 3, 3, '#f4f4f4'); px(hx + 2, hy - 2, '#f4f4f4'); px(hx - 1, hy - 3, '#7a4a2a'); break;
  }
}
// Инструмент по участку: лампа, шлифмашинка, распылитель, пистолет-экструдер, ролик…
const TOOL_G = { pflaster: 'roller', pruef: 'lamp', endk: 'tablet', rauen: 'pendant', ausschl: 'grinder', entgr: 'knife', spray: 'spray', fuellen: 'extruder', aufbau: 'pendant', scan: 'scangun' };
function toolOf(w) {
  const j = w.job; if (!j || w.state === 'break') return null;
  if (w.act === 'crane') return 'pendant';
  if (j.type === 'strike') return w.state === 'act' ? 'sign' : null;     // забастовка у ворот — плакат
  if (j.type === 'train') return w.act === 'train' ? 'book' : null;      // Schulung — учебник
  if (j.type === 'fetch') return w.tool === 'canister' ? 'canister' : null;
  if (j.type === 'repair') return w.act === 'repair' ? 'wrench' : w.tool ? 'toolbox' : null;
  if (j.type === 'idle') return j.act === 'sweep' ? 'broom' : j.act === 'inspect' ? 'clipboard' : w.state === 'act' ? (j.act === 'coffee' ? 'cup' : 'hands') : null;
  if (j.type === 'start') return w.state === 'work' ? 'hands' : null;
  if (j.type === 'work') return w.state === 'work' ? TOOL_G[j.st.g] || 'hands' : null;
  return null;
}

// ---------- частицы: искры, крошка, облой, пар, дым, туман, пыль ----------
const PS = [], PMAX = 900, ACC = new WeakMap();
const rnd = Math.random;
function rate(o, i, perSec) { let a = ACC.get(o); if (!a) { a = new Float32Array(4); ACC.set(o, a); } const v = a[i] + perSec * Math.min(dt, 0.1), n = Math.floor(v); a[i] = v - n; return n; } // накопитель «сколько частиц выпустить» на объект
// k: 0 искра, 1 крошка/облой, 2 клуб (пар, дым, пыль, туман)
function emit(k, x, y, vx, vy, max, gy, dr, fl, s0, s1, c, a0) {
  if (PS.length >= PMAX) return;
  PS.push({ k, x, y, vx, vy, t: 0, max, gy, dr, fl, s0, s1, c, a0 });
}
function stepParticles() {
  const d = Math.min(dt, 0.05);
  for (let i = PS.length - 1; i >= 0; i--) {
    const p = PS[i]; p.t += d; if (p.t >= p.max) { PS[i] = PS[PS.length - 1]; PS.pop(); continue; }
    p.vy += p.gy * d; if (p.dr) { const f = Math.exp(-p.dr * d); p.vx *= f; p.vy *= f; } p.x += p.vx * d; p.y += p.vy * d;
    if (p.fl && p.y > p.fl) { p.y = p.fl; p.vy = -p.vy * 0.25; p.vx *= 0.4; if (Math.abs(p.vy) < 10) { p.vy = 0; p.gy = 0; p.vx = 0; } }
  }
}
const SPK = ['#fffbe2', '#ffd84a', '#ff9a2a', '#c8481a'];
const PUFF = new Map();
function puffSprite(r, c) { // клуб: диск с бликом
  const key = c + r; let s = PUFF.get(key); if (s) return s;
  s = paint(mk(r * 2 + 1, r * 2 + 1), () => { disc(r + 0.5, r + 0.5, r + 0.5, c); if (r > 1) disc(r - r * 0.25 + 0.5, r - r * 0.3 + 0.5, r * 0.55, shade(c, 0.25)); });
  PUFF.set(key, s); return s;
}
function drawParticles() {
  for (let i = 0; i < PS.length; i++) {
    const p = PS[i]; if (p.x < VX - 12 || p.y < VY - 12 || p.x > VX + VW + 12 || p.y > VY + VH + 12) continue;
    const f = p.t / p.max;
    if (p.k !== 2) g.globalAlpha = 1;
    if (p.k === 0) { const c = SPK[f < 0.2 ? 0 : f < 0.45 ? 1 : f < 0.75 ? 2 : 3], A = alphas(c); g.fillStyle = c; g.fillRect(p.x | 0, p.y | 0, 1, 1); g.fillStyle = A[10]; g.fillRect((p.x - p.vx * 0.012) | 0, (p.y - p.vy * 0.012) | 0, 1, 1); g.fillStyle = A[5]; g.fillRect((p.x - p.vx * 0.024) | 0, (p.y - p.vy * 0.024) | 0, 1, 1); }
    else if (p.k === 1) { g.fillStyle = alphas(p.c)[f > 0.7 ? Math.round((1 - f) / 0.3 * 16) : 16]; g.fillRect(p.x | 0, p.y | 0, p.s0, 1); }
    else { const r = Math.round(lerp(p.s0, p.s1, f)), a = p.a0 * (1 - f) * (f < 0.12 ? f / 0.12 : 1); if (a < 0.03) continue; g.globalAlpha = a; g.drawImage(puffSprite(r, p.c), (p.x - r) | 0, (p.y - r) | 0); }
  }
  g.globalAlpha = 1;
}
const sparks = (x, y, dir, n) => { for (let k = 0; k < n; k++) { const a = (dir > 0 ? 0 : Math.PI) + (rnd() - 0.35) * 1.4 * dir, sp = 60 + rnd() * 120; emit(0, x, y, Math.cos(a) * sp, Math.sin(a) * sp * 0.7 - 20, 0.2 + rnd() * 0.3, 420, 0.6, y + 8 + rnd() * 10, 1, 1, null, 1); } };
const steam = (x, y, a0 = 0.5) => emit(2, x + (rnd() - 0.5) * 3, y, (rnd() - 0.5) * 8, -18 - rnd() * 12, 1.3 + rnd() * 0.9, -4, 0.6, 0, 1.5, 6, '#eef2f8', a0);
const smoke = (x, y) => emit(2, x + (rnd() - 0.5) * 6, y, (rnd() - 0.5) * 6, -10 - rnd() * 8, 1.8 + rnd(), -2, 0.4, 0, 2, 8, '#3c3c46', 0.65);
const crumbs = (x, y, dir, n, col) => { for (let k = 0; k < n; k++) emit(1, x, y, dir * (20 + rnd() * 70), -20 - rnd() * 60, 0.7 + rnd() * 0.6, 280, 0.5, y + 14 + rnd() * 10, rnd() < 0.3 ? 2 : 1, 1, col || (rnd() < 0.5 ? '#231d1a' : '#4a3d32'), 1); };

// ---------- фон: пол, стены, зоны, мебель (строится один раз) ----------
function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), e = hash(xi + 1, yi + 1), u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); return a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v; }
function buildBackground() {
  const { MW, MH, grid, I, T_GRASS, T_ROAD, T_YARD, T_FLOOR, T_WALL, T_DOOR } = V;
  const W = MW * Q, H = MH * Q; bg = mk(W, H);
  const bx = bg.getContext('2d'), im = bx.createImageData(W, H), d = im.data;
  const isW = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH && grid[I(x, y)] === T_WALL;
  for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) {
    let t = grid[I(tx, ty)];
    if (t === T_DOOR || t === T_WALL) { // под дверью — пол соседей
      const nb = [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([a, b]) => tx + a >= 0 && ty + b >= 0 && tx + a < MW && ty + b < MH ? grid[I(tx + a, ty + b)] : T_YARD);
      t = nb.includes(T_FLOOR) ? T_FLOOR : T_YARD;
    }
    for (let j = 0; j < Q; j++) for (let i = 0; i < Q; i++) {
      const X = tx * Q + i, Y = ty * Q + j, n = hash(X, Y); let r, gg, b;
      if (t === T_GRASS) {
        const v = vnoise(X / 22, Y / 22) + (BAYER[(Y & 3) * 4 + (X & 3)] / 16 - 0.5) * 0.28;
        [r, gg, b] = v < 0.38 ? [72, 142, 58] : v < 0.66 ? [92, 166, 70] : [116, 188, 84];
        if (n > 0.965) [r, gg, b] = [150, 214, 108]; else if (n < 0.02) [r, gg, b] = [60, 120, 50];
      } else if (t === T_ROAD) { const v = (n - 0.5) * 14 + (vnoise(X / 30, Y / 30) - 0.5) * 10; r = 74 + v; gg = 77 + v; b = 86 + v; if (n > 0.985) { r += 30; gg += 30; b += 30; } }
      else if (t === T_YARD) {
        const sx = Math.floor(X / 24), sy = Math.floor(Y / 24), tone = (hash(sx * 3, sy * 5) - 0.5) * 12, v = (n - 0.5) * 7 + tone + (vnoise(X / 40, Y / 40) - 0.5) * 10;
        r = 166 + v; gg = 170 + v; b = 177 + v;
        if (X % 24 === 0 || Y % 24 === 0) { r -= 26; gg -= 26; b -= 24; } else if (X % 24 === 1 || Y % 24 === 1) { r += 8; gg += 8; b += 8; }
      } else { // пол цеха: бетонные плиты 2×2 клетки с швами, лёгкие пятна
        const sx = Math.floor(X / 48), sy = Math.floor(Y / 48), tone = (hash(sx * 7 + 1, sy * 3 + 2) - 0.5) * 8, st = vnoise(X / 26, Y / 26), v = (n - 0.5) * 6 + tone - (st > 0.72 ? (st - 0.72) * 40 : 0);
        r = 205 + v; gg = 198 + v; b = 184 + v;
        if (X % 48 === 0 || Y % 48 === 0) { r -= 22; gg -= 22; b -= 20; } else if (X % 48 === 1 || Y % 48 === 1) { r += 7; gg += 7; b += 6; }
        else if (X % 24 === 0 || Y % 24 === 0) { r -= 4; gg -= 4; b -= 4; }
      }
      const o = (Y * W + X) * 4; d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
    }
  }
  bx.putImageData(im, 0, 0);
  const keep = g; g = bx; g.imageSmoothingEnabled = false;
  // разметка улицы: прерывистая осевая и бордюр
  for (let x = 0; x < W; x += 48) R(x + 8, Q + 10, 26, 3, '#e8e2c8');
  for (let x = 0; x < MW; x++) if (grid[I(x, 3)] !== T_ROAD && grid[I(x, 2)] === T_ROAD) { R(x * Q, 3 * Q - 2, Q, 2, '#b8bcc4'); R(x * Q, 3 * Q, Q, 1, '#6a6e78'); }
  // зоны: дерево комнаты отдыха, парковка, навес, подкраска участков
  for (const z of V.ZONES) {
    const X = z.x * Q, Y = z.y * Q, w = z.w * Q, h = z.h * Q;
    if (z.kind === 'rest') {
      for (let yy = 0; yy < h; yy += 6) { let xx = -((yy / 6) % 3) * 13; while (xx < w) { const L = 34 + Math.floor(hash(xx + X, yy + Y) * 30), c = WOOD[2 + Math.floor(hash(yy, xx) * 3)]; const a = Math.max(0, xx), b = Math.min(w, xx + L); if (b > a) { R(X + a, Y + yy, b - a, 6, c); R(X + a, Y + yy, b - a, 1, WOOD[5]); R(X + a, Y + yy + 5, b - a, 1, WOOD[1]); R(X + b - 1, Y + yy, 1, 6, WOOD[1]); } xx += L; } }
    } else if (z.kind === 'parking') { R(X, Y, w, h, '#45484f'); for (let k = 0; k < 200; k++) px(X + hash(k, 3) * w, Y + hash(5, k) * h, '#52555e'); for (let k = 0; k <= z.w; k += 2) R(X + k * Q, Y + 4, 2, h - 8, '#e8e8e8'); }
    else if (z.kind === 'shed') {
      g.fillStyle = 'rgba(30,25,20,0.08)'; g.fillRect(X, Y, w, h);
      for (let yy = 0; yy <= z.h; yy += 6) for (let xx = 0; xx <= z.w; xx += 6) { const cx = X + xx * Q - 4, cy = Y + yy * Q - 4; R(cx + 3, cy + 5, 9, 5, SHADOW); box3(cx, cy - 8, 8, 16, 4, STEEL); }
    } else { g.fillStyle = z.color; g.fillRect(X, Y, w, h); }
  }
  // ворота: З — приёмка, Р — отгрузка: плиты, отбойники, жёлто-чёрная кромка
  for (const dk of Object.values(V.DOCKS)) {
    const r = dk.rect, X = r.x * Q, Y = r.y * Q, w = r.w * Q, h = r.h * Q;
    R(X, Y, w, h, '#9ea3ab'); for (let k = 0; k < 120; k++) px(X + hash(k, 9) * w, Y + hash(9, k) * h, '#8e939b');
    R(X, Y, w, 2, '#c2c6cc'); hazard(X, Y + h - 6, w, 6);
    for (const bx2 of [X + 6, X + w - 14]) { R(bx2, Y + h - 12, 8, 6, OUT); R(bx2 + 1, Y + h - 11, 6, 4, DARK[3]); R(bx2 + 1, Y + h - 11, 6, 1, DARK[5]); }
  }
  // стены: кирпичная лицевая сторона с бетонным верхом, тень на пол
  for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) {
    const t = grid[I(tx, ty)]; if (t !== T_WALL) continue;
    const X = tx * Q, Y = ty * Q, dn = isW(tx, ty + 1), up = isW(tx, ty - 1), lf = isW(tx - 1, ty), rt = isW(tx + 1, ty);
    const capH = dn ? Q : 9;
    R(X, Y, Q, capH, '#8c6a5c'); R(X + 2, Y + 2, Q - 4, capH - 4, '#7a5a4e');
    for (let yy = Y + 3; yy < Y + capH - 3; yy += 4) for (let xx = X + 3 + ((yy >> 2) & 1) * 3; xx < X + Q - 4; xx += 6) R(xx, yy, 4, 2, '#86655a');
    if (!up) { R(X, Y, Q, 2, '#c49c86'); R(X, Y + 2, Q, 1, '#a88470'); }
    if (!lf) R(X, Y, 2, capH, '#b08c78'); if (!rt) R(X + Q - 2, Y, 2, capH, '#5e4238');
    if (!dn) { // кирпичная кладка
      R(X, Y + 9, Q, 1, '#4a2a22');
      for (let row = 0; row < 3; row++) {
        const yy = Y + 10 + row * 5, off = ((ty + row) & 1) * 6;
        R(X, yy, Q, 5, '#5a3328');
        for (let xx = -off; xx < Q; xx += 12) {
          const a = Math.max(0, xx), b = Math.min(Q, xx + 11); if (b <= a) continue;
          const v = hash(tx * 4 + Math.floor((xx + off) / 12), ty * 3 + row), c = v < 0.33 ? '#93503c' : v < 0.66 ? '#a25c45' : '#8a4a37';
          R(X + a, yy, b - a, 4, c); R(X + a, yy, b - a, 1, shade(c, 0.22)); R(X + a, yy + 3, b - a, 1, shade(c, -0.2));
        }
      }
      R(X, Y + 25 - 1, Q, 1, '#3a221c');
      g.fillStyle = 'rgba(20,10,20,0.26)'; g.fillRect(X, Y + Q, Q, 3); g.fillStyle = 'rgba(20,10,20,0.12)'; g.fillRect(X, Y + Q + 3, Q, 4);
    }
  }
  // двери-ворота: рама, свёрнутая штора, жёлто-чёрный порог
  for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) {
    if (grid[I(tx, ty)] !== T_DOOR) continue;
    const X = tx * Q, Y = ty * Q, horiz = isW(tx - 1, ty) || isW(tx + 1, ty) || (grid[I(Math.max(0, tx - 1), ty)] === T_DOOR) || (grid[I(Math.min(MW - 1, tx + 1), ty)] === T_DOOR);
    if (horiz) {
      if (isW(tx - 1, ty)) { R(X, Y, 3, Q, OUT); R(X + 1, Y, 1, Q, STEEL[3]); } if (isW(tx + 1, ty)) { R(X + Q - 3, Y, 3, Q, OUT); R(X + Q - 2, Y, 1, Q, STEEL[3]); }
      R(X, Y, Q, 6, OUT); R(X, Y + 1, Q, 4, STEEL[3]); R(X, Y + 1, Q, 1, STEEL[5]); R(X, Y + 4, Q, 1, STEEL[1]);
      hazard(X + 3, Y + Q - 4, Q - 6, 3);
    } else {
      R(X, Y, Q, 3, OUT); R(X, Y + Q - 3, Q, 3, OUT); R(X, Y + 1, Q, 1, STEEL[3]);
      R(X, Y, 6, Q, OUT); R(X + 1, Y, 4, Q, STEEL[3]); R(X + 1, Y, 1, Q, STEEL[5]);
      hazard(X + Q - 4, Y + 3, 3, Q - 6);
    }
  }
  for (const dc of V.DECOR) decor(dc);
  // жёлтая разметка пола вокруг станков
  for (const st of V.STATIONS) {
    if (st.kind === 'store') continue;
    const X = st.x * Q - 3, Y = st.y * Q - 3, w = st.w * Q + 6, h = st.h * Q + 6;
    for (let k = 0; k < w; k += 8) { R(X + k, Y, 5, 2, '#e8c23a'); R(X + k, Y + h - 2, 5, 2, '#e8c23a'); }
    for (let k = 0; k < h; k += 8) { R(X, Y + k, 2, 5, '#e8c23a'); R(X + w - 2, Y + k, 2, 5, '#e8c23a'); }
  }
  // стоянки погрузчиков
  for (const f of V.S.forks || []) {
    const X = f.home.x * Q - 12, Y = f.home.y * Q - 20; R(X, Y, 48, 2, '#f2c230'); R(X, Y + 48, 48, 2, '#f2c230'); R(X, Y, 2, 50, '#f2c230'); R(X + 46, Y, 2, 50, '#f2c230');
    const sp = textSprite('P' + f.id, '#f2c230', false); g.globalAlpha = 0.8; g.drawImage(sp, X + 4, Y + 4, sp.width * 2, sp.height * 2); g.globalAlpha = 1;
  }
  // стулья в бытовке
  for (const [sx, sy] of V.SEATS) { const X = sx * Q + 5, Y = sy * Q + 4; R(X + 2, Y + 14, 14, 4, SHADOW); box3(X, Y + 6, 14, 10, 3, WOOD); box3(X + 1, Y - 2, 12, 9, 6, WOOD); }
  g = keep;
}
// Мебель, склады и прочее оборудование (в статичный фон)
function decor(dc) {
  const X = dc.x * Q, Y = dc.y * Q, w = dc.w * Q, h = dc.h * Q;
  switch (dc.id) {
    case 'regal': { // паллетный стеллаж: синие стойки, оранжевые балки, коробки, рулоны, ящики
      shadowBlob(X + 4, Y + h - 10, w, 14); const top = Y - 20;
      R(X, top, w, Y + h - top, OUT); R(X + 1, top + 1, w - 2, 20, '#3a3f4a');
      for (let lv = 0; lv < 3; lv++) {
        const y0 = lv === 0 ? top + 1 : Y + 2 + (lv - 1) * 23, hh = lv === 0 ? 19 : 21;
        if (lv) R(X + 1, y0, w - 2, hh, '#2a2e36');
        for (let k = 0; k < w / 16 - 1; k++) {
          const v = hash(dc.x * 31 + k, lv * 7 + dc.y), bx2 = X + 4 + k * 16, by = y0 + hh - 2;
          if (v < 0.4) { box3(bx2, by - 12, 14, 12, 4, CARD); R(bx2 + 2, by - 9, 10, 1, CARD[2]); }
          else if (v < 0.65) { for (let q = 0; q < 2; q++) { discO(bx2 + 4 + q * 7, by - 5, 3, '#1d1d22'); disc(bx2 + 4 + q * 7, by - 5, 1, '#3a3a44'); } }
          else box3(bx2 + 1, by - 10, 12, 10, 4, ramp(['#3b7bd4', '#d84a4a', '#f2c230', '#5aa54a'][Math.floor(v * 40) % 4]));
        }
        if (lv) { R(X + 1, y0 + hh, w - 2, 3, ORG[3]); R(X + 1, y0 + hh, w - 2, 1, ORG[5]); R(X + 1, y0 + hh + 2, w - 2, 1, ORG[1]); }
      }
      for (let k = 0; k <= w; k += 48) { const x = X + Math.min(k, w - 4); R(x, top, 4, Y + h - top, OUT); R(x + 1, top + 1, 2, Y + h - top - 2, BLUE[3]); R(x + 1, top + 1, 1, Y + h - top - 2, BLUE[5]); for (let yy = top + 4; yy < Y + h; yy += 5) px(x + 2, yy, BLUE[1]); }
      break;
    }
    case 'kaffee': box3(X + 3, Y - 12, 18, 32, 6, DARK); R(X + 6, Y - 8, 12, 6, STEEL[4]); R(X + 7, Y - 7, 6, 3, '#62e08a'); R(X + 8, Y + 2, 8, 8, '#111'); R(X + 10, Y + 5, 4, 4, '#f4f4f4'); px(X + 16, Y - 6, '#ff4d4d'); R(X + 6, Y + 12, 12, 2, STEEL[3]); break;
    case 'tisch': R(X + 4, Y + 16, w - 4, 6, SHADOW); box3(X + 1, Y + 1, w - 2, h - 4, 5, WOOD); R(X + 3, Y + h - 4, 3, 4, WOOD[1]); R(X + w - 6, Y + h - 4, 3, 4, WOOD[1]);
      for (const cx of [X + 8, X + w - 14]) { R(cx, Y + 4, 6, 5, '#f2f2f2'); R(cx + 1, Y + 5, 4, 2, '#7a4a2a'); } R(X + w / 2 - 5, Y + 6, 10, 6, '#e8e8e0'); break;
    case 'desk': R(X + 4, Y + 16, w - 4, 6, SHADOW); box3(X + 1, Y + 2, w - 2, h - 4, 6, ramp('#5a5f7a')); box3(X + 6, Y - 10, 18, 14, 3, DARK); R(X + 8, Y - 8, 14, 8, '#2b6a8e'); R(X + 9, Y - 7, 6, 2, '#8fd0ff'); R(X + 26, Y + 6, 12, 4, DARK[4]); R(X + 30, Y + 2, 10, 6, '#f2f2ea'); break;
    case 'schrott': // контейнеры с ломом: открытый верх, рёбра, старые шины внутри
      for (let c = 0; c < dc.w; c += 4) {
        const x0 = X + c * Q + 2, ww = 4 * Q - 6; shadowBlob(x0 + 4, Y + h - 10, ww, 14);
        box3(x0, Y - 6, ww, h + 4, 16, RED); R(x0 + 4, Y - 2, ww - 8, h - 18, '#2a1716'); R(x0 + 4, Y - 2, ww - 8, 2, '#140b0b');
        for (let k = 0; k < 6; k++) { const v = hash(c * 13 + k, 77); g.drawImage(tireFlat(0), x0 + 4 + v * (ww - 30), Y - 4 + hash(k, c) * (h - 30)); }
        for (let k = x0 + 6; k < x0 + ww - 4; k += 8) R(k, Y + h - 20, 2, 14, RED[1]);
      }
      break;
    case 'rohgummi': // поддон с рулонами сырой резины
      shadowBlob(X + 2, Y + h - 12, w, 14); box3(X + 2, Y + h - 12, w - 4, 10, 4, WOOD);
      for (let k = 0; k < 4; k++) { const cx = X + 12 + (k % 2) * 24, cy = Y + 10 + (k >> 1) * 16; ellO(cx, cy + 4, 10, 6, '#1c1b20'); ellO(cx, cy, 10, 6, '#26252b'); ell(cx - 7, cy - 4, 14, 8, '#2f2e35'); ell(cx - 3, cy - 2, 6, 4, WOOD[3]); px(cx - 5, cy - 4, '#4a4952'); }
      break;
    case 'm1': case 'm2': {
      shadowBlob(X + 2, Y + h - 12, w, 14);
      if (dc.id === 'm2') { // зелёные баки и канистры Gummilösung на полке
        for (let k = 0; k < 2; k++) { box3(X + 2 + k * 22, Y - 6, 20, h + 2, 8, GRN); R(X + 4 + k * 22, Y - 4, 16, 2, GRN[1]); }
        box3(X + 48, Y + 2, w - 50, h - 4, 4, STEEL);
        for (let k = 0; k < 4; k++) { const cx = X + 51 + (k % 2) * 10, cy = Y + 4 + (k >> 1) * 18; box3(cx, cy, 9, 13, 3, BLUE); R(cx + 2, cy + 5, 5, 3, '#eef3f8'); }
      } else { box3(X + 2, Y - 4, 50, h + 2, 12, BLUE); R(X + 6, Y, 42, 10, '#1d2533'); for (let k = 0; k < 8; k++) R(X + 8 + hash(k, 1) * 36, Y + 2 + hash(1, k) * 6, 3, 1, STEEL[4]); box3(X + 56, Y + 2, w - 58, h - 4, 6, ramp('#3a7ad0')); }
      break;
    }
    case 'autoklav1': { // автоклав: горизонтальный цилиндр с крышкой-люком
      shadowBlob(X + 6, Y + h - 16, w - 4, 18);
      for (const lx of [X + 30, X + 90]) box3(lx, Y + 46, 10, 22, 4, STEEL);
      hcyl(X + 16, Y + 6, w - 20, 48, ['#14243e', '#1e3a62', '#2a5288', '#3a6ba6', '#5b8bc4', '#9cc0e8']);
      for (let k = X + 30; k < X + w - 8; k += 16) R(k, Y + 7, 2, 46, '#1e3a62');
      R(X + 40, Y + 1, 40, 6, OUT); R(X + 41, Y + 2, 38, 4, STEEL[3]);
      ellO(X + 16, Y + 30, 13, 24, STEEL[3]); ell(X + 6, Y + 10, 18, 40, STEEL[4]); for (let k = 0; k < 10; k++) { const a = k / 10 * TAU; px(X + 16 + Math.cos(a) * 10, Y + 30 + Math.sin(a) * 20, STEEL[1]); }
      discO(X + 16, Y + 30, 5, RED[3]); line(X + 12, Y + 30, X + 20, Y + 30, RED[1]); line(X + 16, Y + 26, X + 16, Y + 34, RED[1]);
      break;
    }
    case 'kpresse': shadowBlob(X + 2, Y + h - 12, w, 14); box3(X + 3, Y + 10, w - 6, h - 12, 8, PURP); ellO(X + w / 2, Y + 20, 13, 7, STEEL[3]); ell(X + w / 2 - 9, Y + 16, 18, 8, DARK[2]); box3(X + w / 2 - 4, Y - 8, 8, 18, 3, STEEL); break;
    case 'werkbank': { // верстак техника: перфощит с инструментом, тиски, детали
      R(X, Y - 16, w, 16, OUT); R(X + 1, Y - 15, w - 2, 14, '#8d8778'); for (let yy = Y - 13; yy < Y - 2; yy += 3) for (let xx = X + 3; xx < X + w - 2; xx += 3) px(xx, yy, '#6e6a5e');
      R(X + 6, Y - 13, 2, 9, STEEL[4]); R(X + 5, Y - 13, 4, 2, STEEL[4]); R(X + 14, Y - 12, 7, 2, RED[3]); R(X + 24, Y - 13, 2, 10, WOOD[3]); R(X + 32, Y - 12, 8, 3, '#e0a862'); R(X + 46, Y - 13, 3, 9, STEEL[4]); R(X + 56, Y - 11, 9, 2, BLUE[4]);
      box3(X, Y, w, h, 7, WOOD); box3(X + 4, Y + 2, 12, 9, 3, BLUE); R(X + 6, Y, 8, 2, STEEL[4]);
      for (let k = 0; k < 3; k++) discO(X + 34 + k * 7, Y + 7, 2, STEEL[3]);
      break;
    }
    case 'scanner': break; // рисуется каждый кадр
    default: box3(X, Y, w, h, 6, ramp(dc.color || '#6b5a4a'));
  }
}

// ---------- станки: статичная часть кэшируется в спрайт, движущееся рисуется каждый кадр ----------
const SMX = 12, SMY = 44, SMB = 14;
const PST = new Map(); let STGEN = 0;
const pst = s => { let p = PST.get(s.id); if (!p) { p = { lid: s.state === 'running' ? 0 : 1, c: 0, h: 26, a: 0, fan: 0, outN: 0, lab: -9 }; PST.set(s.id, p); } return p; };
function stationSprite(s, W, H) {
  const rb = !!s.robot; let e = STS.get(s); if (e && e.rb === rb && e.gen === STGEN) return e.c;
  const c = mk(W + SMX * 2, H + SMY + SMB);
  paint(c, () => (BASE[s.g] || baseGeneric)(SMX, SMY, W, H, s));
  STS.set(s, { rb, gen: STGEN, c }); return c;
}
function stackLightDraw(x, y, mode, bl) { // светофор-колонна: красный (поломка), жёлтый (готово), зелёный (работает)
  R(x, y + 11, 1, 8, DARK[3]); R(x - 2, y - 1, 5, 13, OUT);
  R(x - 1, y, 3, 3, mode === 'broken' && bl ? '#ff4a3a' : '#5a1a1a'); R(x - 1, y + 4, 3, 3, mode === 'done' && bl ? '#ffc23a' : '#5a4a1a'); R(x - 1, y + 8, 3, 3, mode === 'run' ? '#4aff7a' : '#1a4a2a');
  if (mode === 'run') px(x - 1, y + 8, '#d8ffe0'); if (mode === 'broken' && bl) px(x - 1, y, '#ffd0c0'); if (mode === 'done' && bl) px(x - 1, y + 4, '#fff0c0');
}
const SLM = { idle: 0, run: 1, done: 2, broken: 3 }, SLS = [];
function stackLight(x, y, mode) { // светофор-колонна из кэша (8 состояний)
  const bl = Math.floor(time * 3) & 1, k = (SLM[mode] || 0) * 2 + bl;
  const c = SLS[k] || (SLS[k] = paint(mk(5, 21), () => stackLightDraw(2, 1, mode, bl)));
  g.drawImage(c, x - 2, y - 1);
}
function boomS(x0, y0, x1, y1) { // стрела крана из кэша (по вектору)
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = x1 - x0, dy = y1 - y0, key = (dx + 64) * 256 + dy + 128; let c = BOOM.get(key);
  if (!c) { const ox = dx < 0 ? 3 - dx : 3, oy = dy < 0 ? 3 - dy : 3; c = paint(mk(Math.abs(dx) + 7, Math.abs(dy) + 7), () => beam(ox, oy, ox + dx, oy + dy, YEL, 3)); c.ox = ox; c.oy = oy; BOOM.set(key, c); }
  g.drawImage(c, x0 - c.ox, y0 - c.oy);
}
function screen(x, y, w, h, mode, seed) { // маленький экран: график/полосы
  R(x, y, w, h, '#06120e');
  if (mode === 0) return;
  const t = time * (mode === 2 ? 4 : 1.2) + seed;
  for (let i = 0; i < w - 2; i++) { const v = Math.round((Math.sin(t + i * 0.7) * 0.5 + 0.5) * (h - 3)); px(x + 1 + i, y + h - 2 - v, mode === 2 ? '#7dff9a' : '#4fd0ff'); }
}
function hubDisc(cx, cy, r, a) { discO(cx, cy, r, STEEL[3]); disc(cx - 1, cy - 1, r - 2, STEEL[4]); for (let k = 0; k < 6; k++) { const b = a + k * TAU / 6; px(cx + Math.cos(b) * (r - 2), cy + Math.sin(b) * (r - 2), STEEL[1]); } disc(cx, cy, 2, DARK[2]); }
function spinTire(cx, cy, r, kind, ang, hub) { const sp = tireSide(r, kind, Math.floor(ang / TAU * NF), hub); g.drawImage(sp, Math.round(cx - sp.width / 2), Math.round(cy - sp.height / 2)); }

// --- Пресс (Heizpresse): плита, нижняя полуформа, крышка открывается и откидывается назад, кран-укосина ---
const LIDN = 8, LIDS = [], MTS = [], CARS = new Map(), EVI = new Map(), STS = new WeakMap(), BOOM = new Map();
function pressLid(q) {
  return LIDS[q] || (LIDS[q] = paint(mk(48, 64), () => { // спрайт рисуется в (X, Y−30); шарнир — задняя кромка крышки
    const th = q / LIDN * 1.3, sn = Math.sin(th), cs = Math.cos(th), cx = 24, hy = 36, k = 0.47 * cs - sn, ry = Math.max(1, Math.round(Math.abs(k) * 19)), cy = Math.round(hy + k * 19);
    if (q > 0) for (const ax of [7, 41]) { line(ax, hy - 3, ax + (ax < 24 ? 3 : -3), cy, OUT, 3); line(ax, hy - 3, ax + (ax < 24 ? 3 : -3), cy, STEEL[4], 1); }
    if (k >= 0) {
      const thick = Math.max(1, Math.round(5 * cs));
      cylSide(cx, cy, 19, ry, thick, LIDP); ellO(cx, cy, 19, ry, LIDP[3]);
      if (ry >= 5) {
        ell(cx - 19, cy - ry, 38, ry * 2, LIDP[3]); ell(cx - 13, cy - ry * 0.7 - 2, 26, ry * 1.4, LIDP[4]); ell(cx - 9, cy - ry * 0.5 - 3, 16, ry, LIDP[5]);
        ell(cx - 4, cy - 5, 8, 4, LIDP[2]); px(cx - 2, cy - 5, LIDP[5]);
        for (const a of [0.6, 2.5, 3.8, 5.6]) { const bx = cx + Math.cos(a) * 17, by = cy + Math.sin(a) * (ry - 1); R(bx - 2, by - 1, 4, 3, OUT); R(bx - 1, by - 1, 2, 2, LIDP[1]); }
      }
    } else { // видна нижняя сторона крышки — верхняя полуформа с рисунком протектора
      ellO(cx, cy, 19, ry, LIDP[2]); ell(cx - 16, cy - ry + 2, 32, ry * 2 - 4, DARK[2]);
      for (let a = 0; a < TAU; a += TAU / 30) px(cx + Math.cos(a) * 13, cy + Math.sin(a) * (ry - 3), DARK[4]);
      ell(cx - 7, cy - ry * 0.3, 14, ry * 0.6, '#3a2420'); ell(cx - 19, cy - ry, 38, 2, LIDP[4]);
    }
  }));
}
function moldTire(kind) { // шина лежит в форме
  return MTS[kind] || (MTS[kind] = paint(mk(34, 18), () => {
    const P = TPH[KINDS[kind]];
    ell(1, 1, 32, 16, OUT); ell(2, 2, 30, 14, P.w[2]); ell(3, 2, 22, 8, P.w[3]); ell(10, 6, 14, 6, OUT); ell(11, 7, 12, 4, '#5a2a22');
    if (kind === 3) { for (let a = 0; a < TAU; a += TAU / 22) px(17 + Math.cos(a) * 13, 9 + Math.sin(a) * 6.2, P.gr); px(7, 4, P.hl); px(8, 4, P.hl); }
  }));
}
const seamGlow = () => cache('seam', () => paint(mk(42, 12), () => { for (let i = -19; i <= 19; i++) { const e = 9 * Math.sqrt(1 - (i / 19.5) ** 2); px(21 + i, Math.round(e) + 1, '#ff8a2a'); px(21 + i, Math.round(e) + 2, '#ff5a1a'); } }));
function basePresse(X, Y, W, H, s) {
  const left = s.x < 50, colX = left ? X + W - 4 : X + 3, pxl = left ? X + 33 : X + 2;
  shadowBlob(X - 2, Y + 28, W + 6, 22);
  box3(X + 1, Y + 23, W - 2, 23, 7, STEEL); hazard(X + 2, Y + 41, W - 4, 3);
  for (const hx of [X + 6, X + 40]) { R(hx - 1, Y + 2, 5, 20, OUT); R(hx, Y + 3, 3, 18, STEEL[3]); R(hx, Y + 3, 1, 18, STEEL[4]); R(hx + 2, Y + 3, 1, 18, STEEL[1]); }
  cylSide(X + 24, Y + 20, 19, 9, 9, STEEL);
  ellO(X + 24, Y + 20, 19, 9, STEEL[4]); ell(X + 6, Y + 12, 36, 15, STEEL[3]); ell(X + 9, Y + 13, 30, 13, DARK[2]);
  for (let a = 0; a < TAU; a += TAU / 28) px(X + 24 + Math.cos(a) * 13, Y + 19.5 + Math.sin(a) * 5.6, DARK[4]);
  ell(X + 18, Y + 17, 12, 6, '#4a221c'); ell(X + 19, Y + 17, 8, 3, '#6a3428');
  // паропровод с вентилем у дальнего угла
  const vx = left ? X + 1 : X + 43; R(vx, Y - 8, 5, 30, OUT); R(vx + 1, Y - 7, 3, 28, STEEL[3]); R(vx + 1, Y - 7, 1, 28, STEEL[5]); R(vx, Y - 9, 5, 3, STEEL[1]); discO(vx + 2, Y + 6, 3, RED[3]); px(vx + 1, Y + 5, RED[5]);
  // пульт с дисплеем
  box3(pxl, Y + 29, 13, 15, 5, BLUE); R(pxl + 2, Y + 31, 9, 7, OUT);
  // колонна крана-укосины
  R(colX - 2, Y - 17, 5, 27, OUT); R(colX - 1, Y - 16, 3, 25, YEL[3]); R(colX - 1, Y - 16, 1, 25, YEL[5]); R(colX + 1, Y - 16, 1, 25, YEL[1]); R(colX - 3, Y + 7, 7, 4, OUT); R(colX - 2, Y + 8, 5, 2, YEL[2]);
}
function dynPresse(s, X, Y, W, H) {
  const S = V.S, left = s.x < 50, run = s.state === 'running', p = pst(s), colX = left ? X + W - 4 : X + 3, pxl = left ? X + 33 : X + 2;
  const cw = CRANE.get(s.id), sw = s.worker ? WBYID.get(s.worker) : null;
  let tgt = run ? 0 : 1; if (!run && sw && sw.job && sw.job.type === 'start' && sw.state === 'work') tgt = clamp(1 - (s.prog || 0) * 1.15, 0, 1);
  p.lid += clamp(tgt - p.lid, -dt * 1.4, dt * 1.4); const lq = Math.round(p.lid * LIDN);
  let cp = 0, mode = null, hookK = -1, moldK = -1;
  if (cw) { const stp = cw.job.steps[cw.job.i]; cp = stp && stp.t ? clamp(stp.t / 1.5, 0, 1) : 0; mode = cw.job.crane; }
  const tid = s.items[0], t = tid !== undefined ? S.tires.get(tid) : null;
  if (t) moldK = kindOf(t);
  if (mode === 'pick' && t && cp > 0.35) { hookK = moldK; moldK = -1; }
  if (mode === 'drop' && cw.carry) { const ck = tireK(cw.carry); if (cp < 0.8) hookK = ck; else moldK = ck; }
  if (moldK >= 0 && lq > 0) g.drawImage(moldTire(moldK), X + 7, Y + 11);
  g.drawImage(pressLid(lq), X, Y - 30);
  if (run && !s.broken) { g.globalAlpha = 0.55 + 0.35 * Math.sin(time * 3 + s.y); g.drawImage(seamGlow(), X + 3, Y + 19); g.globalAlpha = 1; if (vis(X, Y - 20, W, 30)) { const n = rate(s, 0, 2.2); for (let k = 0; k < n; k++) steam(left ? X + 3 : X + 45, Y - 10, 0.45); } }
  // табло и светофор
  const disp = s.broken ? 'ERR' : run ? String(Math.ceil(s.timer)) : s.state === 'done' ? 'OK' : '--';
  if (disp === 'ERR') { if (Math.floor(time * 3) & 1) R(pxl + 3, Y + 32, 7, 5, '#ff3a2a'); } else lcd(disp, pxl + 2 + (disp.length < 2 ? 2 : 0), Y + 32, run ? '#ffb347' : s.state === 'done' ? '#62e08a' : '#3a5a4a');
  stackLight(left ? pxl + 11 : pxl + 1, Y + 14, s.broken ? 'broken' : run ? 'run' : s.state === 'done' ? 'done' : 'idle');
  // кран: стрела поворачивается к форме, крюк опускается
  let tc = 0, th = 18;
  if (mode === 'pick') { if (cp < 0.35) { tc = 1; th = 3; } else if (cp < 0.7) { tc = 1; th = 17; } else { tc = 0.25; th = 17; } }
  else if (mode === 'drop') { if (cp < 0.4) { tc = 1; th = 17; } else if (cp < 0.8) { tc = 1; th = 3; } else { tc = 0.6; th = 16; } }
  if (p.h > 18) p.h = 18;
  p.c += clamp(tc - p.c, -dt * 1.6, dt * 1.6); p.h += clamp(th - p.h, -dt * 40, dt * 40);
  const top = Y - 17, fx = lerp(colX + (left ? -12 : 12), X + 24, p.c), fy = lerp(Y + 6, Y + 20, p.c), ex = Math.round(fx), ey = Math.round(fy - 24);
  boomS(colX, top + 1, ex, ey); R(colX - 2, top - 2, 5, 4, OUT); R(colX - 1, top - 1, 3, 2, YEL[4]);
  R(ex - 3, ey - 1, 7, 4, OUT); R(ex - 2, ey, 5, 2, DARK[4]);
  const hy = Math.round(fy - p.h); R(ex, ey + 3, 1, Math.max(0, hy - ey - 3), DARK[1]);
  if (hookK >= 0) spinTire(ex, hy + 9, 9, hookK, 0, false);
  R(ex - 2, hy, 5, 2, STEEL[4]); R(ex - 2, hy + 2, 1, 3, STEEL[4]); R(ex + 2, hy + 2, 1, 2, STEEL[4]); px(ex - 1, hy + 4, STEEL[4]);
}

// --- Rauen: станина, шина на ступице вращается, каретка с рашпилем подходит к протектору, вытяжка ---
function baseRauen(X, Y, W, H) {
  shadowBlob(X, Y + 30, W + 4, 18);
  box3(X + 1, Y + 24, W - 2, 22, 8, BLUE); R(X + 2, Y + 39, W - 4, 2, YEL[3]); R(X + 2, Y + 39, W - 4, 1, YEL[5]);
  box3(X + 3, Y + 2, 18, 30, 10, BLUE); for (let k = 0; k < 4; k++) R(X + 6, Y + 5 + k * 3, 12, 1, BLUE[2]);
  for (const yy of [Y + 27, Y + 33]) { R(X + 38, yy, 32, 3, OUT); R(X + 39, yy + 1, 30, 1, STEEL[4]); }
  box3(X + 59, Y + 2, 12, 24, 6, STEEL); for (let k = 0; k < 5; k++) R(X + 61, Y + 5 + k * 3, 8, 1, STEEL[2]);
  R(X + 46, Y - 18, 10, 28, OUT); R(X + 47, Y - 17, 8, 26, STEEL[3]); R(X + 47, Y - 17, 2, 26, STEEL[5]); R(X + 53, Y - 17, 2, 26, STEEL[2]);
  R(X + 46, Y - 24, 20, 8, OUT); R(X + 47, Y - 23, 18, 6, STEEL[3]); R(X + 47, Y - 23, 18, 2, STEEL[5]); R(X + 47, Y - 19, 18, 1, STEEL[2]); // колено вытяжки уходит назад к потолку
  for (const yy of [Y - 6, Y + 2]) { R(X + 46, yy, 10, 2, STEEL[1]); R(X + 46, yy - 1, 10, 1, STEEL[4]); }
  box3(X + 59, Y + 28, 12, 16, 5, DARK); R(X + 61, Y + 30, 8, 5, OUT);
}
function dynRauen(s, X, Y) {
  const S = V.S, work = !!s.cur && !s.broken, p = pst(s), tid = s.cur || s.input[0];
  if (work) p.a += dt * 2.4 * TAU * 0.35;
  if (tid !== undefined) spinTire(X + 22, Y + 18, rT(tid, 16), s.cur && s.prog > 0.5 ? 1 : tireK(tid), p.a, true);
  else hubDisc(X + 22, Y + 18, 8, 0);
  const cx = X + (work ? 39 + Math.round(Math.sin(time * 1.4) * 1.5) : 45);
  boxS(cx, Y + 14, 16, 18, 6, YEL); R(cx + 3, Y + 17, 10, 2, YEL[2]);
  discO(cx, Y + 18, 5, STEEL[3]); for (let k = 0; k < 6; k++) { const b = p.a * 2.5 + k * TAU / 6; px(cx + Math.cos(b) * 4, Y + 18 + Math.sin(b) * 4, STEEL[5]); } disc(cx, Y + 18, 1, DARK[1]);
  R(cx - 3, Y + 9, 12, 5, OUT); R(cx - 2, Y + 10, 10, 3, YEL[4]);
  screen(X + 61, Y + 30, 8, 5, work ? 1 : 0, s.y);
  px(X + 61, Y + 37, work ? (Math.floor(time * 4) & 1 ? '#5ad65a' : '#2f8a2f') : '#2a3a2e');
  if (work && vis(X, Y, 72, 48)) { const n = rate(s, 0, 45); if (n) crumbs(X + 38, Y + 20, 1, n); if (rate(s, 1, 5)) emit(2, X + 40, Y + 18, 10 + rnd() * 10, -14 - rnd() * 10, 0.9, 0, 0.5, 0, 1, 4, '#7a6a58', 0.35); }
}
// --- Ausschleifen: расширитель держит шину, верстак, катушка шланга сжатого воздуха ---
function baseAusschl(X, Y, W, H) {
  const big = H > Q, ty = big ? Y + 16 : Y + 2, by = big ? Y + 28 : Y + 10;
  shadowBlob(X, by + 4, W + 4, big ? 18 : 12);
  box3(X + 5, by, 32, big ? 18 : 13, 5, YEL);
  for (const px0 of [X + 7, X + 31]) { R(px0, ty - 12, 4, by - ty + 14, OUT); R(px0 + 1, ty - 11, 2, by - ty + 12, YEL[3]); R(px0 + 1, ty - 11, 1, by - ty + 12, YEL[5]); }
  box3(X + 41, big ? Y + 16 : Y + 2, 30, big ? 30 : 21, 8, STEEL); R(X + 44, (big ? Y + 18 : Y + 4), 8, 3, RED[3]); R(X + 55, (big ? Y + 18 : Y + 4), 2, 7, WOOD[3]); R(X + 60, (big ? Y + 19 : Y + 5), 7, 2, BLUE[4]);
  const rx = X + 58, ry = big ? Y + 4 : Y - 6; R(rx - 1, ry, 3, (big ? Y + 18 : Y + 4) - ry, OUT); R(rx, ry, 1, (big ? Y + 18 : Y + 4) - ry, STEEL[3]); discO(rx, ry, 7, RED[3]); disc(rx - 1, ry - 1, 4, RED[4]); disc(rx, ry, 2, DARK[2]); for (let k = 0; k < 3; k++) px(rx - 5 + k * 5, ry + 7, DARK[2]);
}
function dynAusschl(s, X, Y, W, H) {
  const big = H > Q, work = !!s.cur && !s.broken, p = pst(s), tid = s.cur || s.input[0];
  if (work) p.a += dt * 0.9;
  if (tid !== undefined) spinTire(X + 21, big ? Y + 16 : Y + 1, rT(tid, big ? 14 : 11), tireK(tid), p.a, false);
  for (const px0 of [X + 9, X + 32]) { R(px0 - 1, (big ? Y + 10 : Y - 4), 4, 4, OUT); R(px0, (big ? Y + 11 : Y - 3), 2, 2, YEL[4]); }
  if (work) { g.fillStyle = 'rgba(255,240,170,0.18)'; g.fillRect(X + 12, big ? Y + 6 : Y - 6, 18, big ? 20 : 14); }
}
// --- Pflaster: салазки на рельсах, подъёмный расширитель держит шину, пневмопресс прижимает пластырь ---
function basePflaster(X, Y, W, H) {
  shadowBlob(X - 2, Y + 32, W + 6, 16);
  for (const yy of [Y + 38, Y + 44]) { R(X + 1, yy, W - 2, 3, OUT); R(X + 2, yy, W - 4, 1, STEEL[5]); R(X + 2, yy + 1, W - 4, 1, STEEL[3]); }
  for (let k = X + 4; k < X + W - 2; k += 8) R(k, Y + 37, 3, 11, WOOD[1]);
  for (const gx of [X + 1, X + W - 6]) { R(gx, Y - 24, 5, 62, OUT); R(gx + 1, Y - 23, 3, 60, BLUE[3]); R(gx + 1, Y - 23, 1, 60, BLUE[5]); }
  box3(X, Y - 30, W, 10, 4, BLUE); box3(X + 18, Y - 22, 12, 12, 3, STEEL);
  discO(X + 40, Y + 26, 4, '#f4f4f0'); px(X + 40, Y + 24, OUT); px(X + 41, Y + 25, RED[3]);
}
function dynPflaster(s, X, Y) {
  const work = !!s.cur && !s.broken, p = pst(s), tid = s.cur || s.input[0];
  const sx = X + 4 + (work ? Math.round((Math.sin(time * 0.9) + 1) * 2) : 0);
  boxS(sx, Y + 30, 30, 11, 5, YEL);
  for (const ax of [sx + 2, sx + 25]) { R(ax, Y + 2, 4, 30, OUT); R(ax + 1, Y + 3, 2, 28, YEL[3]); R(ax + 1, Y + 3, 1, 28, YEL[5]); }
  if (tid !== undefined) spinTire(sx + 15, Y + 16, rT(tid, 14), tireK(tid), 0, false);
  const ph = (time * 0.8) % 1, ext = work ? (ph < 0.3 ? ph / 0.3 : ph < 0.7 ? 1 : 1 - (ph - 0.7) / 0.3) : 0, ry = Math.round(Y - 10 + ext * 14);
  R(X + 22, Y - 10, 4, ry - Y + 10, OUT); R(X + 23, Y - 10, 2, ry - Y + 10, STEEL[5]);
  R(X + 18, ry, 12, 4, OUT); R(X + 19, ry + 1, 10, 2, RED[3]); R(X + 19, ry + 1, 10, 1, RED[5]);
  if (work && ph > 0.7 && ph < 0.73 && vis(X, Y, 48, 48)) for (let k = 0; k < 5; k++) emit(2, X + 24 + (rnd() - 0.5) * 8, Y - 8, (rnd() - 0.5) * 30, -10 - rnd() * 10, 0.5, 0, 2, 0, 1, 3, '#ffffff', 0.6);
}
// --- Gummilösung: кабина напыления — задняя стенка с фильтрами и вытяжным вентилятором, решётка, поворотный стол ---
function baseSpray(X, Y, W, H) {
  shadowBlob(X - 2, Y + 30, W + 6, 20);
  box3(X + 1, Y - 22, W - 2, 38, 4, ['#1a2a30', '#2a3e46', '#3a5560', '#4f6e7a', '#6e909c', '#a8c4cc']);
  for (let yy = Y - 18; yy < Y + 8; yy += 4) for (let xx = X + 6; xx < X + 48; xx += 4) R(xx, yy, 3, 2, '#1c2a30');
  discO(X + 59, Y - 6, 8, DARK[2]); disc(X + 59, Y - 6, 7, '#101418');
  R(X + 52, Y + 4, 13, 2, OUT);
  // знак «легковоспламеняемо»
  for (let k = 0; k < 7; k++) R(X + 56 - k, Y - 20 + k * 1.4, 1 + k * 2, 2, k === 0 ? OUT : YEL[3]); px(X + 56, Y - 15, RED[3]); px(X + 56, Y - 14, RED[3]); px(X + 55, Y - 13, RED[3]);
  R(X + 4, Y + 16, W - 8, 28, '#14181c'); for (let yy = Y + 17; yy < Y + 44; yy += 3) R(X + 4, yy, W - 8, 1, '#2a3036'); for (let xx = X + 5; xx < X + W - 4; xx += 4) R(xx, Y + 16, 1, 28, '#232a30');
  for (const wx of [X + 1, X + W - 5]) { R(wx, Y - 18, 4, 64, OUT); R(wx + 1, Y - 17, 2, 62, '#c8d8e0'); R(wx + 1, Y - 17, 1, 62, '#f0f8ff'); }
  ellO(X + 30, Y + 38, 13, 4, STEEL[3]); ell(X + 18, Y + 34, 24, 6, STEEL[4]);
  box3(X + 54, Y + 22, 11, 18, 4, BLUE); R(X + 56, Y + 26, 7, 4, '#eef3f8'); R(X + 57, Y + 20, 4, 2, OUT);
}
function dynSpray(s, X, Y, W, H) {
  const S = V.S, work = !!s.cur && !s.broken, p = pst(s), tid = s.cur || s.input[0];
  p.fan += dt * (work ? 14 : 3); if (work) p.a += dt * 1.2;
  for (let k = 0; k < 4; k++) { const b = p.fan + k * TAU / 4; line(X + 59, Y - 6, X + 59 + Math.cos(b) * 6, Y - 6 + Math.sin(b) * 6, STEEL[4]); } disc(X + 59, Y - 6, 1.5, STEEL[2]);
  R(X + 29, Y + 22, 3, 16, OUT); R(X + 30, Y + 22, 1, 16, STEEL[4]);
  if (tid !== undefined) spinTire(X + 30, Y + 20, rT(tid, 13), tireK(tid), p.a, false);
  if (work) { g.fillStyle = 'rgba(205,232,255,0.16)'; g.fillRect(X + 5, Y - 14, W - 10, 56); }
  const cn = s.canister !== undefined ? clamp(s.canister / 20, 0, 1) : 1; R(X + 56, Y + 31, 7, 3, OUT); R(X + 57, Y + 32, Math.round(5 * cn), 1, cn < 0.25 ? '#ff5050' : '#5ad65a');
  s.out.forEach((id, k) => { const t = S.tires.get(id), x = X + 44 + k * 10, y = Y + 40; g.drawImage(tireFlat(kindOf(t)), x - 12, y - 18); if (t && t.readyAt > S.t) for (let q = 0; q < 3; q++) { const ph = (time * 0.9 + q / 3 + k * 0.3) % 1; px(x - 3 + q * 3 + Math.round(Math.sin(ph * 6 + q) * 1.5), y - 18 - ph * 10, rgba('#bfe8ff', 0.8 - ph * 0.8)); } });
}
// --- Spachteln: стол с шиной, нагреватель экструдера с табло температуры, балансир со шлангом ---
function baseFuellen(X, Y, W, H) {
  shadowBlob(X - 2, Y + 30, W + 6, 18);
  box3(X + 3, Y + 28, 30, 18, 6, BLUE); for (const rx of [X + 10, X + 26]) { discO(rx, Y + 30, 3, STEEL[3]); px(rx - 1, Y + 29, STEEL[5]); }
  box3(X + 34, Y + 2, 13, 34, 6, STEEL); R(X + 36, Y + 5, 9, 7, OUT); grille(X + 36, Y + 16, 9, 10, STEEL[1], 2);
  R(X + 18, Y - 34, 1, 12, DARK[2]); box3(X + 14, Y - 24, 9, 9, 3, YEL); R(X + 18, Y - 15, 1, 10, DARK[1]);
}
function dynFuellen(s, X, Y) {
  const work = !!s.cur && !s.broken, p = pst(s), tid = s.cur || s.input[0];
  if (work) p.a += dt * 0.7;
  if (tid !== undefined) spinTire(X + 18, Y + 15, rT(tid, 14), tireK(tid), p.a, false);
  lcd(work ? '138' : '120', X + 37, Y + 6, work ? '#ffb347' : '#5a7a6a');
  px(X + 44, Y + 13, work && (Math.floor(time * 3) & 1) ? '#ff7a2a' : '#5a2a1a');
}
// --- Aufbau: пульт с экраном, экструдер (бункер, ствол с нагревом, сопло), шина на ступице, лента, робот ABC ---
function baseAufbau(X, Y, W, H, s) {
  shadowBlob(X - 2, Y + 50, W + 6, 24);
  if (s.robot) { for (let k = 0; k < W; k += 6) { R(X + k, Y + H + 2, 3, 2, YEL[3]); R(X + k + 3, Y + H + 2, 3, 2, '#1d1b22'); } for (const fx of [X, X + W - 3]) { R(fx, Y + H - 14, 3, 18, OUT); R(fx + 1, Y + H - 13, 1, 16, YEL[3]); } }
  box3(X + 1, Y + 42, W - 2, 28, 9, BLUE); R(X + 2, Y + 62, W - 4, 2, YEL[3]); R(X + 2, Y + 62, W - 4, 1, YEL[5]);
  box3(X + 3, Y - 2, 22, 54, 10, ['#1e2a3a', '#2e3e52', '#40556e', '#56708c', '#7a96b2', '#b4cae0']);
  R(X + 6, Y + 3, 16, 12, OUT); R(X + 6, Y + 19, 3, 3, '#4ad66a'); R(X + 10, Y + 19, 3, 3, '#e04040'); discO(X + 18, Y + 21, 2, RED[3]); R(X + 15, Y + 25, 7, 1, YEL[3]);
  grille(X + 6, Y + 30, 16, 8, '#2a3a4c', 2);
  R(X + 30, Y - 10, 1, 24, DARK[1]); discO(X + 30, Y - 12, 3, STEEL[3]);
  box3(X + 26, Y + 18, 9, 22, 4, BLUE);
  R(X + 37, Y + 10, 12, 2, OUT); for (let j = 0; j < 12; j++) { const w2 = 12 - Math.round(j * 0.4); R(X + 37 + (12 - w2) / 2, Y + 12 + j, w2, 1, j === 0 ? STEEL[5] : STEEL[3 - (j > 7 ? 1 : 0)]); px(X + 37 + (12 - w2) / 2, Y + 12 + j, OUT); px(X + 37 + (12 - w2) / 2 + w2 - 1, Y + 12 + j, OUT); }
  hcyl(X + 34, Y + 24, 18, 11, STEEL);
  R(X + 51, Y + 26, 4, 7, OUT); R(X + 52, Y + 27, 2, 5, DARK[3]);
  box3(X + 64, Y + 28, 28, 30, 9, BLUE); discO(X + 73, Y + 24, 6, STEEL[2]);
}
function dynAufbau(s, X, Y, W, H) {
  const S = V.S, work = !!s.cur && !s.broken, p = pst(s), tid = s.cur || s.input[0];
  if (work) p.a += dt * 1.6;
  for (let k = 0; k < 3; k++) { const hx = X + 37 + k * 5; R(hx, Y + 25, 2, 9, work ? (Math.sin(time * 4 + k) > 0 ? '#ff7a2a' : '#d84a14') : '#5a3a2a'); }
  const off = Math.floor(time * (work ? 18 : 0)) % 4; for (let k = off; k < 22; k += 4) px(X + 30, Y - 8 + k, DARK[4]);
  R(X + 6, Y + 3, 16, 12, '#071018'); if (work || s.robot) { for (let i = 0; i < 6; i++) R(X + 7 + i * 2 + Math.floor(i / 3), Y + 13 - Math.round((Math.sin(time * 3 + i) * 0.5 + 0.5) * 7), 1, 8, i % 2 ? '#4fd0ff' : '#62e08a'); } else lcd('--', X + 9, Y + 6, '#2a5a4a');
  stackLight(X + 24, Y - 14, s.broken ? 'broken' : work ? 'run' : s.out.length >= s.outCap ? 'done' : 'idle');
  if (tid !== undefined) {
    const kd = s.cur ? (s.prog > 0.45 ? 2 : 1) : tireK(tid);
    spinTire(X + 73, Y + 23, rT(tid, 21), kd, p.a, true);
    if (work) { R(X + 53, Y + 29, 3, 2, '#1b1a1f'); for (let k = 0; k < 4; k++) px(X + 53 + ((Math.floor(time * 20) + k) % 3), Y + 29, '#3a3940'); }
  } else hubDisc(X + 73, Y + 23, 9, 0);
  if (s.robot) { // робот ABC: синее основание, жёлтые звенья, захват
    const bx = X + 88, by = Y + 66, sp = work ? 1 : 0.35, a1 = -1.9 + Math.sin(time * 0.9 * sp + 1) * 0.45, a2 = 1.1 + Math.sin(time * 1.3 * sp) * 0.5;
    ellO(bx, by, 7, 3, BLUE[3]); boxS(bx - 4, by - 9, 9, 9, 3, BLUE);
    const sx = bx, sy = by - 9, ex = sx + Math.cos(a1) * 15, ey = sy + Math.sin(a1) * 15, wx = ex + Math.cos(a1 + a2) * 13, wy = ey + Math.sin(a1 + a2) * 13;
    beam(sx, sy, ex, ey, YEL, 4); beam(ex, ey, wx, wy, YEL, 3); discO(sx, sy, 3, DARK[3]); discO(ex, ey, 2, DARK[3]);
    R(wx - 3, wy - 2, 6, 5, OUT); R(wx - 2, wy - 1, 4, 3, STEEL[3]); px(wx - 2, wy - 1, STEEL[5]);
  }
  if (work && vis(X, Y, W, H) && rate(s, 0, 1.5)) steam(X + 44, Y + 22, 0.25);
}
// --- Entgraten: шина на роликах вращается, нож срезает облой, ящик для облоя ---
function baseEntgr(X, Y, W, H) {
  shadowBlob(X - 2, Y + 30, W + 6, 18);
  box3(X + 2, Y + 26, W - 4, 20, 7, BLUE); R(X + 3, Y + 40, W - 6, 2, YEL[3]);
  R(X + 39, Y - 4, 6, 32, OUT); R(X + 40, Y - 3, 4, 30, YEL[3]); R(X + 40, Y - 3, 1, 30, YEL[5]); R(X + 43, Y - 3, 1, 30, YEL[1]);
  box3(X + 3, Y + 32, 14, 13, 4, STEEL); for (let k = 0; k < 9; k++) px(X + 5 + hash(k, 3) * 10, Y + 34 + hash(3, k) * 4, '#111');
}
function dynEntgr(s, X, Y) {
  const work = !!s.cur && !s.broken, p = pst(s), tid = s.cur || s.input[0];
  if (work) p.a += dt * 3.2;
  for (const rx of [X + 13, X + 29]) { discO(rx, Y + 29, 3, STEEL[3]); px(rx + Math.round(Math.cos(p.a * 3) * 2), Y + 29 + Math.round(Math.sin(p.a * 3) * 2), STEEL[5]); }
  if (tid !== undefined) spinTire(X + 21, Y + 14, rT(tid, 14), tireK(tid), p.a, false);
  const kx = work ? X + 34 : X + 37; line(X + 40, Y + 6, kx, Y + 12, OUT, 3); line(X + 40, Y + 6, kx, Y + 12, YEL[4], 1); R(kx - 2, Y + 11, 3, 3, '#e8ecf2'); if (work && (Math.floor(time * 8) & 1)) px(kx - 2, Y + 11, '#ffffff');
  if (work && vis(X, Y, 48, 48)) { const n = rate(s, 0, 22); for (let k = 0; k < n; k++) emit(1, kx - 2, Y + 12, -10 - rnd() * 40, -30 - rnd() * 40, 0.8, 300, 0.4, Y + 36 + rnd() * 6, 2, 1, '#141417', 1); }
}
// --- Endkontrolle: портал с датчиком, шина вращается, лазерная линия, монитор, принтер этикеток ---
function baseEndk(X, Y, W, H) {
  shadowBlob(X - 2, Y + 30, W + 6, 18);
  box3(X + 2, Y + 28, W - 4, 18, 7, BLUE);
  for (const px0 of [X + 5, X + 45]) { R(px0, Y - 14, 6, 44, OUT); R(px0 + 1, Y - 13, 4, 42, YEL[3]); R(px0 + 1, Y - 13, 1, 42, YEL[5]); R(px0 + 4, Y - 13, 1, 42, YEL[1]); }
  box3(X + 4, Y - 20, 48, 9, 3, YEL); box3(X + 23, Y - 12, 10, 7, 2, DARK); px(X + 27, Y - 7, '#ff3a3a');
  line(X + 50, Y - 4, X + 56, Y - 2, OUT, 3); box3(X + 54, Y - 6, 16, 15, 3, DARK);
  box3(X + 54, Y + 22, 15, 13, 4, STEEL); R(X + 57, Y + 25, 9, 1, OUT);
}
function dynEndk(s, X, Y) {
  const work = !!s.cur && !s.broken, p = pst(s), tid = s.cur || s.input[0];
  if (work) p.a += dt * 2.2;
  if (tid !== undefined) spinTire(X + 28, Y + 14, rT(tid, 15), tireK(tid), p.a, false);
  screen(X + 56, Y - 4, 12, 9, work ? 2 : 0, s.x);
  if (work) { const dy = Math.round(Math.sin(time * 2.6) * 12), hw = Math.round(Math.sqrt(Math.max(0, 225 - dy * dy))); R(X + 28 - hw, Y + 14 + dy, hw * 2, 1, '#7dff9a'); g.fillStyle = 'rgba(125,255,154,0.25)'; g.fillRect(X + 28 - hw, Y + 13 + dy, hw * 2, 3); line(X + 28, Y - 6, X + 28 - hw, Y + 14 + dy, 'rgba(125,255,154,0.18)'); line(X + 28, Y - 6, X + 28 + hw, Y + 14 + dy, 'rgba(125,255,154,0.18)'); }
  if (s.out.length) { R(X + 58, Y + 25, 6, 5, '#f8f8f2'); R(X + 59, Y + 27, 4, 1, '#333'); }
  stackLight(X + 48, Y - 30, s.broken ? 'broken' : work ? 'run' : s.out.length ? 'done' : 'idle');
}
// --- Eingangsprüfung: расширитель бортов (жёлтые лапы), лампа, шина медленно вращается ---
function basePruef(X, Y, W, H) {
  shadowBlob(X - 2, Y + 30, W + 6, 18);
  box3(X + 3, Y + 28, W - 6, 18, 7, BLUE);
  for (const ax of [X + 6, X + 37]) { R(ax, Y - 4, 6, 34, OUT); R(ax + 1, Y - 3, 4, 32, YEL[3]); R(ax + 1, Y - 3, 1, 32, YEL[5]); R(ax + 1, Y + 8, 4, 6, STEEL[3]); }
  line(X + 44, Y + 4, X + 46, Y - 14, OUT, 3); line(X + 44, Y + 4, X + 46, Y - 14, STEEL[4], 1); R(X + 43, Y - 18, 7, 5, OUT); R(X + 44, Y - 17, 5, 3, YEL[4]);
}
function dynPruef(s, X, Y) {
  const work = !!s.cur && !s.broken, p = pst(s), tid = s.cur || s.input[0];
  if (work) p.a += dt * 0.8;
  if (tid !== undefined) { spinTire(X + 24, Y + 14, rT(tid, 14), tireK(tid), p.a, false); if (work) { g.fillStyle = 'rgba(255,236,150,0.35)'; g.fillRect(X + 20, Y + 10, 9, 9); } }
  for (const ax of [X + 11, X + 36]) { R(ax - 1, Y + 9, 4, 4, OUT); R(ax, Y + 10, 2, 2, YEL[4]); }
  if (work) { px(X + 46, Y - 16, '#ffffff'); g.fillStyle = 'rgba(255,240,160,0.2)'; g.fillRect(X + 36, Y - 14, 10, 18); }
}
// --- привод Hängebahn: мотор с рёбрами, звёздочка цепи ---
function baseAntrieb(X, Y) { shadowBlob(X, Y + 14, 28, 12); box3(X + 1, Y + 8, 22, 15, 5, BLUE); R(X + 2, Y + 1, 10, 9, OUT); for (let j = 0; j < 7; j++) R(X + 3, Y + 2 + j, 8, 1, STEEL[j < 2 ? 5 : j < 4 ? 4 : j < 6 ? 3 : 2]); for (let k = 0; k < 4; k++) px(X + 4 + k * 2, Y + 2, STEEL[1]); }
function dynAntrieb(m, X, Y) {
  const on = V.S.hook && !m.broken, p = pst(m); if (on) p.a += dt * 2.5;
  discO(X + 16, Y + 7, 6, DARK[3]); for (let k = 0; k < 10; k++) { const b = p.a + k * TAU / 10; px(X + 16 + Math.cos(b) * 6.5, Y + 7 + Math.sin(b) * 6.5, STEEL[4]); } disc(X + 16, Y + 7, 2, STEEL[4]);
  R(X + 15, Y - 8, 2, 9, DARK[1]); if (on) for (let k = (Math.floor(time * 10) % 3); k < 9; k += 3) px(X + 15, Y - 8 + k, STEEL[4]);
}
function baseGeneric(X, Y, W, H, s) { shadowBlob(X, Y + H - 14, W + 4, 16); box3(X + 1, Y + 1, W - 2, H - 2, Math.min(10, H >> 2), ramp(s.color || '#6b5a4a')); }
// --- склады: разметка, поддоны, тележки; шины — стопками ---
function baseStore(X, Y, W, H, s) {
  if (s.g === 'fertig') { for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) { const x = X + 4 + c * 47, y = Y + 26 + r * 56; box3(x, y, 42, 20, 4, WOOD); for (let k = 1; k < 4; k++) R(x + 1, y + k * 4, 40, 1, WOOD[2]); } }
  else if (s.g === 'nacharb') { for (let k = 0; k < W; k += 8) { R(X + k, Y, 4, 2, RED[3]); R(X + k + 4, Y, 4, 2, '#f0f0f0'); R(X + k, Y + H - 2, 4, 2, RED[3]); R(X + k + 4, Y + H - 2, 4, 2, '#f0f0f0'); } R(X, Y, 2, H, RED[3]); R(X + W - 2, Y, 2, H, RED[3]); }
  else if (s.g === 'aufh') { // площадка навески: рифлёный лист, жёлто-чёрная кромка, пульт подъёмника
    R(X + 2, Y + 2, W - 4, H - 4, OUT); R(X + 3, Y + 3, W - 6, H - 6, STEEL[2]);
    for (let j = 0; j < H - 8; j += 4) for (let i = ((j >> 2) & 1) * 2; i < W - 8; i += 4) { px(X + 4 + i, Y + 4 + j, STEEL[4]); px(X + 5 + i, Y + 5 + j, STEEL[1]); }
    hazard(X + 3, Y + 3, W - 6, 3); hazard(X + 3, Y + H - 6, W - 6, 3);
    box3(X + W - 12, Y + 8, 8, 12, 3, YEL); px(X + W - 9, Y + 11, '#ff4d4d'); px(X + W - 7, Y + 11, '#5ad65a');
  }
  else if (s.g === 'puffer') { for (let k = 0; k <= 4; k++) R(X + 2, Y + 2 + k * 23, W - 4, 2, '#e8c23a'); }
  else { const c = s.g === 'sort' ? '#e8c23a' : '#f4f4f4'; for (const [x, y, dx, dy] of [[X, Y, 1, 1], [X + W - 1, Y, -1, 1], [X, Y + H - 1, 1, -1], [X + W - 1, Y + H - 1, -1, -1]]) { R(Math.min(x, x + dx * 9), y - (dy < 0 ? 1 : 0), 10, 2, c); R(x - (dx < 0 ? 1 : 0), Math.min(y, y + dy * 9), 2, 10, c); } if (s.g === 'sort') for (let k = 1; k < 4; k++) for (let xx = X + 8; xx < X + W - 8; xx += 10) R(xx, Y + k * H / 4, 6, 1, 'rgba(232,194,58,0.6)'); }
}
function cartSprite() { return cache('cart', () => paint(mk(34, 14), () => { R(1, 3, 32, 6, OUT); R(2, 4, 30, 3, STEEL[4]); R(2, 4, 30, 1, STEEL[5]); R(2, 7, 30, 1, STEEL[2]); for (const wx of [5, 27]) { discO(wx, 10, 2, DARK[2]); px(wx, 10, STEEL[4]); } R(31, 0, 2, 5, STEEL[3]); })); }
function drawStore(s, X, Y, W, H) {
  const ids = s.items; if (!ids.length && s.g !== 'puffer') return;
  if (s.g === 'puffer') { for (let k = 0; k < 4; k++) { const y = Y + 6 + k * 23; g.drawImage(cartSprite(), X + 7, y + 6); stack(X + 22, y + 9, ids, k * 4, Math.min(4, ids.length - k * 4)); } return; }
  if (s.g === 'fertig' && W >= 190 && H >= 110) { // готовые шины — на поддонах, по две стопки на поддон
    const per = Math.max(5, Math.ceil(ids.length / 16));
    for (let k = 0; k * per < ids.length && k < 16; k++) { const pl = k >> 1, c = pl % 4, r = pl >> 2; stack(X + 4 + c * 47 + 11 + (k & 1) * 20, Y + 26 + r * 56 + 13, ids, k * per, per); }
    return;
  }
  const per0 = s.g === 'sort' ? 6 : s.g === 'fertig' ? 5 : s.g === 'aufh' ? 4 : 4, cols = Math.max(1, Math.floor((W - 4) / 22)), rows = Math.max(1, Math.floor((H - 22) / 14) + 1);
  const per = Math.max(per0, Math.ceil(ids.length / (cols * rows))), ns = Math.ceil(ids.length / per), x0 = X + Math.round((W - cols * 22) / 2) + 11;
  for (let si = 0; si < ns; si++) { const c = si % cols, r = Math.floor(si / cols); stack(x0 + c * 22, Y + 20 + r * 14, ids, si * per, per); }
}
const BASE = { presse: basePresse, rauen: baseRauen, ausschl: baseAusschl, pflaster: basePflaster, spray: baseSpray, fuellen: baseFuellen, aufbau: baseAufbau, entgr: baseEntgr, endk: baseEndk, pruef: basePruef, antrieb: baseAntrieb, eingang: baseStore, sort: baseStore, aufh: baseStore, puffer: baseStore, nacharb: baseStore, fertig: baseStore };
const DYN = { presse: dynPresse, rauen: dynRauen, ausschl: dynAusschl, pflaster: dynPflaster, spray: dynSpray, fuellen: dynFuellen, aufbau: dynAufbau, entgr: dynEntgr, endk: dynEndk, pruef: dynPruef, antrieb: dynAntrieb };
const IO = { // где лежат входные и готовые шины: [x, y] низа стопки от угла станка
  pruef: [[8, 50], [40, 50]], rauen: [[8, 50], [64, 50]], ausschl: [[8, 50], [64, 50]], pflaster: [[6, 50], [42, 50]], spray: [[8, 50], [44, 50]],
  fuellen: [[6, 50], [42, 50]], aufbau: [[30, 62], [62, 62]], entgr: [[6, 50], [42, 50]], endk: [[8, 50], [64, 50]],
};
const LABEL = { pflaster: 'PFLASTER', eingang: 'EINGANG', pruef: 'PRÜF', sort: 'KARKASSEN', aufh: 'AUFH', rauen: 'RAUEN', ausschl: 'SCHLEIF', spray: 'LÖSUNG', fuellen: 'SPACHTEL', aufbau: 'AUFBAU', puffer: 'WAGEN', presse: 'P', entgr: 'TRIM', nacharb: 'NACHARB', scan: 'SCAN', endk: 'KONTROLLE', fertig: 'FERTIG' };
const GCOUNT = new Map();
const SNAME = new Map();
function stationName(s) {
  let nm = SNAME.get(s); if (nm) return nm;
  let n = GCOUNT.get(s.g); if (n === undefined) { n = V.STATIONS.filter(o => o.g === s.g).length; GCOUNT.set(s.g, n); }
  nm = (LABEL[s.g] || s.g) + (n > 1 ? (s.g === 'presse' ? '' : ' ') + s.id.replace(/^\D+/, '') : ''); SNAME.set(s, nm); return nm;
}
const WARN = ['......#......', '.....#y#.....', '....#yyy#....', '....#yky#....', '...#yykyy#...', '...#yykyy#...', '..#yyykyyy#..', '..#yyyyyyy#..', '.#yyyykyyyy#.', '#############'];
const warnSprite = () => cache('warn', () => paint(mk(13, 10), () => WARN.forEach((r, j) => { for (let i = 0; i < 13; i++) if (r[i] !== '.') px(i, j, r[i] === 'y' ? '#ffd24a' : OUT); })));
function brokenFx(s, X, Y, W, H) {
  const b = s.broken; if (!b) return;
  g.fillStyle = 'rgba(40,12,16,0.32)'; g.fillRect(X + 1, Y - 4, W - 2, H + 2);
  if (vis(X, Y - 30, W, 40)) { if (rate(s, 2, 4)) smoke(X + W / 2, Y - 6); if (!b.tech && rate(s, 3, 0.8)) sparks(X + W / 2 + (rnd() - 0.5) * W * 0.5, Y + H * 0.3, rnd() < 0.5 ? -1 : 1, 6); }
  if ((Math.floor(time * 3) & 1) || b.tech) g.drawImage(warnSprite(), X + (W >> 1) - 6, Y + (H >> 1) - 14);
  if (b.tech) bar(X + 2, Y - 8, W - 4, Math.min(1, b.done / b.need), '#ff9f1a');
}
const BARC = new Map();
function bar(x, y, w, p, col) { let c = BARC.get(col); if (!c) { c = [shade(col, 0.45), shade(col, -0.3)]; BARC.set(col, c); } R(x - 1, y - 1, w + 2, 6, OUT); R(x, y, w, 4, '#2a2d36'); const fw = Math.round(w * clamp(p, 0, 1)); if (fw > 0) { R(x, y, fw, 4, col); R(x, y, fw, 1, c[0]); R(x, y + 3, fw, 1, c[1]); } }
function dust(s) {
  if (!(s.dirt > 0.04)) return;
  const n = Math.round(s.dirt * 26), seed = s.x * 31 + s.y * 7, X = s.ax * Q - Q * 0.6, Y = s.ay * Q + 2;
  for (let k = 0; k < n; k++) { const a = hash(k, seed), b = hash(seed, k * 3 + 1); R(X + a * Q * 2.2, Y + b * (Q - 5), a > 0.7 ? 2 : 1, 1, k % 3 ? '#6a6250' : '#4a4234'); }
}
function brackets(x, y, w, h) {
  const o = Math.round((Math.sin(time * 6) + 1) * 1.5), c = '#ffd23a'; x -= o; y -= o; w += o * 2; h += o * 2;
  for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w - 1, y, -1, 1], [x, y + h - 1, 1, -1], [x + w - 1, y + h - 1, -1, -1]]) {
    R(Math.min(cx, cx + dx * 7) - 1, cy - 1 - (dy < 0 ? 1 : 0), 10, 4, OUT); R(cx - 1 - (dx < 0 ? 1 : 0), Math.min(cy, cy + dy * 7) - 1, 4, 10, OUT);
    R(Math.min(cx, cx + dx * 7), cy - (dy < 0 ? 1 : 0), 8, 2, c); R(cx - (dx < 0 ? 1 : 0), Math.min(cy, cy + dy * 7), 2, 8, c);
  }
}
function drawStation(s) {
  const S = V.S, X = s.x * Q, Y = s.y * Q, W = s.w * Q, H = s.h * Q;
  if (!vis(X - SMX, Y - SMY, W + SMX * 2, H + SMY + SMB)) return;
  dust(s);
  g.drawImage(stationSprite(s, W, H), X - SMX, Y - SMY);
  if (s.kind === 'store') drawStore(s, X, Y, W, H);
  else {
    (DYN[s.g] || (() => 0))(s, X, Y, W, H);
    const io = IO[s.g];
    if (io && s.kind === 'proc') {
      const i0 = s.cur ? 0 : 1, ni = s.input.length - i0; // первая входная уже стоит на станке
      if (ni > 0) stack(X + io[0][0] + 6, Y + io[0][1], s.input, i0, Math.min(4, ni));
      if (s.g !== 'spray') {
        const outs = S.rollenbahn && s.g === 'aufbau' ? s.out.filter(id => { const t = S.tires.get(id); return !(t && t.rollT !== undefined); }) : s.out;
        if (outs.length) { stack(X + io[1][0] + 6, Y + io[1][1], outs, 0, Math.min(5, outs.length)); const t = S.tires.get(outs[0]); if (t && t.readyAt > S.t) R(X + io[1][0] + 3, Y + io[1][1] - 22, 6, 1, '#7fd6ff'); }
      }
    }
    if (S.t - s.lastScan < 0.6) { g.fillStyle = 'rgba(255,48,48,0.8)'; g.fillRect(X + W - 10, Y + H - 6, 8, 2); }
    if (!V.matsOk(s) && s.input.length && (Math.floor(time * 3) & 1)) g.drawImage(bang(), X + W - 10, Y - 4);
    if (s.kind === 'proc' && s.input.length >= s.inCap && !s.cur && (Math.floor(time * 3) & 1)) { g.strokeStyle = '#ff5050'; g.lineWidth = 2; g.strokeRect(X + 1, Y + 1, W - 2, H - 2); }
    brokenFx(s, X, Y, W, H);
  }
  label(objLabel(s, stationName(s), '#ffffff', true), X + 2, Y + 2, 0, true);
}
const bang = () => cache('bang', () => paint(mk(9, 12), () => { disc(4.5, 5.5, 4.5, OUT); disc(4.5, 5.5, 3.5, '#ff4a3a'); R(4, 2, 1, 5, '#ffffff'); R(4, 8, 1, 1, '#ffffff'); }));
function progress(s) {
  if (!(s.prog > 0 && (s.cur || s.kind === 'auto'))) return;
  const X = s.x * Q, Y = s.y * Q - 8, W = s.w * Q; if (!vis(X, Y, W, 6)) return;
  bar(X + 3, Y, W - 6, s.prog, '#4fd27a');
}

// --- Lade-Portal (апгрейд): портальный робот над прессами — мост ездит по рельсам к прессу, захват опускается ---
const PORT = { n: -1, list: [], x0: 0, x1: 0, y0: 0, y1: 0, bx: 0, by: 0, init: false };
function hbeam(x, y, w, P) { R(x, y - 2, w, 6, OUT); R(x, y - 1, w, 4, P[3]); R(x, y - 1, w, 1, P[5]); R(x, y + 2, w, 1, P[1]); }
function vbeam(x, y, h, P) { R(x - 2, y, 6, h, OUT); R(x - 1, y, 4, h, P[3]); R(x - 1, y, 1, h, P[5]); R(x + 2, y, 1, h, P[1]); }
function drawPortal() {
  const S = V.S; if (!S.upgrades || !S.upgrades.ladeportal) return;
  if (PORT.n !== V.STATIONS.length) {
    PORT.n = V.STATIONS.length; PORT.list = V.STATIONS.filter(o => o.g === 'presse');
    let a = 1e9, b = -1e9, c = 1e9, d = -1e9; for (const p of PORT.list) { a = Math.min(a, p.x); b = Math.max(b, p.x + p.w); c = Math.min(c, p.y); d = Math.max(d, p.y + p.h); }
    PORT.x0 = a * Q - 8; PORT.x1 = b * Q + 8; PORT.y0 = c * Q - 6; PORT.y1 = d * Q + 4;
  }
  if (!PORT.list.length) return;
  let tg = null; for (const p of PORT.list) if (!p.broken && p.state === 'done') { tg = p; break; }
  if (!tg) for (const p of PORT.list) if (!p.broken && p.state === 'idle' && p.items.length < p.cap) { tg = p; break; }
  const tx = tg ? (tg.x + tg.w / 2) * Q : (PORT.x0 + PORT.x1) / 2, ty = tg ? (tg.y + tg.h / 2) * Q : PORT.y0 + 10;
  if (!PORT.init) { PORT.init = true; PORT.bx = tx; PORT.by = ty; }
  PORT.by += clamp(ty - PORT.by, -dt * 90, dt * 90); PORT.bx += clamp(tx - PORT.bx, -dt * 70, dt * 70);
  const H = 30, { x0, x1, y0, y1 } = PORT; if (!vis(x0 - 6, y0 - H - 6, x1 - x0 + 12, y1 - y0 + H + 12)) return;
  for (const x of [x0, x1]) { g.fillStyle = SHADOW2; g.fillRect(x - 2, y0, 4, y1 - y0); vbeam(x, y0 - H, y1 - y0, YEL); }
  const by = Math.round(PORT.by), bx = Math.round(PORT.bx), near = Math.abs(PORT.by - ty) < 2 && Math.abs(PORT.bx - tx) < 2 && tg;
  g.fillStyle = SHADOW2; g.fillRect(x0, by, x1 - x0, 4);
  hbeam(x0 - 3, by - H, x1 - x0 + 6, YEL); boxS(x0 - 6, by - H - 5, 9, 9, 3, BLUE); boxS(x1 - 3, by - H - 5, 9, 9, 3, BLUE);
  const drop = near ? Math.round((Math.sin(time * 2.2) * 0.5 + 0.5) * 14) : 0;
  boxS(bx - 7, by - H - 6, 14, 10, 4, BLUE); R(bx - 1, by - H + 4, 3, 6 + drop, OUT); R(bx, by - H + 4, 1, 6 + drop, STEEL[4]);
  const gy = by - H + 10 + drop; R(bx - 8, gy, 17, 4, OUT); R(bx - 7, gy + 1, 15, 2, STEEL[3]); R(bx - 8, gy + 3, 3, 5, OUT); R(bx + 6, gy + 3, 3, 5, OUT); px(bx - 7, gy + 4, STEEL[4]); px(bx + 7, gy + 4, STEEL[4]);
  if (near && (Math.floor(time * 4) & 1)) px(bx + 4, by - H - 4, '#ff9f1a');
}

// ---------- подвесной конвейер: рельсы кэшируются, крюки качаются ----------
const RH = 9; // путь подвешен выше пола (рисуем выше осевой линии)
let railC = null, railX = 0, railY = 0, railKey = -1;
let SEGL = null, SEGO = null, SEGT = 0;
function segList() { if (SEGO !== V.SEGS || ++SEGT > 120) { SEGO = V.SEGS; SEGT = 0; SEGL = Object.values(V.SEGS); } return SEGL; } // список веток кэшируется (пересчёт раз в ~2 с — вдруг ветки поменялись)
function walkSeg(sg, fn, step = 1) { for (let i = 1; i < sg.pts.length; i++) { const a = sg.pts[i - 1], b = sg.pts[i], x0 = a.x * Q + 12, y0 = a.y * Q + 12, x1 = b.x * Q + 12, y1 = b.y * Q + 12, n = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / step)); for (let k = 0; k <= n; k++) fn(Math.round(x0 + (x1 - x0) * k / n), Math.round(y0 + (y1 - y0) * k / n), Math.abs(x1 - x0) >= Math.abs(y1 - y0)); } }
function buildRails() {
  const segs = segList(); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const sg of segs) for (const p of sg.pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  railX = Math.floor(x0 * Q) - 8; railY = Math.floor(y0 * Q) - 8 - RH; railC = mk((x1 - x0 + 1) * Q + 16, (y1 - y0 + 1) * Q + 16 + RH);
  paint(railC, () => {
    g.translate(-railX, -railY);
    for (const sg of segs) walkSeg(sg, (x, y) => { g.fillStyle = 'rgba(12,8,26,0.16)'; g.fillRect(x - 1, y, 3, 2); });
    for (const sg of segs) walkSeg(sg, (x, y) => { g.fillStyle = OUT; g.fillRect(x - (sg.ret ? 2 : 3), y - RH - (sg.ret ? 2 : 3), sg.ret ? 4 : 6, sg.ret ? 4 : 6); });
    for (const sg of segs) {
      const P = sg.ret ? ['#3a3e4a', '#4f5462', '#6b7080', '#8a90a0', '#a8aebc', '#c8ccd8'] : sg.siding ? ['#5a3e10', '#8a6418', '#b88a26', '#e0b860', '#f0d080', '#fff0b0'] : STEEL;
      walkSeg(sg, (x, y, hz) => { const t = sg.ret ? 1 : 2; g.fillStyle = P[3]; g.fillRect(x - t, y - RH - t, t * 2, t * 2); g.fillStyle = P[5]; if (hz) g.fillRect(x - t, y - RH - t, 1, 1); else g.fillRect(x - t, y - RH - t, 1, t * 2); g.fillStyle = P[1]; if (hz) g.fillRect(x - t, y - RH + t - 1, 1, 1); else g.fillRect(x + t - 1, y - RH - t, 1, t * 2); });
      walkSeg(sg, (x, y, hz) => { if (sg.ret) return; g.fillStyle = P[5]; if (hz) g.fillRect(x, y - RH - 2, 1, 1); else g.fillRect(x - 2, y - RH, 1, 1); g.fillStyle = P[1]; if (hz) g.fillRect(x, y - RH + 1, 1, 1); else g.fillRect(x + 1, y - RH, 1, 1); });
      walkSeg(sg, (x, y) => { g.fillStyle = DARK[2]; g.fillRect(x - 1, y - RH - 6, 3, 3); g.fillStyle = DARK[4]; g.fillRect(x - 1, y - RH - 6, 1, 1); }, 36);
    }
  });
}
const HSW = new WeakMap();
function hookSwing(h, x, y) { // маятник: подвеска отстаёт при разгоне и качается после остановки
  let s = HSW.get(h); if (!s) { s = { x, y, vx: 0, vy: 0, a: 0, av: 0, b: 0, bv: 0 }; HSW.set(h, s); return s; }
  if (dt <= 0) return s;
  if (Math.abs(x - s.x) > 40 || Math.abs(y - s.y) > 40) { s.x = x; s.y = y; s.vx = s.vy = 0; return s; }
  const d = Math.max(dt, 1 / 240), vx = clamp((x - s.x) / d, -600, 600), vy = clamp((y - s.y) / d, -600, 600);
  s.av -= (vx - s.vx) * 0.14; s.bv -= (vy - s.vy) * 0.1;             // толчок при смене скорости
  s.x = x; s.y = y; s.vx = vx; s.vy = vy;
  const st = Math.min(d, 1 / 30);
  s.av += (-55 * (s.a + vx * 0.006) - 2.6 * s.av) * st; s.a = clamp(s.a + s.av * st, -5, 5);
  s.bv += (-55 * s.b - 2.6 * s.bv) * st; s.b = clamp(s.b + s.bv * st, -4, 4);
  return s;
}

function segDirH(sg, s) { let i = 1; while (i < sg.cum.length - 1 && sg.cum[i] < s) i++; const a = sg.pts[i - 1], b = sg.pts[i]; return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y); }
function segP(sg, s) { s = Math.max(0, Math.min(sg.len, s)); let i = 1; while (i < sg.cum.length - 1 && sg.cum[i] < s) i++; const a = sg.pts[i - 1], b = sg.pts[i], t = (s - sg.cum[i - 1]) / ((sg.cum[i] - sg.cum[i - 1]) || 1); return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
function drawConveyor() {
  const S = V.S, segs = segList();
  let key = segs.length; for (let i = 0; i < segs.length; i++) key += segs[i].len * (i + 1) + segs[i].pts.length * 0.001; if (!railC || key !== railKey) { railKey = key; buildRails(); }
  if (vis(railX, railY, railC.width, railC.height)) g.drawImage(railC, railX, railY);
  const run = S.hook && !(V.HOOK_DRIVE && V.HOOK_DRIVE.broken);
  if (run) { // бегущие звенья цепи — направление движения
    g.fillStyle = '#ffd24a';
    for (const sg of segs) { if (sg.ret) continue; let acc = (time * 30) % 6; for (let i = 1; i < sg.pts.length; i++) { const a = sg.pts[i - 1], b = sg.pts[i], x0 = a.x * Q + 12, y0 = a.y * Q + 12 - RH, dx = (b.x - a.x) * Q, dy = (b.y - a.y) * Q, L = Math.hypot(dx, dy) || 1; let s2 = acc; for (; s2 < L; s2 += 6) g.fillRect(Math.round(x0 + dx * s2 / L), Math.round(y0 + dy * s2 / L), 1, 1); acc = s2 - L; } }
  }
  for (const st of V.STATIONS) if (st.stopSeg) { const p = segP(V.SEGS[st.stopSeg], st.stopS), x = Math.round(p.x * Q + 12), y = Math.round(p.y * Q + 12) - RH; R(x - 3, y - 5, 6, 3, OUT); R(x - 2, y - 4, 4, 1, ORG[4]); }
  const m = V.MODULE, n4 = V.NODES && V.NODES[4];
  if (m && n4) { const mx = Math.round(n4.x * Q + 12), my = Math.round(n4.y * Q + 12) - RH, dy = (m.seg === 'M2' ? 8 : -8) * Math.max(0, 1 - (S.t - m.t) / 2); boxS(mx - 6, my - 6 + Math.round(dy), 13, 11, 4, YEL); R(mx - 2, my - 3 + Math.round(dy), 4, 2, DARK[2]); }
  const showN = cam.z >= 1.8;
  if (showN) { for (const sg of segs) if (sg.n) { const p = segP(sg, sg.len * 0.5); label(objLabel(sg, sg.n, '#9fc6ff', false), Math.round(p.x * Q) + 14, Math.round(p.y * Q) - RH - 4, 0, true); } if (V.NODES) for (const [nm, p] of Object.entries(V.NODES)) label(objLabel(p, nm === '12' ? '12 Ф' : nm, '#9fc6ff', false), Math.round(p.x * Q) + 16, Math.round(p.y * Q) + 12, 0, true); }
  // крюки
  for (const h of V.HOOKS) {
    const sg = V.SEGS[h.seg]; if (!sg) continue;
    const p = V.hookPos(h), x = Math.round(p.x * Q + 12), y = Math.round(p.y * Q + 12) - RH;
    const sw = hookSwing(h, x, y); if (!vis(x - 14, y - 6, 28, 36)) continue;
    const hx = x + Math.round(sw.a), hy = y + 7 + Math.round(sw.b * 0.4);
    R(x - 3, y - 3, 7, 4, OUT); R(x - 2, y - 2, 5, 2, STEEL[4]); px(x - 2, y - 2, STEEL[5]);
    line(x, y + 1, hx, hy, DARK[3]);
    if (h.tire) {
      const kd = tireK(h.tire); g.fillStyle = 'rgba(12,8,26,0.16)'; g.fillRect(hx - 7, y + RH + 12, 14, 3);
      const hr = rT(h.tire, 9), spr = segDirH(sg, h.s) ? tireSide(hr, kd, 0, false) : tireTread(hr, kd, 0); g.drawImage(spr, hx - (spr.width >> 1), hy - 4);
    }
    R(hx - 2, hy, 1, 4, STEEL[5]); R(hx - 1, hy + 3, 3, 1, STEEL[4]); px(hx + 1, hy + 2, STEEL[4]); px(hx - 1, hy - 1, STEEL[4]);
  }
}

// ---------- погрузчик (Stapler), грузовики, машины рабочих ----------
function forkBody() {
  return cache('fork', () => paint(mk(66, 66), () => {
    g.translate(30, 60);
    R(-27, -20, 15, 17, OUT); R(-26, -19, 13, 15, DARK[3]); R(-26, -19, 13, 1, DARK[5]); R(-26, -19, 1, 15, DARK[4]); R(-26, -6, 13, 2, DARK[1]);
    box3(-14, -19, 25, 16, 6, YEL); R(-12, -17, 8, 3, YEL[5]);
    R(-13, -27, 9, 9, OUT); R(-12, -26, 7, 7, '#1d1d22'); R(-12, -26, 7, 1, '#3a3a44'); R(-14, -34, 4, 16, OUT); R(-13, -33, 2, 14, '#26262c');
    R(-16, -52, 3, 34, OUT); R(-15, -51, 1, 32, DARK[4]); R(7, -52, 3, 42, OUT); R(8, -51, 1, 40, DARK[4]);
    R(-18, -56, 29, 5, OUT); R(-17, -55, 27, 3, DARK[3]); R(-17, -55, 27, 1, DARK[5]); for (let k = -14; k < 8; k += 4) px(k, -54, DARK[1]);
    line(7, -12, 2, -24, OUT, 3); line(7, -12, 2, -24, DARK[4], 1); R(-1, -27, 7, 3, OUT); R(0, -26, 5, 1, DARK[4]);
    R(11, -58, 6, 57, OUT); R(12, -57, 2, 55, STEEL[4]); R(14, -57, 2, 55, STEEL[2]); R(12, -57, 1, 55, STEEL[5]); for (const yy of [-48, -28]) R(11, yy, 6, 2, STEEL[1]);
    px(16, -46, '#fff6c0'); px(16, -45, '#fff6c0');
  }));
}
const WHEEL = [];
function wheel(r, f) { const k = r * 8 + (f & 7); if (!WHEEL[k]) WHEEL[k] = paint(mk(r * 2 + 3, r * 2 + 3), () => { const c = r + 1.5; disc(c, c, r + 1, OUT); disc(c, c, r, '#1c1c22'); disc(c - 0.5, c - 0.5, r * 0.55, STEEL[3]); for (let q = 0; q < 3; q++) { const a = (f / 8 + q / 3) * TAU / 1; px(c - 0.5 + Math.cos(a) * r * 0.75, c - 0.5 + Math.sin(a) * r * 0.75, '#4a4a54'); } disc(c - 0.5, c - 0.5, 1, STEEL[5]); }); return WHEEL[k]; }
function forklift(X, Y, face, w, load, roll, drv) {
  g.save(); g.translate(X, Y); g.scale(face, 1);
  g.fillStyle = SHADOW; g.fillRect(-26, -2, 56, 5); g.fillStyle = SHADOW2; g.fillRect(-22, -3, 48, 7);
  const n = load ? load.length : 0, fh = n ? -9 : -1, wf = Math.floor(roll * 1.3) & 7;
  if (w) {
    arm(drv.st, -6, -36, 1, -27, true);
    g.drawImage(drv.spr, -22, -60);
    arm(drv.st, -6, -36, 2, -26, false);
  }
  g.drawImage(forkBody(), -30, -60);
  const wr = wheel(5, wf), wfr = wheel(6, wf); g.drawImage(wr, -17 - 6, -5 - 6); g.drawImage(wfr, 5 - 7, -6 - 7);
  for (let k = -56; k < fh - 10; k += 4) px(13, k, DARK[1]);
  R(16, fh - 15, 4, 15, OUT); for (let k = fh - 14; k < fh; k += 3) R(17, k, 2, 1, STEEL[4]);
  R(18, fh - 2, 16, 3, OUT); R(18, fh - 1, 15, 1, STEEL[5]); R(19, fh, 14, 1, STEEL[2]);
  if (n) for (let k = 0; k < Math.min(6, n); k++) g.drawImage(tireFlat(tireK(load[k])), 14, fh - 19 - k * 5);
  if (w) { const on = Math.floor(time * 4) & 1; R(-6, -60, 5, 4, OUT); R(-5, -59, 3, 2, on ? '#ffb020' : '#7a4a00'); if (on) { g.fillStyle = 'rgba(255,170,40,0.25)'; g.fillRect(-10, -63, 13, 9); } }
  g.restore();
}
const TRK = new Map(), TRL = new WeakMap();
function truckSprite(color, flat) {
  const key = color + (flat ? 'f' : 'b'); let c = TRK.get(key); if (c) return c;
  c = paint(mk(116, 46), () => {
    const P = ramp(color), ox = 2, oy = 3;
    for (const wx of [6, 18, 30, 86, 100]) { R(ox + wx, oy - 2, 10, 4, OUT); R(ox + wx, oy + 38, 10, 4, OUT); R(ox + wx + 1, oy - 2, 8, 1, DARK[3]); R(ox + wx + 1, oy + 41, 8, 1, DARK[2]); }
    if (flat) { R(ox, oy, 82, 40, OUT); R(ox + 1, oy + 1, 80, 38, WOOD[3]); for (let k = oy + 4; k < oy + 39; k += 5) R(ox + 1, k, 80, 1, WOOD[1]); R(ox + 1, oy + 1, 80, 2, P[3]); R(ox + 1, oy + 37, 80, 2, P[1]); R(ox + 1, oy + 1, 2, 38, P[2]); }
    else { R(ox, oy, 82, 40, OUT); R(ox + 1, oy + 1, 80, 38, '#e6eaef'); for (let k = ox + 8; k < ox + 80; k += 8) R(k, oy + 2, 1, 36, '#cfd5dc'); R(ox + 1, oy + 1, 80, 1, '#ffffff'); R(ox + 1, oy + 36, 80, 3, '#b4bcc6'); R(ox + 1, oy + 3, 80, 2, P[3]); R(ox + 1, oy + 33, 80, 2, P[2]); }
    R(ox + 82, oy + 13, 4, 14, DARK[2]);
    R(ox + 85, oy, 27, 40, OUT); R(ox + 86, oy + 1, 25, 38, P[3]); R(ox + 86, oy + 1, 25, 1, P[5]); R(ox + 86, oy + 37, 25, 2, P[1]);
    R(ox + 89, oy + 6, 13, 28, P[4]); R(ox + 89, oy + 6, 13, 1, P[5]); R(ox + 87, oy + 8, 3, 24, P[2]);
    R(ox + 104, oy + 4, 5, 32, '#16263c'); R(ox + 105, oy + 6, 1, 12, '#8fb6dc'); R(ox + 107, oy + 22, 1, 8, '#4a6a8c');
    R(ox + 100, oy - 3, 3, 3, DARK[1]); R(ox + 100, oy + 40, 3, 3, DARK[1]);
    R(ox + 110, oy + 4, 2, 6, '#fff4c0'); R(ox + 110, oy + 30, 2, 6, '#fff4c0'); for (const yy of [oy + 3, oy + 36]) px(ox + 92, yy, ORG[4]);
    R(ox + 84, oy + 2, 2, 5, DARK[1]);
  });
  TRK.set(key, c); return c;
}
const tireTop = () => cache('ttop', () => paint(mk(13, 13), () => { disc(6.5, 6.5, 6.5, OUT); disc(6.5, 6.5, 5.5, '#2a2826'); disc(5.5, 5.5, 3.5, '#3a3632'); disc(6.5, 6.5, 2.5, '#0e0d0c'); px(4, 3, '#55504a'); }));
function truck(tr) {
  if (tr.x < -4 || tr.x > V.MW + 4) return;
  const cx = Math.round(tr.x * Q + 12), cy = Math.round(tr.y * Q + 12), k = Math.round((tr.ang || 0) / (Math.PI / 2)), vert = k & 1;
  if (!vis(cx - 60, cy - 60, 120, 120)) return;
  g.fillStyle = SHADOW; if (vert) g.fillRect(cx - 18, cy - 52, 40, 112); else g.fillRect(cx - 52, cy - 16, 112, 40);
  const flat = tr.kind === 'deliver';
  g.save(); g.translate(cx, cy); g.rotate(k * Math.PI / 2);
  g.drawImage(truckSprite(tr.color, flat), -58, -23);
  if (flat) { const n = Math.min(tr.cargo.length, 33); for (let i = 0; i < n; i++) { const c = i % 3, r = Math.floor(i / 3); g.drawImage(tireTop(), -55 + r * 7, -18 + c * 12 + (r & 1) * 2); } } // каркасы на платформе — их видно, пока погрузчик разгружает
  g.restore();
  const moving = tr.state === 'arrive' || tr.state === 'leave';
  if (moving && rate(tr, 0, 6)) { const d = [[1, 0], [0, 1], [-1, 0], [0, -1]][((k % 4) + 4) % 4]; emit(2, cx + d[0] * 26 - d[1] * 16, cy + d[1] * 26 + d[0] * 16 - 4, -d[0] * 20 + (rnd() - 0.5) * 6, -d[1] * 20 - 8, 1.1, -3, 0.8, 0, 2, 6, '#5a5a62', 0.45); }
  let tl = TRL.get(tr); if (!tl || tl.n !== tr.cargo.length) { tl = { n: tr.cargo.length, t: `${tr.kind === 'deliver' ? 'IN' : 'OUT'} ${tr.cargo.length}` }; TRL.set(tr, tl); }
  label(objLabel(tr, tl.t, '#ffffff', true), cx, cy - 6, 1, false);
}
function carSprite(color) {
  let c = CARS.get(color); if (c) return c; c = paint(mk(22, 38), () => {
    const P = ramp(color); R(1, 2, 20, 34, OUT); R(2, 3, 18, 32, P[3]); R(2, 3, 18, 1, P[5]); R(2, 3, 1, 32, P[4]); R(19, 3, 1, 32, P[1]);
    R(4, 8, 14, 6, '#1a2a3c'); R(5, 9, 5, 1, '#9fc6e8'); R(4, 24, 14, 5, '#1a2a3c'); R(5, 15, 12, 8, P[4]); R(5, 15, 12, 1, P[5]);
    R(3, 3, 4, 2, '#fff4c0'); R(15, 3, 4, 2, '#fff4c0'); R(3, 34, 4, 1, RED[4]); R(15, 34, 4, 1, RED[4]);
    for (const [wx, wy] of [[0, 7], [20, 7], [0, 27], [20, 27]]) R(wx, wy, 2, 5, OUT);
  }); CARS.set(color, c); return c;
}

// ---------- рабочие: кадр ----------
const WS = new Map();
let WBYID = new Map(), CRANE = new Map();
function targetRect(w) {
  const j = w.job; if (!j) return null;
  if ((w.state === 'work' || w.state === 'act') && j.st && j.st.w) return j.st;
  if (w.state === 'lift') { const stp = j.steps && j.steps[j.i]; const id = stp && stp.pick ? j.src : stp && stp.drop ? j.dst : null; const s = id && STBYID.get(id); if (s) return s; }
  return null;
}
let STBYID = new Map();
function drawWorker(w) {
  const S = V.S, j = w.job;
  let st = WS.get(w.id); if (!st || st.col !== w.color) { st = { px: w.x, py: w.y, ph: 0, roll: 0, view: 'front', face: 1, still: 9, sp: new Map(), arms: new Map(), col: w.color, look: looksOf(w), first: String(w.name || '').split(' ')[0] }; WS.set(w.id, st); }
  const ddx = w.x - st.px, ddy = w.y - st.py; st.px = w.x; st.py = w.y;
  const dist = Math.hypot(ddx, ddy) * Q, moving = dist > 0.02 && dist < 90;
  st.still = moving ? 0 : st.still + dt;
  if (moving) { st.ph += Math.min(dist / 30, 2.6 * dt); st.roll += dist; }
  const walking = moving || (w.state === 'walk' && st.still < 0.2);
  const X = Math.round((w.x + 0.5) * Q), Y = Math.round((w.y + 0.5) * Q + 7);
  if (moving) { const ax = Math.abs(ddx), ay = Math.abs(ddy); if (ax >= ay * 0.75) { st.view = 'side'; st.face = ddx > 0 ? 1 : -1; } else st.view = ddy > 0 ? 'front' : 'back'; }
  else if (!walking) {
    const r = targetRect(w);
    if (r) { if (w.x < r.x - 0.2) { st.view = 'side'; st.face = 1; } else if (w.x > r.x + r.w - 0.8) { st.view = 'side'; st.face = -1; } else st.view = w.y >= r.y + r.h - 0.5 ? 'back' : 'front'; }
    else if (st.view === 'back' && (!j || w.state === 'idle')) st.view = 'front';
  }
  if (!vis(X - 40, Y - 66, 80, 76)) return;
  const nm = objLabel(w, st.first, '#f2f2f2', false), sel = S.selected && S.selected.w === w;
  if (w.mounted) {
    let ds = st.sp.get(999); if (!ds) { ds = personHR({ ...st.look, view: 'side', pose: 'sit', arms: 'none' }); st.sp.set(999, ds); }
    forklift(X, Y - 2, st.face, w, w.load, st.roll / 6, { st, spr: ds });
    if (sel) brackets(X - 30, Y - 66, 64, 70);
    label(nm, X, Y + 5, 1, false); return;
  }
  const look = st.look, tool = w.carry ? null : toolOf(w), grab = w.act === 'grab', on = !grab && (w.state === 'work' || w.state === 'act');
  const cart = !!(j && j.type === 'haul' && j.cart), crane = w.act === 'crane';
  const roll = !!(w.carry && !cart && !(crane && j && j.crane === 'drop'));
  const sit = w.state === 'break' || w.act === 'train';
  let view = sit ? 'front' : st.view; if (cart) view = 'side';
  const k = Math.floor(st.ph * 8) & 7, T = time + w.id * 0.37;
  const breath = !walking && !sit && Math.sin(time * 2.1 + w.id * 1.7) > 0.2, blink = !walking && ((time + w.id * 0.77) % 3.9) < 0.12;
  const pk = (view === 'side' ? 0 : view === 'back' ? 1 : 2) * 32 + (sit ? 30 : walking ? k : breath ? 8 : 9) * 2 + (blink ? 1 : 0);
  let spr = st.sp.get(pk); if (!spr) { const pose = sit ? 'sit' : walking ? 'walk' + k : breath ? 'breathe' : 'stand'; spr = personHR({ ...look, view, pose, arms: 'none', blink }); st.sp.set(pk, spr); }
  const oy = spr.oy || 0, face = view === 'side' ? st.face : 1;
  // позы рук (точка ног — 0,0; смотрит вправо)
  let nh, fh, toolAt = null; const sx = 0, sy = -25 + oy, ph = k / 8 * TAU;
  const carryTool = tool === 'canister' || tool === 'toolbox';
  if (view === 'side') {
    if (sit) { nh = [5, -14]; fh = [4, -15]; }
    else if (roll) { nh = [9, -22]; fh = [6, -20]; }
    else if (cart) { nh = [11, -17]; fh = [9, -17]; }
    else if (tool && tool !== 'hands' && (!walking || carryTool)) { const tp = toolPose(tool, on, T); nh = [tp[0], tp[1]]; fh = [tp[2], tp[3]]; toolAt = nh; }
    else if (walking) { const s = Math.sin(ph); nh = [sx - Math.round(s * 4), sy + 9 - Math.round(Math.abs(s))]; fh = [sx + Math.round(s * 4), sy + 9]; }
    else if (on || grab || w.state === 'lift') { const a = Math.sin(T * (grab ? 9 : w.state === 'lift' ? 3.5 : 5)); nh = [8, -18 + Math.round(a * 3)]; fh = [6, -17 - Math.round(a * 3)]; if (crane) { nh = [6, -22]; toolAt = nh; } }
    else { nh = [1, -16 + oy]; fh = [-1, -16 + oy]; }
  } else {
    const L = [-6, sy], Rr = [6, sy];
    if (sit) { nh = w.act === 'train' ? [4, -17] : [5, -16]; fh = w.act === 'train' ? [-3, -17] : [-5, -16]; }
    else if (view === 'back' && (on || grab || w.state === 'lift') && !roll) { const a = Math.round(Math.sin(T * 5) * 2); nh = [7, -31 + a]; fh = [-7, -31 - a]; if (tool && tool !== 'hands') toolAt = nh; }
    else if (roll) { nh = [9, -22]; fh = [L[0] - 1, L[1] + 9]; }
    else if (tool && tool !== 'hands' && (!walking || carryTool)) { const tp = toolPose(tool, on, T); nh = [Math.max(7, tp[0] - 2), tp[1] + 2]; fh = [L[0] - 1, L[1] + 9]; toolAt = nh; }
    else if (walking) { const s = Math.round(Math.sin(ph) * 1.5); nh = [Rr[0] + 1, Rr[1] + 9 + s]; fh = [L[0] - 1, L[1] + 9 - s]; }
    else if (on || grab || w.state === 'lift') { const a = Math.round(Math.sin(T * 5) * 3); nh = [7, -19 + a]; fh = [-7, -19 - a]; }
    else { nh = [7, -16 + oy]; fh = [-7, -16 + oy]; }
  }
  g.save(); g.translate(X, Y); g.scale(face, 1);
  g.drawImage(shadowSpr(), -10, -3);
  if (view === 'side') {
    arm(st, sx, sy, fh[0], fh[1], true);
    g.drawImage(spr, -16, -46);
    if (roll) drawRoll(w, st, 'side');
    if (cart) drawCart(w);
    arm(st, sx, sy, nh[0], nh[1], false);
    if (toolAt) drawTool(tool, on, T, toolAt[0], toolAt[1]);
  } else if (view === 'back') {
    if (toolAt) drawTool(tool, on, T, toolAt[0], toolAt[1]);
    if (nh[1] < -26) { arm(st, -6, sy, fh[0], fh[1], true); arm(st, 6, sy, nh[0], nh[1], true); g.drawImage(spr, -16, -46); }
    else { g.drawImage(spr, -16, -46); arm(st, -6, sy, fh[0], fh[1], false); arm(st, 6, sy, nh[0], nh[1], false); }
    if (roll) drawRoll(w, st, 'tread');
  } else {
    g.drawImage(spr, -16, -46);
    if (roll) drawRoll(w, st, 'tread');
    arm(st, -6, sy, fh[0], fh[1], false); arm(st, 6, sy, nh[0], nh[1], false);
    if (toolAt) drawTool(tool, on, T, toolAt[0], toolAt[1]);
    if (sit) drawTool(w.act === 'train' ? 'book' : 'cup', true, T, w.act === 'train' ? 1 : 5, -16);
  }
  g.restore();
  // искры, туман, облой от инструмента — в мировых координатах
  if (toolAt && on) toolFx(tool, X + face * toolAt[0], Y + toolAt[1], face, w, view);
  if (sit) { const ph2 = (time * 0.6 + w.id * 0.13) % 1; g.globalAlpha = 1 - ph2; g.drawImage(zSprite(), X + 6 + Math.round(ph2 * 5), Y - 52 - Math.round(ph2 * 10)); g.globalAlpha = 1; }
  if (w.energy < 28 && !sit && (Math.floor(time * 2) & 1)) g.drawImage(bang(), X + 6, Y - 58);
  if (sel) brackets(X - 13, Y - 50, 26, 54);
  label(nm, X, Y + 4, 1, false);
}
const shadowSpr = () => cache('wsh', () => paint(mk(20, 6), () => { ell(0, 0, 20, 6, 'rgba(12,8,26,0.22)'); ell(4, 1, 12, 4, 'rgba(12,8,26,0.16)'); }));
const zSprite = () => cache('zz', () => textSprite('Z', '#ffffff', false));
function drawRoll(w, st, mode) { // шину катят рядом с собой
  const kd = tireK(w.carry), r = rT(w.carry, 11), fr = Math.floor(st.roll / r / TAU * NF);
  g.fillStyle = SHADOW; g.fillRect(4, -2, 16, 3);
  if (mode === 'side') { const sp = tireSide(r, kd, fr, false); g.drawImage(sp, r + 1 - (sp.width >> 1), -sp.height); }
  else { const sp = tireTread(r, kd, fr); g.drawImage(sp, 11 - (sp.width >> 1), -sp.height + 1); }
}
function drawCart(w) { g.drawImage(cartSprite(), 6, -13); if (w.load) stack(19, -9, w.load, 0, Math.min(4, w.load.length)); }
function toolFx(tool, x, y, face, w, view) {
  if (view === 'back') y -= 2;
  switch (tool) {
    case 'grinder': { const n = rate(w, 0, 70); if (n) sparks(x + face * 8, y + 2, face, n); break; }
    case 'spray': { const n = rate(w, 0, 50); for (let k = 0; k < n; k++) emit(2, x + face * 9, y - 2, face * (60 + rnd() * 50), (rnd() - 0.5) * 30, 0.5 + rnd() * 0.4, 0, 3.5, 0, 1, 3, '#dff2ff', 0.55); break; }
    case 'extruder': if (rate(w, 0, 3)) emit(2, x + face * 12, y - 6, face * 4, -14, 1, -2, 0.5, 0, 1, 3, '#d8d0c8', 0.3); break;
    case 'knife': { const n = rate(w, 0, 8); for (let k = 0; k < n; k++) emit(1, x + face * 8, y - 1, face * (10 + rnd() * 30), -20 - rnd() * 30, 0.8, 300, 0.4, y + 18, 2, 1, '#141417', 1); break; }
    case 'broom': if (rate(w, 0, 7)) emit(2, x + face * 10, y + 16, face * (8 + rnd() * 14), -6 - rnd() * 8, 0.9, 0, 0.8, 0, 1, 4, '#9a8c74', 0.4); break;
    case 'wrench': if (rate(w, 0, 1.2)) sparks(x + face * 10, y - 2, face, 3); break;
    case 'cup': if (rate(w, 0, 1.5)) steam(x, y - 5, 0.4); break;
  }
}

// ---------- события (S.events): маркер на карте и плашка сверху ----------
const EVC = [[/break|fault|defekt|fire|brand|fehler|alarm|bad|warn|crit|stör|panne|unfall|accident|polom|авар|полом|пожар/i, '#e5483a'], [/truck|lkw|liefer|order|auftrag|good|done|ok|bonus|reward|заказ|груз/i, '#3fbf6a'], [/info|tip|hint|news|инфо/i, '#3b8be0']];
const CLSC = { bad: '#e5483a', good: '#3fbf6a', info: '#3b8be0', warn: '#f2b81e' };
const evColor = e => { if (e.cls && CLSC[e.cls]) return CLSC[e.cls]; const s = String(e.kind || '') + ' ' + String(e.title || ''); for (const [re, c] of EVC) if (re.test(s)) return c; return '#f2b81e'; };
function evIcon(col) { let c = EVI.get(col); if (c) return c; c = paint(mk(13, 17), () => { const P = ramp(col); disc(6.5, 6.5, 6.5, OUT); disc(6.5, 6.5, 5.5, P[3]); disc(5.5, 5.5, 3, P[4]); px(4, 3, P[5]); R(5, 12, 3, 4, OUT); px(6, 13, P[2]); px(6, 14, OUT); R(6, 3, 1, 5, '#ffffff'); R(6, 9, 1, 1, '#ffffff'); }); EVI.set(col, c); return c; }
let evList = [];
function liveEvents() {
  const ev = V.S && V.S.events; evList.length = 0; if (!Array.isArray(ev)) return evList;
  for (const e of ev) { if (!e) continue; if (typeof e.until === 'number' && e.until < 1e7 && e.until < V.S.t) continue; evList.push(e); }
  return evList;
}
function eventsWorld(list) { // пульсирующее кольцо на полу
  for (const e of list) {
    if (typeof e.x !== 'number' || typeof e.y !== 'number') continue;
    const x = (e.x + 0.5) * Q, y = (e.y + 0.5) * Q + 6; if (!vis(x - 30, y - 20, 60, 40)) continue;
    const col = evColor(e), A = alphas(col);
    for (let q = 0; q < 2; q++) { const ph = (time * 0.8 + q * 0.5) % 1, rx = 6 + ph * 18, ry = rx * 0.45, a = Math.round((1 - ph) * 12); g.fillStyle = A[a]; for (let i = 0; i < 28; i++) { const t = i / 28 * TAU; g.fillRect(Math.round(x + Math.cos(t) * rx), Math.round(y + Math.sin(t) * ry), 2, 1); } }
  }
}
const banner = { e: null, t0: 0, n: 0, cw: 0, st: null, dpr: 0, txt: '', lang: '' };
const txtL = v => v && typeof v === 'object' ? (V.S.lang === 'de' ? v.de : v.ru) || v.de || v.ru || '' : String(v || ''); // текст события: строка или {ru, de}
function eventsScreen(ctx, list, cw, ch, fs) {
  if (!list.length) return;
  for (const e of list) { // значки над местом события (экранный размер постоянный)
    if (typeof e.x !== 'number' || typeof e.y !== 'number') continue;
    const wx = (e.x + 0.5) * Q, wy = (e.y + 0.5) * Q - 30, sx = (wx - VX) / VW * cw, sy = (wy - VY) / VH * ch + Math.sin(time * 4 + (e.id | 0)) * 3 * fs;
    if (sx < -40 || sy < -40 || sx > cw + 40 || sy > ch + 40) continue;
    const ic = evIcon(evColor(e)), sc = fs + 1; ctx.drawImage(ic, Math.round(sx - ic.width * sc / 2), Math.round(sy - ic.height * sc), ic.width * sc, ic.height * sc);
  }
  let last = list[list.length - 1]; for (const e of list) if (typeof e.id === 'number' && typeof last.id === 'number' && e.id > last.id) last = e;
  const dpr = window.devicePixelRatio || 1, B = banner;
  if (B.e !== last || B.n !== list.length || B.cw !== cw || B.st !== last.state || B.dpr !== dpr || B.lang !== V.S.lang) { // разметка плашки — только когда что-то изменилось
    if (B.e !== last) B.t0 = time;
    B.e = last; B.n = list.length; B.cw = cw; B.st = last.state; B.dpr = dpr; B.lang = V.S.lang; B.col = evColor(last);
    B.font = `600 ${Math.round(13 * dpr)}px system-ui, "Segoe UI", sans-serif`; ctx.font = B.font;
    const title = ((last.icon ? last.icon + ' ' : '') + txtL(last.title || last.text)).trim();
    let txt = title; const maxW = cw * 0.62; while (txt.length > 4 && ctx.measureText(txt).width > maxW) txt = txt.slice(0, -2);
    if (txt !== title) txt += '…';
    B.txt = txt; B.more = (last.state === 'choice' ? (V.S.lang === 'de' ? '  · Entscheidung nötig' : '  · нужно решение') : '') + (list.length > 1 ? `  +${list.length - 1}` : '');
    B.tw = ctx.measureText(txt).width; B.mw = B.more ? ctx.measureText(B.more).width : 0;
  }
  if (!B.txt) return;
  const padX = Math.round(12 * dpr), hgt = Math.round(30 * dpr), col = B.col, iw = Math.round(17 * dpr), bw = Math.round(B.tw + B.mw + padX * 2 + iw + 6 * dpr), lw = Math.max(1, Math.round(dpr));
  const k = clamp((time - B.t0) / 0.35, 0, 1), ease = 1 - (1 - k) ** 3, bx = Math.round((cw - bw) / 2), by = Math.round(lerp(-hgt - 4, 8 * dpr, ease));
  ctx.fillStyle = 'rgba(14,16,24,0.88)'; ctx.fillRect(bx, by, bw, hgt);
  ctx.fillStyle = col; ctx.fillRect(bx, by, Math.round(4 * dpr), hgt); ctx.fillRect(bx, by + hgt - lw, bw, lw);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = lw; ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, hgt - 1);
  const ic = evIcon(col), isc = Math.max(1, Math.round(dpr)); ctx.drawImage(ic, bx + Math.round(10 * dpr), by + Math.round((hgt - ic.height * isc) / 2), ic.width * isc, ic.height * isc);
  ctx.font = B.font; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f4f4f6'; ctx.fillText(B.txt, bx + padX + iw, by + hgt / 2 + dpr);
  if (B.more) { ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillText(B.more, bx + padX + iw + B.tw, by + hgt / 2 + dpr); }
  if (k < 1 || Math.sin(time * 5) > 0) { ctx.fillStyle = rgba(col, 0.18 * (1 - k * 0.6)); ctx.fillRect(bx, by, bw, hgt); }
}

// ---------- свет: ночь, лампы, тёплые пятна ----------
function glowSprite() { return cache('glow', () => { const c = mk(64, 64), x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return c; }); }
function warmGlow() { return cache('wglow', () => { const c = mk(64, 64), x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,170,80,0.9)'); gr.addColorStop(0.6, 'rgba(255,120,40,0.25)'); gr.addColorStop(1, 'rgba(255,120,40,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return c; }); }
function buildLights() {
  const W = V.MW * LQ, H = V.MH * LQ; lightC = mk(W, H); lampMask = mk(W, H); warmMask = mk(W, H);
  const lm = lampMask.getContext('2d'), wm = warmMask.getContext('2d'), gl = glowSprite();
  LAMPS.length = 0;
  for (let y = 11; y < V.MH - 2; y += 6) for (let x = 4; x < V.MW - 2; x += 7) if (V.grid[V.I(x, y)] === V.T_FLOOR) LAMPS.push([x, y]);
  for (const [x, y] of LAMPS) {
    const r = 3.8 * LQ; lm.globalAlpha = 0.95; lm.drawImage(gl, x * LQ - r, y * LQ - r, r * 2, r * 2);
    const gr = wm.createRadialGradient(x * LQ, y * LQ, 0, x * LQ, y * LQ, 3 * LQ); gr.addColorStop(0, 'rgba(255,200,120,0.55)'); gr.addColorStop(1, 'rgba(255,170,90,0)'); wm.fillStyle = gr; wm.fillRect(x * LQ - 3 * LQ, y * LQ - 3 * LQ, 6 * LQ, 6 * LQ);
  }
  for (const d of Object.values(V.DOCKS)) { const r = d.rect, cx = (r.x + r.w / 2) * LQ, cy = (r.y + r.h / 2) * LQ, rr = 3 * LQ; lm.drawImage(gl, cx - rr, cy - rr, rr * 2, rr * 2); }
}

// ---------- кадр ----------
let camInit = false, labelsOn = true, REF = null;
const stats = { ms: 0, avg: 0, parts: [0, 0, 0, 0, 0, 0, 0] }; // части кадра: фон, станки, конвейер+техника, люди, частицы+ночь, вывод, надписи
let tMark = 0;
const mark = i => { const n = performance.now(); stats.parts[i] = stats.parts[i] * 0.9 + (n - tMark) * 0.1; tMark = n; };
function render(view) {
  const t0 = performance.now(); tMark = t0;
  V = view; const now = performance.now(); dt = lastNow ? clamp((now - lastNow) / 1000, 0, 0.1) : 0; lastNow = now; time = now / 1000;
  const { MW, MH, S, STATIONS, ctx, TILE } = V;
  if (!camInit) { camInit = true; if (V.CAM) { cam.z = V.CAM.z; cam.cx = V.CAM.cx * PT; cam.cy = V.CAM.cy * PT; } clampCam(); }
  if (!wc) { wc = mk(MW * Q, MH * Q); buildLights(); }
  if (!bg) buildBackground();
  g = wc.getContext('2d'); g.imageSmoothingEnabled = false; g.setTransform(1, 0, 0, 1, 0, 0);
  const [cx0, cy0, cw0, ch0] = viewRect(); VX = cx0 * 2; VY = cy0 * 2; VW = cw0 * 2; VH = ch0 * 2;
  nLB = 0;
  // справочники кадра (без поиска в циклах)
  WBYID.clear(); CRANE.clear(); if (STBYID.size !== STATIONS.length) { STBYID = new Map(); for (const s of STATIONS) STBYID.set(s.id, s); }
  for (const w of S.workers) { WBYID.set(w.id, w); if (w.act === 'crane' && w.job && !w.away) { if (w.job.src) CRANE.set(w.job.src, w); if (w.job.dst) CRANE.set(w.job.dst, w); } }
  // фон: только видимая часть
  const bx = Math.max(0, Math.floor(VX) - 2), by = Math.max(0, Math.floor(VY) - 2), bw = Math.min(wc.width - bx, Math.ceil(VW) + 4), bh = Math.min(wc.height - by, Math.ceil(VH) + 4);
  g.drawImage(bg, bx, by, bw, bh, bx, by, bw, bh);
  // сканер Ж4 (рамка с лучом), ящик с инструментами на верстаке, машины рабочих, роликовый конвейер
  if (!REF || REF.d !== V.DECOR) REF = { d: V.DECOR, scn: V.DECOR.find(o => o.id === 'scanner'), wb: V.DECOR.find(o => o.id === 'werkbank'), sc: V.DECOR.find(o => o.id === 'schrott'), pz: V.ZONES.find(z => z.kind === 'parking'), n: -1, txt: '' };
  const scn = REF.scn;
  if (scn) {
    const X = scn.x * Q, Y = scn.y * Q, Wd = scn.w * Q, hot = S.t - scn.lastScan < 0.8;
    if (vis(X, Y - 30, Wd, 60)) {
      g.fillStyle = hot ? 'rgba(255,40,40,0.35)' : 'rgba(255,40,40,0.12)'; g.fillRect(X + 6, Y + 6, Wd - 12, 12);
      const ly = Y + 6 + Math.round((Math.sin(time * 5) * 0.5 + 0.5) * 12); R(X + 6, ly, Wd - 12, 1, hot ? '#ff6050' : 'rgba(255,60,60,0.6)');
      for (const px0 of [X + 1, X + Wd - 6]) { R(px0, Y - 22, 5, 44, OUT); R(px0 + 1, Y - 21, 3, 42, BLUE[3]); R(px0 + 1, Y - 21, 1, 42, BLUE[5]); }
      boxS(X, Y - 26, Wd, 8, 3, BLUE); R(X + 8, Y - 19, Wd - 16, 2, "#ff3030");
      R(X + Wd - 12, Y - 24, 3, 3, hot ? '#62ff8a' : '#2a5a3a');
    }
  }
  const wb = REF.wb;
  if (wb && !S.workers.some(w => !w.away && w.tool === 'kit')) { const X = wb.x * Q + wb.w * Q - 24, Y = wb.y * Q - 2; R(X, Y, 16, 10, OUT); R(X + 1, Y + 1, 14, 8, RED[3]); R(X + 1, Y + 1, 14, 1, RED[5]); R(X + 1, Y + 5, 14, 1, RED[1]); R(X + 5, Y - 2, 6, 2, OUT); }
  const present = S.workers.filter(w => !w.away);
  const pz = REF.pz;
  if (pz && vis(pz.x * Q, pz.y * Q, pz.w * Q, pz.h * Q)) { const n = Math.min(present.length, Math.floor(pz.w / 2)); for (let k = 0; k < n; k++) { const X = pz.x * Q + 13 + k * 2 * Q, Y = pz.y * Q + 18 + (k & 1) * 14; R(X + 3, Y + 4, 22, 38, SHADOW); g.drawImage(carSprite(present[k].color), X, Y); } }
  if (S.rollenbahn) {
    const X = 45 * Q + 2, Y = 29 * Q, L = 8 * Q;
    if (vis(X, Y, Q, L)) { R(X - 1, Y, Q - 2, L, OUT); R(X, Y, Q - 4, L, DARK[3]); const off = Math.floor(time * 20) % 4; for (let k = off; k < L; k += 4) { R(X + 1, Y + k, Q - 6, 2, STEEL[3]); R(X + 1, Y + k, Q - 6, 1, STEEL[5]); } R(X - 1, Y, 2, L, YEL[3]); R(X + Q - 5, Y, 2, L, YEL[3]);
      for (const s of STATIONS) if (s.g === 'aufbau') for (const id of s.out) { const t = S.tires.get(id); if (t && t.rollT !== undefined) { const f = clamp(1 - (t.rollT - S.t) / 1.5, 0, 1); g.drawImage(tireFlat(kindOf(t)), X - 2, Y + 4 + f * (L - 26)); } } }
  }
  mark(0);
  // станки и склады
  for (const s of STATIONS) drawStation(s);
  drawPortal();
  const sel = S.selected;
  if (sel && sel.st) { const s = sel.st; brackets(s.x * Q - 2, s.y * Q - 2, s.w * Q + 4, s.h * Q + 4); }
  if (sel && sel.d) { const d = sel.d; brackets(d.x * Q - 2, d.y * Q - 2, d.w * Q + 4, d.h * Q + 4); }
  // привод и подвесной конвейер
  const d = V.HOOK_DRIVE;
  if (d) { const X = d.x * Q, Y = d.y * Q; if (vis(X - SMX, Y - SMY, Q + 2 * SMX, Q + SMY + SMB)) { g.drawImage(stationSprite(d, Q, Q), X - SMX, Y - SMY); dynAntrieb(d, X, Y); brokenFx(d, X, Y, Q, Q); } }
  mark(1);
  if (V.SEGS && V.HOOKS) drawConveyor();
  for (const tr of S.trucks) truck(tr);
  for (const s of STATIONS) progress(s);
  // свободные погрузчики на стоянке
  for (const f of S.forks || []) if (!f.by) { const X = Math.round(f.x * Q + 12), Y = Math.round(f.y * Q + 12 + 6); if (vis(X - 34, Y - 64, 70, 70)) forklift(X, Y, 1, null, null, 0); }
  mark(2);
  // люди — по глубине
  present.sort((a, b) => a.y - b.y);
  for (const w of present) drawWorker(w);
  mark(3);
  // частицы
  stepParticles(); drawParticles(); stats.particles = PS.length;
  const evs = liveEvents(); if (evs.length) eventsWorld(evs);
  // счётчик лома
  const sc = REF.sc; if (sc) { if (REF.n !== S.scrap) { REF.n = S.scrap; REF.txt = 'SCHROTT ' + S.scrap; } label(objLabel(sc, REF.txt, '#ffb0a0', true), sc.x * Q + 6, sc.y * Q - 18, 0, false); }
  // ночь
  const c = V.clock(); let dark = 0;
  const NIGHT = 0.3; // насколько темнеет ночью: цех освещён, карта не должна быть чёрной
  if (c < V.DAY_START || c >= V.DAY_END) dark = NIGHT; else if (c < V.DAY_START + 60) dark = NIGHT * (1 - (c - V.DAY_START) / 60); else if (c > V.DAY_END - 60) dark = NIGHT * ((c - (V.DAY_END - 60)) / 60);
  if (dark > 0) {
    const lg = lightC.getContext('2d'); lg.globalCompositeOperation = 'source-over'; lg.clearRect(0, 0, lightC.width, lightC.height);
    lg.fillStyle = `rgba(30,36,70,${dark.toFixed(3)})`; lg.fillRect(0, 0, lightC.width, lightC.height);
    lg.globalCompositeOperation = 'destination-out'; lg.drawImage(lampMask, 0, 0);
    const gl = glowSprite();
    for (const s of STATIONS) if (s.state === 'running' || s.cur) { const r = (s.state === 'running' ? 1.6 : 1.2) * LQ; lg.globalAlpha = 0.7; lg.drawImage(gl, (s.x + s.w / 2) * LQ - r, (s.y + s.h / 2) * LQ - r, r * 2, r * 2); }
    for (const tr of S.trucks) { const r = 2.5 * LQ; lg.globalAlpha = 0.8; lg.drawImage(gl, (tr.x + 0.5) * LQ - r, (tr.y + 0.5) * LQ - r, r * 2, r * 2); }
    lg.globalAlpha = 1; lg.globalCompositeOperation = 'source-over';
  }
  mark(4);
  // вывод на экран
  const W = MW * TILE, H = MH * TILE, cvs = ctx.canvas, cw = cvs.width, chh = cvs.height, kdev = cw / VW;
  ctx.save(); ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = kdev < 0.98; if (ctx.imageSmoothingEnabled) ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(wc, VX, VY, VW, VH, 0, 0, W, H);
  if (dark > 0) {
    ctx.imageSmoothingEnabled = true; const k = LQ / Q;
    ctx.drawImage(lightC, VX * k, VY * k, VW * k, VH * k, 0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = dark * 0.5; ctx.drawImage(warmMask, VX * k, VY * k, VW * k, VH * k, 0, 0, W, H);
    const wg = warmGlow(), sx = W / VW; ctx.globalAlpha = dark * 0.6;
    for (const s of STATIONS) if (s.state === 'running' && !s.broken) { const x = (s.x * Q + s.w * Q / 2 - VX) * sx, y = (s.y * Q + 20 - VY) * sx, r = 30 * sx; if (x > -r && y > -r && x < W + r && y < H + r) ctx.drawImage(wg, x - r, y - r, r * 2, r * 2); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  mark(5);
  // надписи и события — в пикселях устройства
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
  const dpr = window.devicePixelRatio || 1, kc = kdev / dpr, tier = kc < 0.8 ? 0 : kc < 1.75 ? 1 : 2, big = Math.max(1, Math.round(1.6 * dpr)), fs = tier === 0 ? Math.max(1, Math.round(dpr)) : big;
  if (labelsOn) for (let i = 0; i < nLB; i++) {
    const l = LB[i], s = lblSprite(l.e, tier === 1 || (tier === 2 && l.m)), w = s.width * fs, h = s.height * fs;
    const x = Math.round((l.x - VX) * kdev - (l.a ? w / 2 : 0)), y = Math.round((l.y - VY) * kdev);
    if (x > cw || y > chh || x + w < 0 || y + h < 0) continue;
    ctx.drawImage(s, x, y, w, h);
  }
  if (evs.length) eventsScreen(ctx, evs, cw, chh, fs);
  ctx.restore();
  mark(6);
  stats.ms = performance.now() - t0; stats.avg = stats.avg * 0.95 + stats.ms * 0.05;
}
window.PixelGfx = {
  render, toTile, zoomAt, pan, cam, personHR, looksOf, stats,
  reset: () => { bg = null; STGEN++; railC = null; GCOUNT.clear(); SNAME.clear(); REF = null; PORT.n = -1; },
  labels: on => { labelsOn = on !== false; },
};
})();
