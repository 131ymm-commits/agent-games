'use strict';
// Общий каркас для отдельных участков: холст, ввод, кнопки, модель шины, меню, результаты.
(() => {
const W = 960, H = 600;
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
let scale = 1;
function resize() {
  const wrap = document.getElementById('wrap'), dpr = window.devicePixelRatio || 1;
  scale = Math.min(wrap.clientWidth / W, wrap.clientHeight / H) || 1;
  cv.style.width = W * scale + 'px'; cv.style.height = H * scale + 'px';
  cv.width = Math.round(W * scale * dpr); cv.height = Math.round(H * scale * dpr);
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
}
window.addEventListener('resize', resize);

// ---------- случайность ----------
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const params = new URLSearchParams(location.search);
const rnd = mulberry32(Number(params.get('seed')) || (Date.now() % 1e9));
const R = (a, b) => a + rnd() * (b - a);
const RI = (a, b) => Math.floor(R(a, b + 1));
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- ввод ----------
const input = { x: W / 2, y: H / 2, down: false, pressed: false, released: false, keys: new Set(), keyPressed: new Set() };
function toLocal(e) { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale]; }
cv.addEventListener('mousemove', e => { [input.x, input.y] = toLocal(e); });
cv.addEventListener('mousedown', e => { [input.x, input.y] = toLocal(e); input.down = true; input.pressed = true; e.preventDefault(); });
window.addEventListener('mouseup', () => { if (input.down) { input.down = false; input.released = true; } });
cv.addEventListener('touchstart', e => { [input.x, input.y] = toLocal(e.touches[0]); input.down = true; input.pressed = true; e.preventDefault(); }, { passive: false });
cv.addEventListener('touchmove', e => { [input.x, input.y] = toLocal(e.touches[0]); e.preventDefault(); }, { passive: false });
cv.addEventListener('touchend', () => { input.down = false; input.released = true; });
window.addEventListener('keydown', e => { if (!input.keys.has(e.code)) input.keyPressed.add(e.code); input.keys.add(e.code); if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); });
window.addEventListener('keyup', e => input.keys.delete(e.code));

// ---------- рисование ----------
const FONT = 'system-ui, "Segoe UI", Roboto, sans-serif';
function text(s, x, y, o = {}) {
  ctx.font = `${o.bold ? 'bold ' : ''}${o.size || 14}px ${FONT}`;
  ctx.fillStyle = o.color || '#e7e7e7'; ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'alphabetic';
  ctx.fillText(s, x, y); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}
function wrap(s, x, y, maxW, o = {}) {
  const size = o.size || 14, lh = o.lh || size * 1.4;
  ctx.font = `${o.bold ? 'bold ' : ''}${size}px ${FONT}`; ctx.fillStyle = o.color || '#e7e7e7';
  for (const para of String(s).split('\n')) {
    if (!para.trim()) { y += lh * 0.5; continue; }
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, y); y += lh; line = word; } else line = test;
    }
    ctx.fillText(line, x, y); y += lh;
  }
  return y;
}
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function panel(x, y, w, h, bg = 'rgba(24,26,32,.94)') { ctx.fillStyle = bg; rr(x, y, w, h, 8); ctx.fill(); ctx.strokeStyle = '#3a3f4b'; ctx.lineWidth = 1; ctx.stroke(); }
const inside = (x, y, w, h) => input.x >= x && input.x <= x + w && input.y >= y && input.y <= y + h;
function button(x, y, w, h, label, o = {}) {
  const over = inside(x, y, w, h), active = over && !o.disabled && !G.locked;
  if (over) G.overUI = true;
  ctx.fillStyle = o.disabled ? '#22252b' : o.primary ? (active ? '#ffbb55' : '#f0a030') : o.danger ? (active ? '#c94a4a' : '#a33a3a') : o.on ? (active ? '#3f8f52' : '#2f7a42') : (active ? '#3b404c' : '#2c3039');
  rr(x, y, w, h, 6); ctx.fill(); ctx.strokeStyle = o.primary ? '#ffd28a' : '#4a505c'; ctx.lineWidth = 1; ctx.stroke();
  text(label, x + w / 2, y + h / 2 + 1, { size: o.size || 14, bold: true, align: 'center', base: 'middle', color: o.disabled ? '#666' : o.primary ? '#1a1a1a' : '#eee' });
  return active && input.pressed;
}
function bar(x, y, w, h, frac, color = '#62c370', bg = '#0e0f12') { ctx.fillStyle = bg; ctx.fillRect(x, y, w, h); ctx.fillStyle = color; ctx.fillRect(x, y, w * clamp(frac, 0, 1), h); }
// Шкала с зелёной зоной допуска
function gauge(x, y, w, label, val, min, max, okMin, okMax, unit, digits = 0) {
  const h = 12, f = v => x + (clamp(v, min, max) - min) / (max - min) * w;
  text(label, x, y - 6, { size: 12, color: '#aab' });
  ctx.fillStyle = '#0e0f12'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(98,195,112,.45)'; ctx.fillRect(f(okMin), y, f(okMax) - f(okMin), h);
  const ok = val >= okMin && val <= okMax;
  ctx.fillStyle = ok ? '#62c370' : '#e35d5d'; ctx.fillRect(f(val) - 2, y - 3, 4, h + 6);
  text(`${val.toFixed(digits)} ${unit}`, x + w + 8, y + 11, { size: 13, bold: true, color: ok ? '#62c370' : '#e35d5d' });
}
// Ползунок: возвращает новое значение
let activeSlider = null;
function slider(id, x, y, w, label, val, min, max, step, unit, digits = 0) {
  text(label, x, y - 8, { size: 13, color: '#ccd' });
  ctx.fillStyle = '#0e0f12'; ctx.fillRect(x, y, w, 8);
  const px = x + (val - min) / (max - min) * w;
  ctx.fillStyle = '#f0a030'; ctx.fillRect(x, y, px - x, 8);
  ctx.fillStyle = '#eee'; ctx.beginPath(); ctx.arc(px, y + 4, 9, 0, 7); ctx.fill();
  text(`${val.toFixed(digits)} ${unit}`, x + w + 14, y + 9, { size: 15, bold: true });
  if (!G.locked && input.pressed && inside(x - 10, y - 12, w + 20, 32)) activeSlider = id;
  if (!input.down) activeSlider = null;
  if (activeSlider === id) { G.overUI = true; let v = min + clamp((input.x - x) / w, 0, 1) * (max - min); v = Math.round(v / step) * step; return clamp(v, min, max); }
  return val;
}
function circle(x, y, r, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }

// ---------- развёртка протектора (общая для зачистки, напыления, шпаклёвки) ----------
const STRIP = { x: 50, y: 150, w: 860, h: 260, cs: 4, gw: 215, gh: 65 };
STRIP.N = STRIP.gw * STRIP.gh;
STRIP.inside = (px, py) => px >= STRIP.x && px < STRIP.x + STRIP.w && py >= STRIP.y && py < STRIP.y + STRIP.h;
STRIP.forDisc = (px, py, rc, fn) => {
  const cx = (px - STRIP.x) / STRIP.cs, cy = (py - STRIP.y) / STRIP.cs, r = Math.ceil(rc);
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(STRIP.gh - 1, Math.ceil(cy + r)); y++)
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(STRIP.gw - 1, Math.ceil(cx + r)); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); if (d <= rc) fn(y * STRIP.gw + x, d / rc);
    }
};
STRIP.canvas = () => { const c = document.createElement('canvas'); c.width = STRIP.gw; c.height = STRIP.gh; const g = c.getContext('2d'); return { c, g, img: g.createImageData(STRIP.gw, STRIP.gh) }; };
STRIP.blit = o => { o.g.putImageData(o.img, 0, 0); ctx.imageSmoothingEnabled = false; ctx.drawImage(o.c, STRIP.x, STRIP.y, STRIP.w, STRIP.h); ctx.imageSmoothingEnabled = true; ctx.strokeStyle = '#555b66'; ctx.strokeRect(STRIP.x - 0.5, STRIP.y - 0.5, STRIP.w + 1, STRIP.h + 1); };
STRIP.set = (o, i, r, g, b) => { const k = i * 4, d = o.img.data; d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = 255; };
const NOISE = new Float32Array(STRIP.N).map(() => rnd());
// Цвет отшероховальной резины и кратеров зачистки
STRIP.baseColor = (i, depth) => {
  const n = NOISE[i] * 14;
  if (!depth) { const v = 56 + n; return [v + 2, v, v - 1]; }
  const v = 70 + depth * 15 + n; return [v + 10, v, v - 8];
};

// ---------- модель шины ----------
const BRANDS = ['Michelin X Multi D', 'Continental HDR2', 'Bridgestone M729', 'Goodyear KMAX D', 'Hankook DL10', 'Pirelli TR01'];
const SIZES = ['315/80 R22.5', '315/70 R22.5', '385/65 R22.5', '295/80 R22.5'];
let tireNo = 4710;
function newTire() {
  const year = pick([2016, 2017, 2018, 2019, 2020, 2020, 2021, 2021, 2022, 2022, 2023, 2023, 2024, 2024]);
  const week = RI(1, 52);
  const t = {
    id: ++tireNo, brand: pick(BRANDS), size: pick(SIZES), year, week, age: 2026 - year,
    dot: `DOT ${pick(['EX', 'HX', '4D', '7B', 'M3'])}${RI(10, 99)} ${String(week).padStart(2, '0')}${String(year).slice(2)}`,
    defects: [], scores: {}, history: [],
  };
  const n = RI(2, 5);
  for (let k = 0, tries = 0; k < n && tries < 200; tries++) {
    const u = R(0.06, 0.94), v = R(0.2, 0.8);
    if (t.defects.some(d => Math.abs(d.u - u) < 0.1)) continue;
    const type = rnd() < 0.55 ? 'nagel' : 'schnitt';
    t.defects.push({ type, where: 'aussen', u, v, size: type === 'nagel' ? R(2.4, 3.6) : R(8, 13), ang: R(-0.9, 0.9) }); k++;
  }
  if (rnd() < 0.25) t.defects.push({ type: pick(['beule', 'kord']), where: 'innen', u: R(0.08, 0.92), v: R(0.3, 0.7), size: 1, ang: 0 });
  t.fatal = t.defects.some(d => d.where === 'innen');
  t.shouldScrap = t.fatal || t.age > 6;
  return t;
}
// Повреждения протектора → сетка: 2 = гвоздь/порез (глубоко), 1 = ржавчина и грязь вокруг
function injuriesToGrid(t) {
  const { gw, gh } = STRIP, dmg = new Uint8Array(STRIP.N), inj = [];
  for (const d of t.defects) {
    if (d.where !== 'aussen') continue;
    const cx = d.u * gw, cy = d.v * gh, cells = [], core = [];
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const px = x + 0.5 - cx, py = y + 0.5 - cy; let lvl = 0;
      if (d.type === 'nagel') { const r = Math.hypot(px, py); if (r < d.size) lvl = 2; else if (r < d.size + 2.2) lvl = 1; }
      else { const ca = Math.cos(d.ang), sa = Math.sin(d.ang), al = Math.abs(px * ca + py * sa), ac = Math.abs(-px * sa + py * ca);
        if (al < d.size / 2 && ac < 1.3) lvl = 2; else if (al < d.size / 2 + 1.6 && ac < 3) lvl = 1; }
      if (lvl) { const i = y * gw + x; dmg[i] = Math.max(dmg[i], lvl); cells.push(i); if (lvl === 2) core.push(i); }
    }
    inj.push({ type: d.type, cx, cy, cells, core, d });
  }
  return { dmg, inj };
}
// Если участок играют отдельно, кратеры после зачистки создаём сами
function ensureCraters(t) {
  if (t.groundDepth) return;
  const { dmg } = injuriesToGrid(t), gd = new Uint8Array(STRIP.N);
  for (let i = 0; i < STRIP.N; i++) if (dmg[i]) gd[i] = Math.min(3, dmg[i] + (NOISE[i] > 0.5 ? 1 : 0));
  t.groundDepth = gd;
}

// ---------- лучшие результаты ----------
let best = {};
try { best = JSON.parse(localStorage.getItem('rw2-best') || '{}'); } catch (e) { best = {}; }
function saveBest(id, s) { if ((best[id] || 0) < s) { best[id] = s; try { localStorage.setItem('rw2-best', JSON.stringify(best)); } catch (e) { /* без хранилища */ } } }
const stars = s => s >= 85 ? '★★★' : s >= 65 ? '★★☆' : s >= 40 ? '★☆☆' : '☆☆☆';

// ---------- состояние и переходы ----------
const G = window.RW2 = {
  W, H, ctx, input, STRIP, NOISE, rnd, R, RI, pick, clamp, lerp, text, wrap, rr, panel, inside, button, bar, gauge, slider, circle,
  stages: [], mode: 'menu', cur: null, tire: null, campaign: false, result: null, manual: false, locked: false, help: false, stageTime: 0, overUI: false,
  newTire, injuriesToGrid, ensureCraters, stars, best: () => best,
};
G.register = s => { G.stages.push(s); G.stages.sort((a, b) => a.num - b.num); };
G.open = (id, opts = {}) => { G.cur = G.stages.find(s => s.id === id); if (!G.campaign || !G.tire || opts.newTire) G.tire = newTire(); G.mode = 'intro'; G.help = false; };
G.begin = () => { G.stageTime = 0; G.help = false; G.cur.init(G.tire); G.mode = 'play'; };
G.finish = res => {
  res.score = Math.round(clamp(res.score, 0, 100)); G.result = res;
  G.tire.scores[G.cur.id] = res.score; G.tire.history.push({ stage: G.cur.id, score: res.score, time: G.stageTime });
  saveBest(G.cur.id, res.score); G.mode = 'result';
};
G.startCampaign = () => { G.campaign = true; G.tire = newTire(); G.cur = G.stages[0]; G.mode = 'intro'; };
G.toMenu = () => { G.mode = 'menu'; G.campaign = false; G.cur = null; G.help = false; };
G.next = () => {
  const i = G.stages.indexOf(G.cur);
  if (G.campaign) { if (G.result.endCampaign || i === G.stages.length - 1) { G.mode = 'summary'; return; } G.cur = G.stages[i + 1]; G.mode = 'intro'; }
  else { G.tire = newTire(); G.cur = G.stages[(i + 1) % G.stages.length]; G.mode = 'intro'; }
};
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------- экраны ----------
function drawMenu() {
  text('REIFENWERK — участки производства', 40, 52, { size: 26, bold: true, color: '#f0a030' });
  text('Холодное восстановление грузовых шин (Kaltrunderneuerung). Каждый участок — отдельная работа со своими правилами.', 40, 80, { size: 14, color: '#aab' });
  const cw = 205, ch = 150, gx = 20, gy = 18, x0 = 40, y0 = 104;
  G.stages.forEach((s, k) => {
    const x = x0 + (k % 4) * (cw + gx), y = y0 + Math.floor(k / 4) * (ch + gy), over = inside(x, y, cw, ch);
    ctx.fillStyle = over ? '#2d323c' : '#23262e'; rr(x, y, cw, ch, 10); ctx.fill(); ctx.strokeStyle = over ? '#f0a030' : '#3a3f4b'; ctx.stroke();
    circle(x + 28, y + 30, 16, '#f0a030'); text(String(s.num), x + 28, y + 31, { size: 16, bold: true, align: 'center', base: 'middle', color: '#1a1a1a' });
    text(s.de, x + 52, y + 27, { size: 15, bold: true });
    let fs = 12; ctx.font = `${fs}px ${FONT}`; while (fs > 9 && ctx.measureText(s.ru).width > cw - 62) { fs--; ctx.font = `${fs}px ${FONT}`; }
    text(s.ru, x + 52, y + 46, { size: fs, color: '#aab' });
    wrap(s.short, x + 14, y + 74, cw - 28, { size: 12, color: '#c9ccd3', lh: 16 });
    const b = best[s.id]; text(b ? `${stars(b)}  лучший: ${b}` : 'ещё не пройден', x + 14, y + ch - 12, { size: 12, color: b ? '#ffd166' : '#667' });
    if (over && input.pressed && !G.locked) { G.campaign = false; G.open(s.id, { newTire: true }); }
  });
  if (button(40, 450, 420, 52, '▶  Шина целиком: все 8 участков подряд', { primary: true, size: 16 })) G.startCampaign();
  wrap('В режиме «Шина целиком» одна и та же шина проходит все участки: ошибки на шероховке, зачистке или в автоклаве всплывут в финальном контроле — как в настоящем цехе.', 490, 468, 430, { size: 12, color: '#aab', lh: 16 });
  text('Общий вид цеха с рабочими и заказами — ссылка «← Весь цех» сверху.', 40, 540, { size: 12, color: '#778' });
}
function drawIntro() {
  const s = G.cur;
  panel(80, 40, 800, 520);
  text(`Участок ${s.num} из ${G.stages.length}${G.campaign ? ' · шина целиком' : ''}`, 110, 80, { size: 13, color: '#aab' });
  text(`${s.de} — ${s.ru}`, 110, 112, { size: 24, bold: true, color: '#f0a030' });
  const t = G.tire; text(`Шина №${t.id}: ${t.brand}, ${t.size}`, 110, 140, { size: 13, color: '#ccd' });
  wrap(s.intro, 110, 175, 740, { size: 14, lh: 20 });
  if (button(110, 490, 220, 46, 'Начать работу ▸', { primary: true })) G.begin();
  if (button(350, 490, 160, 46, 'Меню')) G.toMenu();
}
function drawHud() {
  ctx.fillStyle = 'rgba(20,22,27,.92)'; ctx.fillRect(0, 0, W, 40);
  text(`${G.cur.num}. ${G.cur.de} — ${G.cur.ru}`, 16, 26, { size: 16, bold: true, color: '#f0a030' });
  text(`⏱ ${fmtTime(G.stageTime)}`, 640, 26, { size: 14, color: '#ccd' });
  if (button(730, 6, 100, 28, '? Задание', { size: 12 })) G.help = !G.help;
  if (button(840, 6, 100, 28, 'Меню', { size: 12 })) G.toMenu();
}
function drawHelp() {
  panel(120, 60, 720, 470);
  text('Задание', 150, 98, { size: 20, bold: true, color: '#f0a030' });
  wrap(G.cur.intro, 150, 130, 660, { size: 14, lh: 20 });
  const keep = G.locked; G.locked = false;
  if (button(150, 470, 180, 40, 'Продолжить', { primary: true })) G.help = false;
  G.locked = keep;
}
function drawResult() {
  const r = G.result, i = G.stages.indexOf(G.cur), last = i === G.stages.length - 1;
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, W, H);
  panel(160, 70, 640, 460);
  text(`${G.cur.de} — результат`, 190, 110, { size: 20, bold: true, color: '#f0a030' });
  text(String(r.score), 190, 180, { size: 56, bold: true, color: r.score >= 65 ? '#62c370' : r.score >= 40 ? '#f0a030' : '#e35d5d' });
  text(stars(r.score), 300, 172, { size: 30, color: '#ffd166' });
  text(`время: ${fmtTime(G.stageTime)}`, 300, 196, { size: 13, color: '#aab' });
  let y = wrap(r.verdict || '', 190, 236, 580, { size: 15, bold: true, lh: 21 });
  for (const n of r.notes || []) y = wrap('• ' + n, 190, y + 4, 580, { size: 13, color: '#ccd', lh: 18 });
  const nextLabel = G.campaign ? (r.endCampaign || last ? 'Итог по шине ▸' : `Дальше: ${G.stages[i + 1].de} ▸`) : `Следующий участок ▸`;
  if (button(190, 470, 280, 42, nextLabel, { primary: true })) G.next();
  if (!G.campaign && button(490, 470, 140, 42, 'Ещё раз')) G.open(G.cur.id, { newTire: true });
  if (button(650, 470, 120, 42, 'Меню')) G.toMenu();
}
function drawSummary() {
  const t = G.tire;
  panel(120, 50, 720, 500);
  text(`Шина №${t.id} — итог`, 150, 92, { size: 22, bold: true, color: '#f0a030' });
  text(`${t.brand}, ${t.size}, ${t.dot}`, 150, 118, { size: 13, color: '#aab' });
  let y = 156, sum = 0, n = 0;
  for (const h of t.history) {
    const s = G.stages.find(x => x.id === h.stage);
    text(`${s.num}. ${s.de}`, 150, y, { size: 14 }); text(`${h.score}  ${stars(h.score)}`, 470, y, { size: 14, bold: true, color: '#ffd166' }); text(fmtTime(h.time), 620, y, { size: 13, color: '#aab' });
    y += 24; sum += h.score; n++;
  }
  const avg = n ? Math.round(sum / n) : 0;
  text(`Средняя оценка: ${avg}`, 150, y + 14, { size: 16, bold: true });
  let outcome;
  if (t.stage1Scrap) outcome = t.shouldScrap ? 'Каркас правильно отбракован на входе — работа и материалы не потрачены впустую.' : 'Годный каркас ушёл в лом — потеряно около 150 €.';
  else if (t.outcome === 'versand' && t.expected === 'versand') outcome = `Шина отправлена клиенту. Ожидаемый пробег ≈ ${(Math.round(140 + avg * 0.8) * 1000).toLocaleString('de-DE')} км.`;
  else if (t.outcome === 'versand') outcome = 'Шина с дефектом ушла клиенту → рекламация: −350 €, репутация цеха падает.';
  else if (t.outcome === t.expected) outcome = t.outcome === 'schrott' ? 'Брак пойман на финальном контроле: шина в лом, клиент не пострадал.' : 'Отслоение поймано: шина ушла на переделку (Nacharbeit).';
  else outcome = 'Решение на финальном контроле было неверным.';
  wrap(outcome, 150, y + 48, 660, { size: 15, lh: 21, color: '#e7e7e7' });
  if (button(150, 480, 300, 46, 'Следующая шина ▸', { primary: true })) G.startCampaign();
  if (button(470, 480, 140, 46, 'Меню')) G.toMenu();
}

// ---------- цикл ----------
function step(dt) {
  G.overUI = false;
  ctx.fillStyle = '#17191e'; ctx.fillRect(0, 0, W, H);
  if (G.mode === 'menu') drawMenu();
  else if (G.mode === 'intro') drawIntro();
  else if (G.mode === 'play') {
    G.locked = G.help; if (!G.help) G.stageTime += dt;
    G.cur.frame(G.help ? 0 : dt); G.locked = false;
    if (G.mode === 'play') { drawHud(); if (G.help) drawHelp(); }
    else if (G.mode === 'result') { /* участок только что завершился */ }
  } else if (G.mode === 'result') { G.locked = true; G.cur.frame(0); G.locked = false; drawResult(); }
  else if (G.mode === 'summary') drawSummary();
  input.pressed = false; input.released = false; input.keyPressed.clear();
}
let last = performance.now();
function loop(now) { const dt = Math.min(0.05, (now - last) / 1000); last = now; if (!G.manual) step(dt); requestAnimationFrame(loop); }
G.step = (dt = 1 / 60, n = 1) => { for (let k = 0; k < n; k++) step(dt); };
G.setInput = (x, y, down) => { if (down && !input.down) input.pressed = true; if (!down && input.down) input.released = true; input.x = x; input.y = y; input.down = down; };
G.key = code => input.keyPressed.add(code);
G.boot = () => {
  resize();
  document.getElementById('menuLink').addEventListener('click', e => { e.preventDefault(); G.toMenu(); });
  const st = params.get('stage'); if (st && G.stages.some(s => s.id === st)) { G.open(st, { newTire: true }); if (params.get('play')) G.begin(); }
  requestAnimationFrame(loop);
};
})();
