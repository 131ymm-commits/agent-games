'use strict';
// Участок 7. Einhüllen + Autoklav — проверка чехлов вакуумом, загрузка и программа вулканизации.
(() => {
const G = RW2, { ctx, input, text, button, circle, R, RI, clamp } = G;
const RAIL_Y = 92, TR = 32, TEST_T = 1.4;

G.register({
  id: 'autoklav', num: 7, de: 'Autoklav', ru: 'Чехлы и автоклав',
  short: 'Найди негерметичные чехлы вакуум-тестом, загрузи партию и задай правильную программу вулканизации.',
  intro: `10 шин в резиновых чехлах (Innen- und Außenhülle) висят на крюках монорельса перед автоклавом (Heizkessel).

Шаг 1 — вакуум-тест каждого чехла:
• Кликни на шину, нажми «Вакуум». Стрелка уходит к −0,8 бар.
• Если чехол негерметичен, стрелка медленно ползёт обратно. Такой чехол — «Перенадеть ↺». Если держит — «Герметично ✓».

Шаг 2 — загрузка: все шины по рельсу заезжают в котёл.

Шаг 3 — программа по рабочей инструкции (Arbeitsanweisung, Bandag):
• температура 100–120 °C;
• давление в котле 6 бар;
• время нагрева 3,5–4,5 ч; для шин 385 — на 0,5 ч дольше.`,
  init(t) {
    this.t = t; this.big = t.size.startsWith('385');
    const nLeak = RI(1, 3), leaks = new Set(); while (leaks.size < nLeak) leaks.add(RI(0, 9));
    this.tires = Array.from({ length: 10 }, (_, k) => ({ k, x: 70 + k * 84, y: RAIL_Y + 60, leak: leaks.has(k), wasLeak: leaks.has(k), state: 'neu', tt: 0, redo: 0, vac: 0 }));
    this.sel = 0; this.phase = 'huelle'; this.anim = 0; this.prog = { temp: 90, bar: 3, h: 2 }; this.missed = 0; this.falseRedo = 0;
  },
  frame(dt) {
    const T = this.tires, s = T[this.sel];
    // котёл
    ctx.fillStyle = '#2f5d8a'; G.rr(100, 330, 820, 170, 80); ctx.fill(); ctx.strokeStyle = '#6d9cc9'; ctx.lineWidth = 3; ctx.stroke(); ctx.lineWidth = 1;
    circle(110, 415, 80, this.phase === 'heizen' ? '#3f6f9e' : '#244a70'); ctx.strokeStyle = '#9cc3e6'; ctx.beginPath(); ctx.arc(110, 415, 80, 0, 7); ctx.stroke();
    text('Heizkessel', 200, 352, { size: 13, bold: true, color: '#cfe3f5' });
    // рельс
    ctx.strokeStyle = '#4b5563'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(20, RAIL_Y); ctx.lineTo(940, RAIL_Y); ctx.stroke(); ctx.lineWidth = 1;
    if (this.phase === 'laden' || this.phase === 'programm' || this.phase === 'heizen') this.anim = Math.min(1, this.anim + dt / 2.2);
    for (const tr of T) {
      const tx = this.phase === 'huelle' ? tr.x : tr.x + (210 + tr.k * 64 - tr.x) * this.anim, ty = this.phase === 'huelle' ? tr.y : tr.y + (415 - tr.y) * this.anim;
      ctx.strokeStyle = '#d8b13a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(tx, this.phase === 'huelle' ? RAIL_Y : ty - 50); ctx.lineTo(tx, ty - TR); ctx.stroke(); ctx.lineWidth = 1;
      circle(tx, ty, TR, '#1a1b1e'); circle(tx, ty, TR - 9, '#2d3036'); circle(tx, ty, 11, '#111');
      if (this.phase === 'huelle') {
        if (tr.k === this.sel) { ctx.strokeStyle = '#f0a030'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(tx, ty, TR + 5, 0, 7); ctx.stroke(); ctx.lineWidth = 1; }
        const badge = tr.state === 'ok' ? ['✓', '#62c370'] : tr.redo > 0 ? ['↺', '#f0a030'] : tr.state === 'test' ? ['…', '#9fc6ff'] : ['?', '#aab'];
        text(badge[0], tx, ty + TR + 18, { size: 16, bold: true, align: 'center', color: badge[1] });
        if (!G.locked && input.pressed && Math.hypot(input.x - tx, input.y - ty) < TR + 4) this.sel = tr.k;
      }
    }
    if (this.phase === 'huelle') this.huelle(dt, s);
    else if (this.phase === 'laden') { text('Загрузка партии по рельсу в котёл…', 340, 300, { size: 15, bold: true }); if (this.anim >= 1 && !G.locked) this.phase = 'programm'; }
    else if (this.phase === 'programm') this.programm();
    else if (this.phase === 'heizen') this.heizen(dt);
  },
  huelle(dt, s) {
    if (s.redo > 0) { s.redo -= dt; if (s.redo <= 0) { s.redo = 0; s.leak = false; s.state = 'neu'; s.vac = 0; } }
    if (s.state === 'test') {
      s.tt += dt;
      s.vac = s.tt < TEST_T ? -0.8 * s.tt / TEST_T : s.leak ? -0.8 + Math.min(0.55, (s.tt - TEST_T) * 0.22) : -0.8 + Math.sin(s.tt * 7) * 0.004;
    }
    G.panel(40, 220, 560, 96);
    text(`Шина ${s.k + 1}: вакуум-тест чехла`, 56, 246, { size: 14, bold: true, color: '#f0a030' });
    // манометр
    const mx = 470, my = 274; circle(mx, my, 36, '#e9e9e9'); ctx.strokeStyle = '#333'; ctx.beginPath(); ctx.arc(mx, my, 36, 0, 7); ctx.stroke();
    const a = Math.PI * 0.75 + (-s.vac / 1) * Math.PI * 1.5;
    ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + Math.cos(a) * 30, my + Math.sin(a) * 30); ctx.stroke(); ctx.lineWidth = 1;
    text(`${s.vac.toFixed(2)} бар`, mx + 46, my + 5, { size: 14, bold: true });
    if (s.redo > 0) text('Чехол перенадевается…', 56, 290, { size: 14, color: '#f0a030' });
    else if (s.state === 'neu') { if (button(56, 262, 140, 40, 'Вакуум ▸', { primary: true })) { s.state = 'test'; s.tt = 0; } }
    else if (s.state === 'test') {
      if (s.tt < TEST_T) text('Откачка…', 56, 290, { size: 14, color: '#9fc6ff' });
      else {
        if (button(56, 262, 160, 40, 'Герметично ✓', { on: true })) { s.state = 'ok'; if (s.leak) this.missed++; this.nextSel(); }
        if (button(226, 262, 170, 40, 'Перенадеть ↺', { danger: true })) { if (!s.leak) this.falseRedo++; s.redo = 1.5; s.state = 'neu'; s.vac = 0; }
      }
    }
    const allOk = this.tires.every(t => t.state === 'ok');
    text(`Проверено: ${this.tires.filter(t => t.state === 'ok').length} / 10`, 640, 250, { size: 15, bold: true });
    if (button(640, 266, 290, 44, 'Все шины в котёл ▸', { primary: allOk, disabled: !allOk })) { this.phase = 'laden'; this.anim = 0; }
  },
  nextSel() { const n = this.tires.find(t => t.state !== 'ok'); if (n) this.sel = n.k; },
  programm() {
    G.panel(40, 120, 880, 200);
    text('Программа вулканизации (Heizprogramm)', 60, 148, { size: 16, bold: true, color: '#f0a030' });
    text(`Партия: 10 × ${this.t.size}`, 600, 148, { size: 13, color: '#aab' });
    const p = this.prog;
    p.temp = G.slider('temp', 60, 190, 420, 'Температура', p.temp, 80, 150, 1, '°C');
    p.bar = G.slider('bar', 60, 240, 420, 'Давление в котле', p.bar, 0, 10, 0.5, 'бар', 1);
    p.h = G.slider('h', 60, 290, 420, 'Время нагрева', p.h, 1, 8, 0.25, 'ч', 2);
    if (button(640, 250, 260, 50, '▶ Start Heizprogramm', { primary: true })) { this.phase = 'heizen'; this.heat = 0; }
  },
  heizen(dt) {
    this.heat += dt; const f = Math.min(1, this.heat / 6), p = this.prog;
    G.panel(40, 120, 880, 200);
    text(`Вулканизация: ${(f * p.h).toFixed(1)} из ${p.h.toFixed(2)} ч · дверь заблокирована 🔒`, 60, 148, { size: 15, bold: true, color: '#f0a030' });
    const gx = 60, gy = 300, gw = 820, gh = 130, tempAt = x => x < 0.15 ? 20 + (p.temp - 20) * x / 0.15 : x > 0.9 ? p.temp - (p.temp - 40) * (x - 0.9) / 0.1 : p.temp, barAt = x => x < 0.1 ? p.bar * x / 0.1 : x > 0.92 ? p.bar * (1 - (x - 0.92) / 0.08) : p.bar;
    ctx.strokeStyle = '#3a3f4b'; ctx.strokeRect(gx, gy - gh, gw, gh);
    for (const [fn, max, col] of [[tempAt, 160, '#ff8c42'], [barAt, 10, '#5aa8e6']]) {
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
      for (let k = 0; k <= 200 * f; k++) { const x = k / 200, X = gx + x * gw, Y = gy - fn(x) / max * gh; k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
      ctx.stroke(); ctx.lineWidth = 1;
    }
    text(`T ${Math.round(tempAt(f))} °C`, gx + 8, gy - gh + 18, { size: 12, color: '#ff8c42' }); text(`p ${barAt(f).toFixed(1)} бар`, gx + 100, gy - gh + 18, { size: 12, color: '#5aa8e6' });
    if (f >= 1) this.end();
  },
  end() {
    if (G.mode !== 'play') return;
    const p = this.prog, hmin = 3.5 + (this.big ? 0.5 : 0), hmax = 4.5 + (this.big ? 0.5 : 0), notes = [];
    const dT = p.temp < 100 ? 100 - p.temp : p.temp > 120 ? p.temp - 120 : 0;
    const dP = Math.abs(p.bar - 6) > 0.5 ? Math.abs(p.bar - 6) : 0;
    const dH = p.h < hmin ? hmin - p.h : p.h > hmax ? p.h - hmax : 0;
    if (this.missed) notes.push(`Пропущено негерметичных чехлов: ${this.missed} — в этих шинах пар/воздух под протектором, отслоение.`);
    if (this.falseRedo) notes.push(`Зря перенадето чехлов: ${this.falseRedo} (потеря времени).`);
    notes.push(dT ? `Температура ${p.temp} °C вне нормы 100–120 °C.` : `Температура ${p.temp} °C — в норме.`);
    notes.push(dP ? `Давление ${p.bar} бар — нужно 6 бар.` : `Давление ${p.bar} бар — в норме.`);
    notes.push(dH ? `Время ${p.h} ч — нужно ${hmin}–${hmax} ч${this.big ? ' (385 — дольше)' : ''}: ${p.h < hmin ? 'недовулканизация' : 'перегрев, лишняя энергия'}.` : `Время ${p.h} ч — в норме.`);
    this.t.cureBad = dT > 8 || dP > 1.5 || dH > 0.5 || this.missed > 0;
    G.finish({ score: 100 - this.missed * 22 - this.falseRedo * 4 - dT * 2.5 - dP * 10 - dH * 25, verdict: this.t.cureBad ? 'Вулканизация с нарушениями.' : 'Партия провулканизирована правильно.', notes });
  },
});
})();
