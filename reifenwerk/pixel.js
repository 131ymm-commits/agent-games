'use strict';
// Пиксельная мультяшная графика для общего вида цеха. Рисуем в маленький холст (12 px на клетку)
// и растягиваем без сглаживания. Симуляция та же — меняется только отрисовка.
(() => {
const PT = 12, OUT = '#1e1c26';
let V, pc, g, bgCanvas, lightCanvas, time = 0;
// Камера: зум 1..4, центр в пикселях маленького холста
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
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
const R = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
const shadeCache = new Map();
function shade(hex, f) {
  const k = hex + f; if (shadeCache.has(k)) return shadeCache.get(k);
  const n = parseInt(hex.slice(1), 16), m = v => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))));
  const out = '#' + [n >> 16, (n >> 8) & 255, n & 255].map(v => m(v).toString(16).padStart(2, '0')).join('');
  shadeCache.set(k, out); return out;
}
function box(x, y, w, h, c) { R(x, y, w, h, OUT); R(x + 1, y + 1, w - 2, h - 2, c); R(x + 1, y + 1, w - 2, 1, shade(c, 0.35)); R(x + 1, y + h - 2, w - 2, 1, shade(c, -0.35)); }
function disc(cx, cy, r, c) { for (let dy = -r; dy <= r; dy++) { const dx = Math.floor(Math.sqrt(r * r - dy * dy) + 0.35); R(cx - dx, cy + dy, dx * 2 + 1, 1, c); } }

// ---------- пиксельный шрифт 3×5 ----------
const GLYPH = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100',
  G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100', Q: '010101101110011', R: '110101110101101',
  S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001110',
  '.': '000000000000010', ':': '000010000010000', '/': '001001010100100', '-': '000000111000000', '%': '101001010100101', '!': '010010010000010', ' ': '000000000000000',
  'Ж': '101111010111101', 'Ф': '010111101111010',
};
const CYR = { К: 'K', С: 'C', Р: 'P', М: 'M', З: '3', А: 'A', В: 'B', Е: 'E', Н: 'H', О: 'O', Т: 'T', Х: 'X' };
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'SS').replace(/[łŁ]/g, 'L').toUpperCase().replace(/[КСРМЗАВЕНОТХ]/g, c => CYR[c]);
const NEW = t => !!t && ['presse', 'entgr', 'scan', 'endk', 'fertig'].includes(t.stage); // после пресса — новый протектор
const textW = s => norm(s).length * 4 - 1;
function ptext(s, x, y, col = '#fff', sh = OUT) {
  const str = norm(s);
  for (const pass of sh ? [0, 1] : [1]) {
    let cx = Math.round(x);
    for (const ch of str) { const gl = GLYPH[ch]; if (gl) for (let i = 0; i < 15; i++) if (gl[i] === '1') R(cx + i % 3 + (pass ? 0 : 1), y + ((i / 3) | 0) + (pass ? 0 : 1), 1, 1, pass ? col : sh); cx += 4; }
  }
}

// ---------- спрайты ----------
function tire(x, y, done) {
  x = Math.round(x); y = Math.round(y);
  R(x + 1, y, 5, 7, OUT); R(x, y + 1, 7, 5, OUT);
  R(x + 1, y + 1, 5, 5, '#34343b'); R(x + 1, y + 1, 2, 1, '#55555e');
  R(x + 2, y + 2, 3, 3, done ? '#dfe3ea' : '#8b9099'); R(x + 3, y + 3, 1, 1, OUT);
  if (done) R(x + 3, y, 1, 1, '#ffa630');
}
// Человечек 12×17 (с контуром 14×19): волосы h, кожа s, глаза e, рот m, рубашка t/T, светоотражатели Y, ремень c, брюки p, ботинки b
const BODY = ['...hhhhhh...', '..hhhhhhhh..', '..hssssssh..', '..sesssses..', '..ssssssss..', '...ssmmss...', '....ssss....',
  '..tttttttt..', '.tttttttttt.', 'stttttttttts', 'stYYttttYYts', 'sTTTTTTTTTTs', '.cccccccccc.'];
const POSE = {
  stand: ['..pppppppp..', '..ppp..ppp..', '..bbb..bbb..', '.bbbb..bbbb.'],
  walk: ['...pppppp...', '...pp..pp...', '...bb..bb...', '..bbb..bbb..'],
  sit: ['.pppppppppp.', '.pppppppppp.', '............', '............'],
};
const HAIRS = ['#3b2a20', '#1d1a1a', '#c99a4a', '#8a3b20', '#6b5b4b', '#e2c56f', '#a7a7a7'];
const SKINS = ['#f1c8a0', '#e0b088', '#c68e5f', '#9a6440', '#f6d7bf'];
const spriteCache = new Map();
function person(hair, skin, shirt, pose, arms) {
  const key = [hair, skin, shirt, pose, arms].join('|'); if (spriteCache.has(key)) return spriteCache.get(key);
  let rows = [...BODY, ...POSE[pose === 'walk' ? 'walk' : pose === 'sit' ? 'sit' : 'stand']];
  const noHands = r => '.' + r.slice(1, 11) + '.';
  if (arms === 'up') rows = rows.map((r, i) => i === 5 ? 's' + r.slice(1, 11) + 's' : i === 6 ? 's' + r.slice(1, 11) + 's' : i === 7 ? 's' + r.slice(1, 11) + 's' : i >= 9 && i <= 11 ? noHands(r) : r);
  if (arms === 'carry') rows = rows.map((r, i) => i >= 9 && i <= 11 ? noHands(r) : r);
  const pal = { h: hair, s: skin, e: OUT, m: shade(skin, -0.3), t: shirt, T: shade(shirt, -0.3), Y: '#f3f7a6', c: '#2a2a30', p: '#33405e', b: '#3b2a22' };
  const w = 14, h = rows.length + 2, c = document.createElement('canvas'); c.width = w; c.height = h;
  const cg = c.getContext('2d'), filled = (x, y) => y >= 0 && y < rows.length && x >= 0 && x < 12 && rows[y][x] !== '.';
  for (let y = -1; y <= rows.length; y++) for (let x = -1; x <= 12; x++) {
    if (filled(x, y)) { cg.fillStyle = pal[rows[y][x]]; cg.fillRect(x + 1, y + 1, 1, 1); }
    else if (filled(x + 1, y) || filled(x - 1, y) || filled(x, y + 1) || filled(x, y - 1)) { cg.fillStyle = OUT; cg.fillRect(x + 1, y + 1, 1, 1); }
  }
  spriteCache.set(key, c); return c;
}

// ---------- статический фон: пол, стены, зоны, мебель ----------
function buildBackground() {
  const { MW, MH, grid, I, T_GRASS, T_ROAD, T_YARD, T_FLOOR, T_WALL, T_DOOR, ZONES, DECOR, DOCKS, SEATS } = V;
  bgCanvas = document.createElement('canvas'); bgCanvas.width = MW * PT; bgCanvas.height = MH * PT;
  const keep = g; g = bgCanvas.getContext('2d');
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const t = grid[I(x, y)], X = x * PT, Y = y * PT, r = hash(x, y);
    if (t === T_GRASS) {
      R(X, Y, PT, PT, r < 0.5 ? '#6cbf4f' : '#64b649');
      for (let k = 0; k < 3; k++) { const a = hash(x * 3 + k, y * 7); R(X + (a * 10 | 0), Y + (hash(y, x + k) * 10 | 0), 1, 2, '#89d965'); }
      if (r > 0.93) { R(X + 5, Y + 5, 2, 2, r > 0.97 ? '#ff7070' : '#ffe066'); R(X + 5, Y + 7, 1, 2, '#3f8a34'); }
    } else if (t === T_ROAD) {
      R(X, Y, PT, PT, '#54575f'); if (r > 0.6) R(X + (r * 9 | 0), Y + 3, 1, 1, '#646872');
      if (y === 1 && x % 2 === 0) R(X + 2, Y + 5, 7, 2, '#efe6c8');
    } else if (t === T_YARD) {
      R(X, Y, PT, PT, '#a9adb3'); if (x % 2 === 0) R(X, Y, 1, PT, '#979ba2'); if (y % 2 === 0) R(X, Y, PT, 1, '#979ba2');
      if (r > 0.85) R(X + 3, Y + 6, 4, 1, '#8f939a');
    } else if (t === T_FLOOR) {
      R(X, Y, PT, PT, (x + y) % 2 ? '#d3ccbc' : '#cdc6b5'); R(X + PT - 1, Y, 1, PT, '#bfb7a5'); R(X, Y + PT - 1, PT, 1, '#bfb7a5');
      if (r > 0.9) R(X + 4, Y + 4, 1, 1, '#b5ad9b');
    } else if (t === T_WALL) {
      R(X, Y, PT, PT, '#8a5141'); R(X, Y, PT, 2, '#a5634f'); R(X, Y + PT - 1, PT, 1, '#5e3529');
      R(X + (y % 2 ? 0 : 6), Y + 5, 1, 4, '#6e3f31'); R(X, Y + 5, PT, 1, '#6e3f31');
    } else if (t === T_DOOR) {
      R(X, Y, PT, PT, '#c58b45'); for (let k = 0; k < PT; k += 3) R(X + k, Y, 1, PT, '#a4702f'); R(X, Y, PT, 1, '#e0a862');
    }
  }
  // Зоны: комната отдыха (дерево), парковка, навес, участки (подпись на стене над участком)
  for (const z of ZONES) {
    const X = z.x * PT, Y = z.y * PT, w = z.w * PT, h = z.h * PT;
    if (z.kind === 'rest') { for (let yy = 0; yy < h; yy += 3) R(X, Y + yy, w, 3, (yy / 3) % 2 ? '#c69a63' : '#ba8c55'); for (let yy = 0; yy < h; yy += 3) R(X + ((yy * 7) % w), Y + yy, 1, 3, '#a87a46'); }
    else if (z.kind === 'parking') { R(X, Y, w, h, '#4c4f57'); for (let k = 0; k <= z.w; k += 2) R(X + k * PT, Y + 2, 1, h - 4, '#e8e8e8'); }
    else if (z.kind === 'shed') { g.fillStyle = z.color; g.fillRect(X, Y, w, h); for (let yy = 0; yy <= z.h; yy += 6) for (let xx = 0; xx <= z.w; xx += 6) box(X + xx * PT - 2, Y + yy * PT - 2, 4, 4, '#6b6458'); }
    else { g.fillStyle = z.color; g.fillRect(X, Y, w, h); }
    ptext(z.name, X + 2, Y - 9, z.kind === 'parking' || z.kind === 'shed' ? '#fff' : '#ffd84a');
  }
  // Ворота: З — приёмка, Р — отгрузка. Плиты и жёлто-чёрная разметка у края
  for (const d of Object.values(DOCKS)) {
    const r = d.rect, X = r.x * PT, Y = r.y * PT, w = r.w * PT, h = r.h * PT;
    R(X, Y, w, h, '#9aa0a8'); for (let k = 0; k < w; k += 4) R(X + k, Y + h - 3, 2, 3, '#f2c230');
    ptext(d.label, X + 2, Y + 2, '#ffd84a');
  }
  // Мебель и склад материалов
  for (const d of DECOR) {
    const X = d.x * PT, Y = d.y * PT, w = d.w * PT, h = d.h * PT;
    if (d.id === 'regal') { box(X, Y, w, h, '#8a6038'); for (let k = 0; k < d.w * 3; k++) { const c = ['#3b7bd4', '#d84a4a', '#f2c230', '#5aa54a'][k % 4]; box(X + 2 + k * 4, Y + 3, 4, 6, c); box(X + 2 + k * 4, Y + 13, 4, 6, ['#d84a4a', '#5aa54a', '#3b7bd4', '#f2c230'][k % 4]); } ptext('LAGER', X + 2, Y - 7, '#fff'); }
    else if (d.id === 'kaffee') { box(X + 1, Y, 10, 12, '#3a2c2a'); R(X + 3, Y + 2, 6, 3, '#9fd3ff'); R(X + 8, Y + 8, 2, 2, '#ff4d4d'); R(X + 4, Y + 8, 3, 3, '#f5f5f5'); }
    else if (d.id === 'tisch') { box(X, Y, w, h, '#b07a45'); R(X + 4, Y + 4, 4, 3, '#f5f5f5'); R(X + w - 9, Y + 4, 4, 3, '#f5f5f5'); }
    else if (d.id === 'desk') { box(X, Y, w, h, '#5a5f7a'); box(X + 4, Y + 1, 10, 8, '#222'); R(X + 6, Y + 3, 6, 4, '#62e08a'); }
    else if (d.id === 'schrott') { for (let c = 0; c < d.w; c += 4) { box(X + c * PT, Y, 4 * PT - 2, h, '#c0392b'); for (let k = 3; k < 4 * PT - 4; k += 4) R(X + c * PT + k, Y + 2, 1, h - 4, '#8e2a20'); R(X + c * PT + 3, Y + 3, 4 * PT - 8, 5, '#2a1d1b'); } ptext('CONTAINER', X, Y - 7, '#ff9a8a'); }
    else if (d.id === 'rohgummi') { box(X, Y, w, h, '#5a4a3a'); for (let k = 0; k < 4; k++) { disc(X + 6 + (k % 2) * 12, Y + 6 + (k >> 1) * 12, 5, OUT); disc(X + 6 + (k % 2) * 12, Y + 6 + (k >> 1) * 12, 4, '#26262c'); disc(X + 6 + (k % 2) * 12, Y + 6 + (k >> 1) * 12, 1, '#8a6038'); } ptext('ROH', X + 2, Y - 7, '#fff'); }
    else if (d.id === 'm1' || d.id === 'm2') { box(X, Y, w, h, '#4a4f57'); R(X + 2, Y + 3, w / 2 - 3, h - 6, '#2a2d34'); if (d.id === 'm2') for (let k = 0; k < 3; k++) { disc(X + w / 2 + 5 + k * 7, Y + h / 2, 3, OUT); disc(X + w / 2 + 5 + k * 7, Y + h / 2, 2, '#3b7bd4'); } else for (let k = 0; k < 6; k++) R(X + w / 2 + 2 + k * 3, Y + 4 + (k % 2) * 6, 2, 4, k % 2 ? '#c9ced8' : '#f5f5f5'); ptext(d.label, X + 2, Y - 7, '#ffd84a'); }
    else if (d.id === 'autoklav1') { box(X + 2, Y + 3, w - 4, h - 6, '#4a7db0'); disc(X + 7, Y + h / 2, 7, OUT); disc(X + 7, Y + h / 2, 6, '#6d9cc9'); ptext('AUTOKLAV', X + 14, Y + 5, '#fff'); }
    else if (d.id === 'kpresse') { box(X + 1, Y + 1, w - 2, h - 2, '#6b5a8a'); disc(X + w / 2, Y + h / 2, 6, OUT); disc(X + w / 2, Y + h / 2, 5, '#8d96a3'); disc(X + w / 2, Y + h / 2, 2, '#2a2a30'); }
    else if (d.id !== 'werkbank') { box(X, Y, w, h, d.color); if (d.label) ptext(d.label, X + 2, Y + 2, '#fff'); }
    else if (d.id === 'werkbank') {
      // верстак техника: тиски, ключи на щите, запчасти
      R(X, Y - 5, w, 5, '#8d8778'); for (let k = 2; k < w - 2; k += 3) R(X + k, Y - 4, 1, 3, k % 2 ? '#c9ced8' : '#e0a862');
      box(X, Y, w, h, '#8a6038'); R(X + 1, Y + 1, w - 2, 2, '#a57a4a');
      box(X + 2, Y + 3, 6, 5, '#3c7fd8'); R(X + 3, Y + 2, 4, 1, '#9aa3ad');
      for (let k = 0; k < 3; k++) disc(X + 16 + k * 4, Y + 7, 1, '#6b7280');
      ptext('WERKSTATT', X - 2, Y - 12, '#ffd84a');
    }
    if (d.id === 'werkbank') { /* нарисован выше */ }
  }
  // стоянка погрузчиков
  for (const f of V.S.forks || []) { const X = f.home.x * PT - 6, Y = f.home.y * PT - 10; R(X, Y, 24, 1, '#f2c230'); R(X, Y + 24, 24, 1, '#f2c230'); R(X, Y, 1, 25, '#f2c230'); R(X + 23, Y, 1, 25, '#f2c230'); ptext('P' + f.id, X + 2, Y + 2, '#f2c230', null); }
  for (const [sx, sy] of SEATS) box(sx * PT + 3, sy * PT + 3, 6, 6, '#7a5230');
  g = keep;
}

// ---------- станки ----------
const COL = { pruef: '#3c7fd8', rauen: '#f2b230', ausschl: '#9a6ad6', spray: '#2bb3a3', fuellen: '#86b83a', aufbau: '#e38438', presse: '#5d6470', entgr: '#d4673a', nacharb: '#c2435a', scan: '#3c7fd8', endk: '#3c7fd8' };
const LABEL = { eingang: 'EINGANG', pruef: 'PRÜF', sort: 'KARKASSEN', aufh: 'AUFH', rauen: 'RAUEN', ausschl: 'SCHL', spray: 'LÖSUNG', fuellen: 'SPACH', aufbau: 'AUFBAU', puffer: 'WAGEN', presse: 'P', entgr: 'TRIM', nacharb: 'NACHARB', scan: 'SCAN', endk: 'KONTR', fertig: 'FERTIG' };
function label(s, X, Y, Wp) {
  const multi = V.STATIONS.filter(o => o.g === s.g).length > 1;
  let base = LABEL[s.g] || s.g; const suf = multi ? s.id.replace(/^\D+/, '') : '';
  while (base.length > 1 && textW(base + suf) > Wp - 3) base = base.slice(0, -1);
  ptext(base + suf, X + 2, Y + 2, '#fff');
}
function pile(ids, X, Y, Wp, Hp) {
  const per = Math.max(1, Math.floor((Wp - 2) / 8)); let k = 0;
  for (const id of ids) { const t = V.S.tires.get(id); if (!t) continue; const x = X + 1 + (k % per) * 8, y = Y + Hp - 8 - Math.floor(k / per) * 5; if (y < Y + 7) break; tire(x, y, NEW(t)); k++; }
}
// Сломанный станок: темнеет, дымит, мигает знак; у техника — оранжевая полоска ремонта
const WARN = ['....#....', '...#y#...', '...#y#...', '..#yky#..', '..#yky#..', '.#yyyyy#.', '.#yykyy#.', '#########'];
function warnSign(x, y) { WARN.forEach((r, j) => { for (let i = 0; i < 9; i++) if (r[i] !== '.') R(x + i, y + j, 1, 1, r[i] === '#' ? OUT : r[i] === 'k' ? OUT : '#ffd24a'); }); }
function brokenFx(s, X, Y, Wp, Hp) {
  const b = s.broken; if (!b) return;
  g.fillStyle = 'rgba(25,10,10,.38)'; g.fillRect(X + 1, Y + 1, Wp - 2, Hp - 2);
  for (let k = 0; k < 4; k++) { const ph = (time * 0.55 + k / 4) % 1; disc(X + Wp / 2 + Math.round(Math.sin(k * 2.1 + time) * 3 + ph * 5), Y + 1 - Math.round(ph * 16), 1 + Math.floor(ph * 3), `rgba(60,60,66,${(0.8 - ph * 0.75).toFixed(2)})`); }
  if (Math.floor(time * 3) % 2 || b.tech) warnSign(X + Wp / 2 - 4, Y + Hp / 2 - 5);
  if (b.tech) { R(X + 1, Y - 4, Wp - 2, 3, OUT); R(X + 2, Y - 3, Math.round((Wp - 4) * Math.min(1, b.done / b.need)), 1, '#ff9f1a'); }
}
function dust(s) {
  if (!(s.dirt > 0.04)) return;
  const n = Math.round(s.dirt * 22), seed = s.x * 31 + s.y * 7;
  for (let k = 0; k < n; k++) { const a = hash(k, seed), b = hash(seed, k * 3 + 1); R(s.ax * PT - PT * 0.6 + a * PT * 2.2, s.ay * PT + 1 + b * (PT - 3), a > 0.7 ? 2 : 1, 1, k % 3 ? '#77705f' : '#57503f'); }
}
function drawStation(s) {
  const S = V.S, X = s.x * PT, Y = s.y * PT, Wp = s.w * PT, Hp = s.h * PT, c = COL[s.g] || '#8a6038', blink = Math.floor(time * 3) % 2;
  dust(s);
  if (s.kind === 'store') {
    R(X, Y, Wp, Hp, '#7a5a38'); for (let k = 0; k < Hp; k += 4) R(X, Y + k, Wp, 1, '#946c42'); R(X, Y, 1, Hp, OUT); R(X + Wp - 1, Y, 1, Hp, OUT);
    label(s, X, Y, Wp); pile(s.items, X + 1, Y + 6, Wp - 2, Hp - 6); return;
  }
  if (s.g === 'presse') { // пресс с формой: шину раздувает внутри; сверху поворотный кран
    const lamp = s.state === 'running' ? (blink ? '#ff5a2a' : '#c03a1a') : s.state === 'done' ? '#5ad65a' : '#7a8088', mx = X + Wp / 2, my = Y + Hp / 2 + 1;
    R(X + 1, Y + Hp - 2, Wp - 2, 2, 'rgba(0,0,0,.25)');
    box(X, Y + 1, Wp, Hp - 2, '#5d6470'); disc(mx, my, 9, OUT); disc(mx, my, 8, s.state === 'running' ? '#b85a34' : '#8d96a3'); disc(mx, my, 4, '#2a2a30');
    if (s.items.length && s.state !== 'running') tire(mx - 3, my - 3, s.state === 'done');
    R(X + 1, Y + 2, 4, 4, OUT); R(X + 2, Y + 3, 2, 2, lamp);
    if (s.state === 'running') { const m = String(Math.ceil(s.timer)); ptext(m, X + Wp - textW(m) - 1, Y + Hp - 7, '#ffb347'); for (let k = 0; k < 2; k++) { const ph = (time * 0.8 + k / 2) % 1; R(mx - 4 + k * 6, Y - ph * 9, 2, 2, `rgba(255,255,255,${(0.7 - ph * 0.7).toFixed(2)})`); } }
    const lift = S.workers.some(w => w.act === 'crane' && w.job && (w.job.src === s.id || w.job.dst === s.id));
    R(X + Wp - 2, Y - 8, 2, 10, '#c9a227'); R(mx - 2, Y - 8, Wp / 2 + 2, 2, '#f2c230'); // кран: стойка и стрела
    if (lift) { const d = Math.round(4 + Math.sin(time * 3) * 3); R(mx, Y - 6, 1, d + 2, '#2a2a30'); tire(mx - 3, Y - 4 + d, true); }
    ptext('P' + s.id.replace(/^\D+/, ''), X + 6, Y - 7, '#fff');
    brokenFx(s, X, Y, Wp, Hp);
    return;
  }
  if (s.kind === 'auto') {
    R(X + 2, Y + Hp - 3, Wp - 4, 3, 'rgba(0,0,0,.25)');
    box(X + 4, Y + 3, Wp - 8, Hp - 7, c); R(X + 6, Y + 6, Wp - 12, 2, shade(c, 0.5));
    for (let k = X + 10; k < X + Wp - 8; k += 8) R(k, Y + 4, 1, Hp - 9, shade(c, -0.25));
    disc(X + 7, Y + Hp / 2 - 1, Math.min(9, Hp / 2 - 4), OUT); disc(X + 7, Y + Hp / 2 - 1, Math.min(8, Hp / 2 - 5), shade(c, 0.15)); disc(X + 7, Y + Hp / 2 - 1, 3, '#2a3a4a');
    const lamp = s.state === 'running' ? (blink ? '#ff5a2a' : '#c03a1a') : s.state === 'done' ? '#5ad65a' : '#7a8088';
    R(X + Wp - 10, Y + 1, 4, 4, OUT); R(X + Wp - 9, Y + 2, 2, 2, lamp);
    const disp = s.state === 'running' ? `${Math.ceil(s.timer)}M` : s.state === 'done' ? 'OK' : `${s.items.length}/${s.cap}`;
    R(X + Wp - 26, Y + Hp - 13, 22, 9, '#0f1a14'); ptext(disp, X + Wp - 24, Y + Hp - 11, s.state === 'running' ? '#ffb347' : '#62e08a', null);
    if (s.state === 'running') for (let k = 0; k < 3; k++) { const ph = (time * 0.8 + k / 3) % 1; R(X + 14 + k * 12, Y - ph * 10, 3, 2, `rgba(255,255,255,${0.7 - ph * 0.7})`); }
    label(s, X + 14, Y + 2, Wp - 30);
    brokenFx(s, X, Y, Wp, Hp);
    return;
  }
  // обычный станок: плита, корпус, детали
  R(X, Y, Wp, Hp, '#a49f92'); for (let k = 0; k < Wp; k += 4) R(X + k, Y + Hp - 2, 2, 2, '#f2c230');
  box(X + 1, Y + 1, Wp - 2, Hp - 5, c);
  const cx = X + Wp / 2 | 0, cy = Y + Hp / 2 - 1 | 0, work = !!s.cur;
  if (s.g === 'rauen') { disc(X + Wp - 6, cy + 2, 4, OUT); disc(X + Wp - 6, cy + 2, 3, '#b8c0ca'); const a = work ? time * 20 : 0; R(X + Wp - 6 + Math.round(Math.cos(a) * 2), cy + 2 + Math.round(Math.sin(a) * 2), 1, 1, OUT); R(X + Wp - 4, Y + 1, 2, 5, '#c9a227'); }
  else if (s.g === 'pruef' || s.g === 'endk') { R(cx - 8, cy - 1, 3, 6, '#ffd24a'); R(cx + 5, cy - 1, 3, 6, '#ffd24a'); if (s.g === 'endk') { box(X + Wp - 9, Y + 3, 8, 6, '#222'); R(X + Wp - 7, Y + 5, 4, 2, '#62e08a'); } }
  else if (s.g === 'spray') { R(X + 2, Y + 2, Wp - 4, Hp - 8, 'rgba(180,240,255,.35)'); const a = time * 8; disc(X + Wp - 6, Y + 6, 3, '#d8e6f0'); R(X + Wp - 6 + Math.round(Math.cos(a) * 2), Y + 6 + Math.round(Math.sin(a) * 2), 1, 1, OUT); if (work) for (let k = 0; k < 6; k++) R(cx - 6 + hash(k, time * 10 | 0) * 12, cy - 4 + hash(time * 10 | 0, k) * 8, 1, 1, '#eaf6ff'); }
  else if (s.g === 'fuellen') { R(X + 3, cy + 3, 9, 3, '#6b7280'); R(X + 12, cy + 3, 2, 2, work && blink ? '#ff7a2a' : '#ffb347'); }
  else if (s.g === 'aufbau') { // намотка: барабан крутится, экструдер подаёт ленту сырой резины
    const a = work ? time * 6 : 0; disc(X + Wp - 8, cy + 1, 6, OUT); disc(X + Wp - 8, cy + 1, 5, '#2a2a2e'); R(X + Wp - 8 + Math.round(Math.cos(a) * 3), cy + 1 + Math.round(Math.sin(a) * 3), 1, 1, '#8a8f98');
    box(X + 3, cy - 3, 7, 6, '#e0a862'); R(X + 10, cy, Wp - 22, 2, '#1e1e22'); if (work) for (let k = 0; k < Wp - 22; k += 3) R(X + 10 + ((k + Math.floor(time * 12)) % (Wp - 22)), cy, 1, 2, '#55555e');
  }
  else if (s.g === 'ausschl') { R(X + 3, cy + 3, Wp - 6, 2, '#8a6038'); R(X + 4, cy, 5, 2, '#9aa3ad'); if (work && blink) R(X + 9, cy - 1, 1, 1, '#ffe066'); }
  else if (s.g === 'entgr') { // вращающийся станок обрезки облоя
    const a = work ? time * 5 : 0; disc(cx - 2, cy + 1, 6, OUT); disc(cx - 2, cy + 1, 5, '#5d6470'); R(cx - 2 + Math.round(Math.cos(a) * 4), cy + 1 + Math.round(Math.sin(a) * 4), 1, 1, '#ffe066'); R(X + Wp - 5, cy - 3, 2, 7, '#c9ced8');
  }
  else if (s.g === 'scan') { R(X + 3, Y + 3, Wp - 6, Hp - 8, '#222'); if (S.t - s.lastScan < 0.8 || blink) R(X + 2, Y + Hp - 4, Wp - 4, 1, '#ff3030'); }
  label(s, X, Y, Wp);
  if (s.cur) tire(cx - 3, cy - 2, false);
  s.input.forEach((id, k) => tire(X + 1 + k * 5, Y + Hp - 9, false));
  s.out.forEach((id, k) => { const t = S.tires.get(id); tire(X + Wp - 8 - k * 5, Y + Hp - 9, NEW(t)); if (t && t.readyAt > S.t) R(X + Wp - 6 - k * 5, Y + Hp - 12, 3, 1, '#7fd6ff'); });
  if (!V.matsOk(s) && s.input.length && blink) ptext('!', X + Wp - 5, Y + 1, '#ff5050');
  if (S.t - s.lastScan < 0.6) R(X + Wp - 4, Y + Hp - 6, 3, 2, '#ff3030'); // сканер штрихкода сработал
  if (s.kind === 'proc' && s.input.length >= s.inCap && !s.cur && blink) { R(X, Y, Wp, 1, '#ff5050'); R(X, Y + Hp - 1, Wp, 1, '#ff5050'); R(X, Y, 1, Hp, '#ff5050'); R(X + Wp - 1, Y, 1, Hp, '#ff5050'); }
  brokenFx(s, X, Y, Wp, Hp);
}
function progress(s) {
  if (!(s.prog > 0 && (s.cur || s.kind === 'auto'))) return;
  const X = s.x * PT, Y = s.y * PT - 3, Wp = s.w * PT; R(X + 1, Y, Wp - 2, 3, OUT); R(X + 2, Y + 1, (Wp - 4) * Math.min(1, s.prog), 1, '#62e08a');
}
function brackets(X, Y, w, h) { const c = '#ffb020'; for (const [x, y, dx, dy] of [[X, Y, 1, 1], [X + w - 1, Y, -1, 1], [X, Y + h - 1, 1, -1], [X + w - 1, Y + h - 1, -1, -1]]) { R(Math.min(x, x + dx * 3), y, 4, 1, c); R(x, Math.min(y, y + dy * 3), 1, 4, c); } }

// ---------- грузовик ----------
function truck(tr) {
  if (tr.x < -3 || tr.x > V.MW + 3) return;
  const L = 56, Wd = 20, cx = Math.round(tr.x * PT + PT / 2), cy = Math.round(tr.y * PT + PT / 2);
  g.save(); g.translate(cx, cy); g.rotate(tr.ang || 0);
  const x0 = -L / 2, y0 = -Wd / 2;
  for (const wx of [x0 + 6, x0 + 14, x0 + 34, x0 + 48]) { R(wx, y0 - 1, 5, 2, OUT); R(wx, y0 + Wd - 1, 5, 2, OUT); }
  box(x0, y0, 42, Wd, '#e9ecef'); for (let k = x0 + 6; k < x0 + 40; k += 6) R(k, y0 + 2, 1, Wd - 4, '#cfd4da'); R(x0 + 1, y0 + Wd / 2 - 1, 40, 2, tr.color);
  box(x0 + 43, y0 + 1, 13, Wd - 2, tr.color); R(x0 + 52, y0 + 3, 3, Wd - 6, '#9fd3ff'); R(x0 + 46, y0 + 3, 4, 2, shade(tr.color, 0.4));
  g.restore();
  ptext(`${tr.kind === 'deliver' ? 'IN' : 'OUT'} ${tr.cargo.length}`, cx - 14, cy - 3, '#1e1c26', null);
}

// ---------- погрузчик (Stapler) ----------
function flatTires(x, y, n) { for (let k = 0; k < n; k++) { const yy = y - k * 3; R(x, yy, 9, 3, OUT); R(x + 1, yy + 1, 7, 1, '#4a4a52'); R(x + 3, yy + 1, 3, 1, '#26262c'); } }
// Вид сбоку, смотрит вправо (face = −1 — зеркально). driver — спрайт сидящего водителя.
function forklift(px, py, face, driver, load) {
  g.save(); g.translate(px, py); g.scale(face, 1);
  R(-12, 0, 30, 3, 'rgba(0,0,0,.28)');
  const n = load ? load.length : 0, lift = n ? -3 : 0;
  R(7, -23, 3, 24, '#3a3d47'); R(7, -23, 1, 24, '#5d6270');           // мачта
  R(10, lift, 9, 1, '#9aa0ad'); R(10, lift - 1, 1, 2, OUT);           // вилы
  if (n) flatTires(10, lift - 3, n);
  if (driver) g.drawImage(driver, -9, -26);
  box(-12, -10, 20, 10, '#f2b230'); R(-11, -9, 4, 8, '#c98a14'); R(-2, -9, 7, 2, '#ffd36a'); // корпус, противовес
  disc(-7, 0, 2, OUT); disc(4, 0, 2, OUT); R(-7, 0, 1, 1, '#888'); R(4, 0, 1, 1, '#888');   // колёса
  R(-11, -29, 1, 19, OUT); R(5, -29, 1, 19, OUT); R(-12, -30, 19, 2, '#3a3d47');            // защитная крыша
  if (driver) R(-4, -32, 3, 2, Math.floor(time * 4) % 2 ? '#ff9f1a' : '#9a5200');           // маячок
  g.restore();
}

// ---------- люди ----------
const prevPos = new Map(), facing = new Map();
// Инструмент в руке по участку: лампа, шлифмашинка, распылитель, пистолет-экструдер, ролик…
const TOOL_G = { pruef: 'lamp', endk: 'tablet', rauen: 'pendant', ausschl: 'grinder', entgr: 'knife', spray: 'spray', fuellen: 'extruder', aufbau: 'pendant', scan: 'scangun' };
function toolOf(w) {
  const j = w.job; if (!j || w.state === 'break') return null;
  if (w.act === 'crane') return 'pendant';                 // пульт крана у пресса
  if (j.type === 'fetch') return w.tool === 'canister' ? 'canister' : null;
  if (j.type === 'repair') return w.act === 'repair' ? 'wrench' : w.tool ? 'toolbox' : null;
  if (j.type === 'idle') return j.act === 'sweep' ? 'broom' : j.act === 'inspect' ? 'clipboard' : w.state === 'act' ? (j.act === 'coffee' ? 'cup' : 'hands') : null;
  if (j.type === 'start') return w.state === 'work' ? 'hands' : null;
  if (j.type === 'work') return w.state === 'work' ? TOOL_G[j.st.g] || 'hands' : null;
  return null;
}
const SPARK = ['#fff3a0', '#ffd24a', '#ff9f1a'];
// Локальные координаты: ноги в (0,0), рука около (5,−8), человечек смотрит вправо
function drawTool(tool, on, t) {
  const f2 = Math.floor(t * 8) % 2, rr = k => hash(k, Math.floor(t * 12) + 7);
  switch (tool) {
    case 'extruder': { // большой пистолет-экструдер: корпус, бункер со шнуром Füllgummi, ручка, горячее сопло, кабель
      R(4, -7, 3, 6, '#2a2a30');
      box(1, -14, 13, 7, '#8d96a3'); R(2, -13, 11, 1, '#c3cad3'); R(3, -10, 3, 2, '#ff6b4a');
      box(4, -19, 6, 6, '#5a6170'); R(5, -21, 4, 2, '#1e1e22');
      R(14, -12, 4, 3, '#4a5260'); R(14, -12, 4, 1, '#6b7486');
      const hot = on ? (f2 ? '#ff7a2a' : '#ffb347') : '#9a6a4a';
      R(18, -12, 2, 3, hot); if (on) R(20, -11, 1, 1, '#ffe0a0');
      R(0, -9, 1, 9, '#222'); R(-2, 0, 3, 1, '#222');
      if (on) { const ph = (t * 1.6) % 1; R(19, -9 + Math.floor(ph * 6), 2, 2, '#1e1e22'); }
      break;
    }
    case 'grinder': {
      box(3, -11, 9, 5, '#3c7fd8'); R(4, -10, 7, 1, '#7fb0f0'); R(5, -7, 2, 3, '#2a2a30');
      R(12, -13, 2, 9, '#c9ced8'); R(12, -13, 1, 9, '#ffffff');
      if (on) for (let k = 0; k < 8; k++) { const a = rr(k), b = rr(k + 9); R(14 + a * 8, -9 + b * 9, 1, 1, SPARK[k % 3]); }
      break;
    }
    case 'spray': case 'paint': {
      box(3, -11, 8, 4, '#8a8f98'); R(5, -7, 2, 4, '#2a2a30'); box(4, -16, 5, 6, tool === 'spray' ? '#d8e6f0' : '#30323a'); R(11, -10, 2, 1, OUT);
      if (on) for (let k = 0; k < 12; k++) { const a = rr(k), b = rr(k + 5); R(13 + a * 9, -10 + (b - 0.5) * (1 + a * 8), 1, 1, tool === 'spray' ? 'rgba(225,245,255,.8)' : 'rgba(40,40,46,.75)'); }
      break;
    }
    case 'roller': { const dy = on ? Math.round(Math.sin(t * 9) * 2) : 0; R(5, -9, 7, 1, '#7a5230'); R(4, -9, 2, 4, '#7a5230'); box(11, -12 + dy, 5, 8, '#2a2a2e'); R(12, -11 + dy, 1, 6, '#55555e'); break; }
    case 'lamp': {
      box(3, -11, 7, 5, '#ffd24a'); R(4, -7, 2, 3, '#2a2a30'); R(9, -10, 1, 3, '#fffbe0');
      if (on) { g.fillStyle = 'rgba(255,240,150,.33)'; for (let k = 0; k < 12; k++) g.fillRect(10 + k, Math.round(-10 - k * 0.4), 1, Math.round(3 + k * 0.8)); }
      break;
    }
    case 'tablet': box(3, -13, 8, 7, '#222'); R(4, -12, 6, 5, on && f2 ? '#62e08a' : '#3fa060'); break;
    case 'clipboard': box(3, -13, 7, 9, '#a57a4a'); R(4, -12, 5, 7, '#f5f5f5'); R(5, -11, 2, 1, '#888'); R(5, -9, 3, 1, '#888'); R(5, -7, 2, 1, '#888'); if (on) R(9, -10 + f2, 1, 3, '#3b7bd4'); break;
    case 'pendant': box(3, -13, 6, 8, '#f2c230'); R(4, -11, 1, 1, '#ff4d4d'); R(6, -11, 1, 1, '#5ad65a'); R(4, -9, 4, 1, OUT); R(6, -22, 1, 9, '#222'); break;
    case 'wrench': { // ключ крутит болт, рядом открытый ящик с инструментами
      box(9, -6, 10, 7, '#c0392b'); R(11, -7, 6, 1, OUT); R(10, -3, 8, 1, '#8e2a20'); R(11, -5, 2, 1, '#c9ced8'); R(15, -5, 2, 1, '#ffd24a');
      if (f2) { R(5, -16, 2, 9, '#c9ced8'); R(4, -18, 4, 2, '#c9ced8'); R(5, -18, 2, 1, OUT); }
      else { R(5, -10, 9, 2, '#c9ced8'); R(14, -11, 2, 4, '#c9ced8'); R(14, -10, 1, 2, OUT); }
      if (on && rr(1) > 0.6) R(13 + rr(2) * 3, -14, 1, 1, '#ffe066');
      break;
    }
    case 'toolbox': box(2, -8, 10, 7, '#c0392b'); R(4, -9, 6, 1, OUT); R(3, -5, 8, 1, '#8e2a20'); break;
    case 'broom': {
      const sw = on ? (f2 ? 2 : -1) : 0;
      for (let k = 0; k < 13; k++) R(5 + Math.round(k * (0.45 + sw * 0.06)), -14 + k, 1, 1, '#8a5a2a');
      R(8 + sw, -2, 8, 2, '#d9b25a'); R(8 + sw, 0, 8, 1, '#b08a3a');
      if (on) for (let k = 0; k < 3; k++) { const ph = (t * 1.5 + k / 3) % 1; R(15 + ph * 5 + sw, -1 - ph * 5, 2, 2, `rgba(120,110,95,${(0.7 - ph * 0.6).toFixed(2)})`); }
      break;
    }
    case 'scangun': box(3, -11, 7, 4, '#2a2a30'); R(5, -7, 2, 4, '#2a2a30'); R(10, -10, 1, 2, '#ff3030'); if (on && f2) { g.fillStyle = 'rgba(255,40,40,.55)'; g.fillRect(11, -10, 9, 1); } break;
    case 'knife': R(4, -9, 3, 3, '#7a5230'); R(7, -9, 6, 1, '#e0e4ea'); R(12, -10, 1, 2, '#e0e4ea'); if (on && f2) R(14, -8, 1, 1, '#ffe066'); break;
    case 'canister': box(2, -9, 8, 9, '#3b7bd4'); R(4, -10, 4, 1, OUT); R(3, -7, 6, 1, '#7fb0f0'); break;
    case 'cup': R(4, -10, 3, 4, '#f5f5f5'); R(7, -9, 1, 2, '#f5f5f5'); if (on) for (let k = 0; k < 2; k++) { const ph = (t + k / 2) % 1; R(5, -12 - ph * 6, 1, 2, `rgba(255,255,255,${(0.7 - ph * 0.7).toFixed(2)})`); } break;
  }
}
function drawWorker(w) {
  const S = V.S, px = Math.round(w.x * PT + PT / 2), py = Math.round(w.y * PT + PT / 2 + 4);
  const prev = prevPos.get(w.id), dx = prev ? w.x - prev[0] : 0, moving = !!prev && Math.hypot(dx, w.y - prev[1]) > 0.0005; prevPos.set(w.id, [w.x, w.y]);
  let face = facing.get(w.id) || 1;
  if (moving && Math.abs(dx) > 0.0004) face = dx > 0 ? 1 : -1;
  const j = w.job, st = j && j.st;
  if (!moving && st && st.w && (w.state === 'work' || w.state === 'act')) { const c = st.x + st.w / 2 - 0.5; if (Math.abs(c - w.x) > 0.6) face = c > w.x ? 1 : -1; }
  facing.set(w.id, face);
  const hair = HAIRS[w.id % HAIRS.length], skin = SKINS[(w.id * 7) % SKINS.length], nm = w.name.split(' ')[0];
  if (w.mounted) { // за рулём погрузчика
    forklift(px, py, face, person(hair, skin, w.color, 'sit', null), w.load);
    if (S.selected && S.selected.w === w) brackets(px - 14, py - 33, 34, 37);
    ptext(nm, px - textW(nm) / 2, py + 4, '#f4f4f4'); return;
  }
  const tool = w.carry ? null : toolOf(w), grab = w.act === 'grab';
  const on = !grab && (w.state === 'work' || w.state === 'act');
  const pose = w.state === 'break' ? 'sit' : moving && Math.floor(time * 7) % 2 ? 'walk' : 'stand';
  const cart = !!(j && j.type === 'haul' && j.cart);
  const arms = w.carry && !cart ? 'carry' : (tool === 'hands' && on && Math.floor(time * 4) % 2) || (grab && Math.floor(time * 5) % 2) ? 'up' : null;
  const sp = person(hair, skin, w.color, pose, arms), bob = pose === 'walk' ? -1 : 0;
  g.save(); g.translate(px, py); g.scale(face, 1);
  R(-6, 0, 12, 2, 'rgba(0,0,0,.28)');
  g.drawImage(sp, -7, -sp.height + 1 + bob);
  if (tool && tool !== 'hands') { g.save(); g.translate(0, bob + (grab ? 3 : 0)); drawTool(tool, on, time + w.id * 0.37); g.restore(); }
  if (cart) { // тележка (Rollwagen) с шинами стопкой
    R(6, -11, 1, 8, '#5d6270'); box(7, -5, 15, 4, '#8d96a3'); disc(9, 0, 1, OUT); disc(20, 0, 1, OUT);
    if (w.load) flatTires(9, -8, w.load.length);
  }
  g.restore();
  if (w.carry && !cart) { const t = S.tires.get(w.carry); tire(px - 3, py - 11 + bob, NEW(t)); }
  if (w.state === 'break') { const ph = (time * 0.7 + w.id * 0.13) % 1; ptext('Z', px + 4 + ph * 3, py - 22 - ph * 6, '#ffffff'); }
  if (w.energy < 28 && w.state !== 'break' && Math.floor(time * 2) % 2) ptext('!', px + 6, py - 23, '#ff5050');
  if (S.selected && S.selected.w === w) brackets(px - 9, py - 21, 18, 24);
  ptext(nm, px - textW(nm) / 2, py + 3, '#f4f4f4');
}

// ---------- кадр ----------
const LAMPS = [];
let camInit = false;
function render(view) {
  V = view; time = performance.now() / 1000;
  const { MW, MH, S, STATIONS, LOOP, HOOKS, loopPos, ctx, TILE } = V;
  if (!camInit) { camInit = true; if (V.CAM) { cam.z = V.CAM.z; cam.cx = V.CAM.cx * PT; cam.cy = V.CAM.cy * PT; } clampCam(); }
  if (!pc) { pc = document.createElement('canvas'); pc.width = MW * PT; pc.height = MH * PT; lightCanvas = document.createElement('canvas'); lightCanvas.width = pc.width; lightCanvas.height = pc.height; for (let y = 11; y < MH - 2; y += 6) for (let x = 4; x < MW - 2; x += 7) if (V.grid[V.I(x, y)] === V.T_FLOOR) LAMPS.push([x * PT, y * PT]); }
  if (!bgCanvas) buildBackground();
  g = pc.getContext('2d'); g.imageSmoothingEnabled = false;
  g.drawImage(bgCanvas, 0, 0);
  for (const s of STATIONS) drawStation(s);
  if (S.selected && S.selected.st) { const s = S.selected.st; brackets(s.x * PT - 1, s.y * PT - 1, s.w * PT + 2, s.h * PT + 2); }
  // сканер Ж4: красный луч, когда через него прокатили шину
  const scn = V.DECOR.find(d => d.id === 'scanner');
  if (scn) { const X = scn.x * PT, Y = scn.y * PT; R(X + 3, Y + 2, scn.w * PT - 6, 6, '#16181d'); if (S.t - scn.lastScan < 0.8) { R(X + 1, Y + PT - 2, scn.w * PT - 2, 1, '#ff3030'); R(X + 4, Y + 4, 3, 2, '#ff3030'); } else R(X + 4, Y + 4, 2, 2, '#3fa060'); }
  // ящик с инструментами на верстаке, пока техник его не взял
  const wb = V.DECOR.find(d => d.id === 'werkbank');
  if (wb && !S.workers.some(w => !w.away && w.tool === 'kit')) { box(wb.x * PT + wb.w * PT - 13, wb.y * PT - 3, 10, 7, '#c0392b'); R(wb.x * PT + wb.w * PT - 11, wb.y * PT - 4, 6, 1, OUT); }
  // парковка: машины рабочих текущей смены
  const present = S.workers.filter(w => !w.away);
  const pz = V.ZONES.find(z => z.kind === 'parking');
  if (pz) present.slice(0, Math.floor(pz.w / 2)).forEach((w, k) => { const X = pz.x * PT + 4 + k * 2 * PT, Y = pz.y * PT + 4 + (k % 2) * PT; box(X, Y, 14, 9, w.color); R(X + 3, Y + 2, 3, 5, '#9fd3ff'); R(X + 10, Y + 2, 2, 5, shade(w.color, -0.3)); });
  // кольцо Hängebahn и его привод
  if (S.hook) {
    const P = p => [Math.round(p.x * PT + PT / 2), Math.round(p.y * PT + PT / 2)];
    LOOP.forEach((p, i) => { const q = LOOP[(i + 1) % LOOP.length], [x1, y1] = P(p), [x2, y2] = P(q); R(Math.min(x1, x2) - 1, Math.min(y1, y2) - 1, Math.abs(x2 - x1) + 3, Math.abs(y2 - y1) + 3, '#3d3f49'); R(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1) + 1, Math.abs(y2 - y1) + 1, '#9aa0ad'); });
    for (const s of STATIONS) { const [x, y] = P(loopPos(s.stopS)); R(x - 2, y - 2, 4, 4, '#ff9f1a'); }
    for (const h of HOOKS) {
      const [x, y] = P(loopPos(h.s)); R(x - 1, y - 1, 3, 3, '#e3b341');
      if (h.tire) { const t = S.tires.get(h.tire); R(x, y + 2, 1, 2, '#6b6b72'); tire(x - 3, y + 4, NEW(t)); }
    }
  }
  const d = V.HOOK_DRIVE;
  if (d) {
    const X = d.x * PT, Y = d.y * PT;
    box(X + 1, Y + 1, 10, 9, d.broken ? '#8a3a30' : '#5d6470'); disc(X + 6, Y + 5, 3, OUT); disc(X + 6, Y + 5, 2, '#b8c0ca');
    if (S.hook && !d.broken) { const a = time * 6; R(X + 6 + Math.round(Math.cos(a) * 2), Y + 5 + Math.round(Math.sin(a) * 2), 1, 1, OUT); }
    brokenFx(d, X, Y, PT, PT);
  }
  for (const tr of S.trucks) truck(tr);
  for (const s of STATIONS) progress(s);
  // свободные погрузчики на стоянке
  for (const f of S.forks || []) if (!f.by) forklift(Math.round(f.x * PT + PT / 2), Math.round(f.y * PT + PT / 2 + 4), 1, null, null);
  // люди — по глубине
  [...present].sort((a, b) => a.y - b.y).forEach(drawWorker);
  // счётчик лома
  const sc = V.DECOR.find(o => o.id === 'schrott'); if (sc) ptext(String(S.scrap), sc.x * PT + 4, sc.y * PT + 12, '#ffffff');
  // ночь и лампы
  const c = V.clock(); let dark = 0;
  if (c < V.DAY_START || c >= V.DAY_END) dark = 0.55; else if (c < V.DAY_START + 60) dark = 0.55 * (1 - (c - V.DAY_START) / 60); else if (c > V.DAY_END - 60) dark = 0.55 * ((c - (V.DAY_END - 60)) / 60);
  if (dark > 0) {
    const lg = lightCanvas.getContext('2d'); lg.globalCompositeOperation = 'source-over'; lg.clearRect(0, 0, pc.width, pc.height);
    lg.fillStyle = `rgba(14,18,48,${dark})`; lg.fillRect(0, 0, pc.width, pc.height);
    lg.globalCompositeOperation = 'destination-out';
    const keep = g; g = lg;
    for (const [lx, ly] of LAMPS) for (const [r, a] of [[30, 0.25], [22, 0.25], [14, 0.3]]) { g.fillStyle = `rgba(0,0,0,${a})`; for (let dy = -r; dy <= r; dy++) { const dx = Math.floor(Math.sqrt(r * r - dy * dy)); g.fillRect(lx - dx, ly + dy, dx * 2 + 1, 1); } }
    g = keep; lg.globalCompositeOperation = 'source-over';
    g.drawImage(lightCanvas, 0, 0);
  }
  const [sx, sy, sw, sh] = viewRect();
  ctx.save(); ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, MW * TILE, MH * TILE); ctx.drawImage(pc, sx, sy, sw, sh, 0, 0, MW * TILE, MH * TILE); ctx.restore();
}
window.PixelGfx = { render, reset: () => { bgCanvas = null; }, toTile, zoomAt, pan, cam };
})();
