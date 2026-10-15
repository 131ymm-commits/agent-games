'use strict';
// Участок 2. Rauen — снятие остатков старого протектора рашпилем до заданного радиуса.
(() => {
const G = RW2, { ctx, input, text, button, circle, clamp, R } = G;
const C = { x: 340, y: 330 }, N = 360, BASE = 100, PX = 13, TARGET = 2.0, DANGER = 0.6, REVS = 5;
const rad = mm => BASE + mm * PX;

G.register({
  id: 'rauen', num: 2, de: 'Rauen', ru: 'Шероховка',
  short: 'Сними остатки старого протектора рашпилем ровно до 2 мм над брекером, не задев сталь.',
  intro: `Шина надета на разжимной барабан и вращается. Рашпиль (Raspel) снимает остатки старого протектора — изношенного неравномерно.

• Двигай мышь влево-вправо: так рашпиль подходит к шине или отходит от неё (или стрелки ← →).
• Цель — ровный слой 2 мм резины над стальным брекером (Gürtel, серое кольцо). Зелёная пунктирная линия — цель.
• Красная линия — опасно: рашпиль заденет брекер, и каркас испорчен.
• Шина делает 5 оборотов. Можно закончить раньше кнопкой «Fertig».
Реальность: на заводе станок держит заданный радиус, а оператор следит за профилем и шероховатостью (RMA 3–4).`,
  init(t) {
    this.t = t; this.s = new Float32Array(N); this.hits = new Uint8Array(N); this.dust = [];
    const ph1 = R(0, 6.28), ph2 = R(0, 6.28), a1 = R(0.8, 1.8), a2 = R(0.3, 0.9);
    for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2; this.s[i] = 3 + clamp(5 + a1 * Math.sin(a * 2 + ph1) + a2 * Math.sin(a * 5 + ph2) + R(-0.2, 0.2), 1.5, 8.5); }
    this.rot = 0; this.r = 11; this.speed = N / 7; this.spin = 0;
  },
  frame(dt) {
    if (!G.locked) {
      if (input.x > C.x + BASE - 30 && input.x < 900 && input.y > 60 && input.y < 560 && !G.overUI) this.r = clamp((input.x - C.x - BASE - 4) / PX, -0.5, 12.5);
      if (input.keys.has('ArrowLeft')) this.r = clamp(this.r - 3 * dt, -0.5, 12.5);
      if (input.keys.has('ArrowRight')) this.r = clamp(this.r + 3 * dt, -0.5, 12.5);
    }
    const prev = this.rot; this.rot += this.speed * dt; this.spin += dt * 30;
    let cutting = false;
    for (let k = Math.floor(prev); k < Math.floor(this.rot); k++) {
      const i = ((k % N) + N) % N;
      if (this.s[i] > this.r) { this.s[i] = Math.max(this.r, -0.5); cutting = true; }
      if (this.r < DANGER) this.hits[i] = 1;
    }
    if (cutting) for (let k = 0; k < 4; k++) this.dust.push({ x: C.x + rad(this.r), y: C.y, vx: R(-40, 120), vy: R(-160, -30), life: R(0.4, 0.9) });
    for (const p of this.dust) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; p.life -= dt; }
    this.dust = this.dust.filter(p => p.life > 0);

    // шина: каркас, брекер, слой резины
    circle(C.x, C.y, BASE + 4 * PX + 120, '#1b1d22');
    ctx.beginPath();
    for (let i = 0; i <= N; i++) { const j = i % N, a = (j - this.rot) / N * Math.PI * 2, r = rad(this.s[j]); i ? ctx.lineTo(C.x + Math.cos(a) * r, C.y + Math.sin(a) * r) : ctx.moveTo(C.x + Math.cos(a) * r, C.y + Math.sin(a) * r); }
    ctx.closePath(); ctx.fillStyle = '#2a2a2d'; ctx.fill();
    circle(C.x, C.y, BASE, '#4a4d54'); circle(C.x, C.y, BASE - 30, '#2a2d33'); circle(C.x, C.y, 30, '#f08a24');
    for (let i = 0; i < N; i++) if (this.hits[i]) { const a = (i - this.rot) / N * Math.PI * 2; circle(C.x + Math.cos(a) * BASE, C.y + Math.sin(a) * BASE, 3, '#e35d5d'); }
    ctx.strokeStyle = '#aab3bd'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(C.x, C.y, BASE, 0, 7); ctx.stroke();
    ctx.setLineDash([6, 6]); ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#62c370'; ctx.beginPath(); ctx.arc(C.x, C.y, rad(TARGET), 0, 7); ctx.stroke();
    ctx.strokeStyle = '#e35d5d'; ctx.beginPath(); ctx.arc(C.x, C.y, rad(DANGER), 0, 7); ctx.stroke();
    ctx.setLineDash([]); ctx.lineWidth = 1;
    // рашпиль
    const rx = C.x + rad(this.r);
    ctx.fillStyle = '#e0b020'; ctx.fillRect(rx + 22, C.y - 50, 120, 100);
    ctx.fillStyle = '#7a6a20'; ctx.fillRect(rx + 140, C.y - 12, 160, 24);
    ctx.save(); ctx.translate(rx + 26, C.y); ctx.rotate(this.spin);
    circle(0, 0, 26, '#9aa3ad'); ctx.strokeStyle = '#555'; for (let k = 0; k < 12; k++) { ctx.rotate(Math.PI / 6); ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(28, 0); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(rx + 80, C.y - 50); ctx.quadraticCurveTo(rx + 90, C.y - 140, rx + 200, C.y - 170); ctx.stroke(); ctx.lineWidth = 1;
    for (const p of this.dust) circle(p.x, p.y, 2, `rgba(60,60,60,${p.life})`);

    // показания
    const maxRest = Math.max(...this.s) - TARGET, minS = Math.min(...this.s), rev = Math.min(REVS, this.rot / N);
    G.panel(650, 70, 290, 200);
    text('Пульт рауавтомата', 666, 96, { size: 14, bold: true, color: '#f0a030' });
    text(`Рашпиль: ${this.r.toFixed(1)} мм над брекером`, 666, 124, { size: 13, color: this.r < DANGER ? '#e35d5d' : '#e7e7e7' });
    text(`Цель (Unterplatte): ${TARGET.toFixed(1)} мм`, 666, 146, { size: 13, color: '#62c370' });
    text(`Остаток над целью: макс. ${Math.max(0, maxRest).toFixed(1)} мм`, 666, 168, { size: 13 });
    text(`Минимум слоя: ${minS.toFixed(1)} мм`, 666, 190, { size: 13, color: minS < 1.4 ? '#e35d5d' : '#e7e7e7' });
    text(`Оборот: ${rev.toFixed(1)} / ${REVS}`, 666, 212, { size: 13 }); G.bar(666, 222, 250, 8, rev / REVS, '#f0a030');
    if (this.hits.some(h => h)) text('⚠ Брекер задет!', 666, 256, { size: 14, bold: true, color: '#e35d5d' });
    if (button(720, 520, 200, 44, 'Fertig ✓', { primary: true }) || this.rot / N >= REVS) this.end();
  },
  end() {
    if (G.mode !== 'play') return;
    let excess = 0, deep = 0, hit = 0;
    for (let i = 0; i < N; i++) { excess += Math.max(0, this.s[i] - 2.6); deep += Math.max(0, 1.4 - this.s[i]); hit += this.hits[i]; }
    excess /= N; deep /= N;
    const notes = [];
    if (excess > 0.05) notes.push(`Осталась старая резина: в среднем ${excess.toFixed(2)} мм сверх нормы — протектор ляжет неровно.`);
    if (deep > 0.02) notes.push(`Местами снято слишком глубоко (меньше 1,4 мм над брекером).`);
    if (hit) notes.push(`Рашпиль задел стальной брекер на ${Math.round(hit / N * 100)}% окружности — каркас повреждён.`);
    if (!notes.length) notes.push('Ровный профиль, 2 мм над брекером — идеальная основа для протектора.');
    this.t.rauHit = hit > 0;
    G.finish({ score: 100 - excess * 28 - deep * 45 - (hit ? 35 + hit / N * 100 : 0), verdict: hit ? 'Брекер повреждён.' : excess > 0.3 ? 'Слишком много старой резины.' : 'Шероховка выполнена.', notes });
  },
});
})();
