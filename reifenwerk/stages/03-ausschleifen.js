'use strict';
// Участок 3. Ausschleifen — высверлить и зачистить повреждения до здоровой резины.
(() => {
const G = RW2, { ctx, input, text, button, circle, STRIP, R } = G;

G.register({
  id: 'ausschl', num: 3, de: 'Ausschleifen', ru: 'Зачистка повреждений',
  short: 'Пневмошлифовкой вычисти гвозди, порезы и ржавчину до чистой резины — но не больше нужного.',
  intro: `Перед тобой развёртка отшероховальной поверхности. Гвозди, порезы и ржавчина вокруг них (коричневое) должны быть вычищены до здоровой резины, иначе ремонтная резина не схватится.

• Зажми мышь и води шлифмашинкой по повреждению. Чем дольше держишь — тем глубже кратер.
• Глубокие места (гвоздь, порез) требуют двух проходов, ржавый ореол — одного.
• Не шлифуй здоровую резину без нужды: каждый лишний кратер потом заполнять и тратить материал.
• Когда всё чисто — «Fertig».
Реальность: работа ручная, пневмошлифовка с фрезой или «ёжиком», кратер делают конусным (skive).`,
  init(t) {
    this.t = t; const { dmg, inj } = G.injuriesToGrid(t);
    this.dmg = dmg; this.dmg0 = dmg.slice(); this.inj = inj;
    this.depthF = new Float32Array(STRIP.N); this.ground = new Uint8Array(STRIP.N);
    this.total = dmg.reduce((a, v) => a + (v ? 1 : 0), 0) || 1;
    this.grid = STRIP.canvas(); this.sparks = []; this.toolSpin = 0;
  },
  frame(dt) {
    const grinding = !G.locked && input.down && STRIP.inside(input.x, input.y);
    if (grinding) {
      STRIP.forDisc(input.x, input.y, 2.6, (i, f) => {
        this.depthF[i] = Math.min(3.2, this.depthF[i] + dt * 4.5 * (1 - f * 0.6));
        const g = Math.min(3, Math.floor(this.depthF[i])); this.ground[i] = g;
        if (g >= this.dmg[i]) this.dmg[i] = 0;
      });
      for (let k = 0; k < 3; k++) this.sparks.push({ x: input.x, y: input.y, vx: R(-120, 120), vy: R(-120, 40), life: R(0.2, 0.5) });
      this.toolSpin += dt * 40;
    }
    for (const p of this.sparks) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    this.sparks = this.sparks.filter(p => p.life > 0);

    for (let i = 0; i < STRIP.N; i++) {
      let c = STRIP.baseColor(i, this.ground[i]);
      if (this.dmg[i] === 2) c = [105 + G.NOISE[i] * 30, 58, 30]; else if (this.dmg[i] === 1) c = [84, 60, 44];
      STRIP.set(this.grid, i, c[0], c[1], c[2]);
    }
    STRIP.blit(this.grid);
    for (const j of this.inj) if (j.type === 'nagel' && j.core.some(i => this.dmg[i] === 2)) {
      const x = STRIP.x + j.cx * STRIP.cs, y = STRIP.y + j.cy * STRIP.cs; circle(x + 2, y + 2, 7, 'rgba(0,0,0,.5)'); circle(x, y, 6.5, '#a4adb7'); circle(x - 2, y - 2, 2, '#eef');
    }
    for (const p of this.sparks) circle(p.x, p.y, 1.5, `rgba(255,${180 + Math.random() * 60 | 0},80,${p.life * 2})`);
    if (STRIP.inside(input.x, input.y)) {
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.arc(input.x, input.y, 2.6 * STRIP.cs, 0, 7); ctx.stroke();
      ctx.save(); ctx.translate(input.x + 18, input.y - 18); ctx.rotate(-0.6); ctx.fillStyle = '#5b6470'; ctx.fillRect(0, -7, 60, 14); ctx.fillStyle = '#2c3138'; ctx.fillRect(56, -9, 30, 18); ctx.restore();
    }

    const left = this.inj.filter(j => j.cells.some(i => this.dmg[i] > 0)).length;
    let waste = 0; for (let i = 0; i < STRIP.N; i++) if (this.ground[i] && !this.dmg0[i]) waste++;
    text('Развёртка протектора после шероховки (вид сверху)', STRIP.x, STRIP.y - 12, { size: 12, color: '#aab' });
    text(`Повреждений не дочищено: ${left} из ${this.inj.length}`, 50, 452, { size: 15, bold: true, color: left ? '#f0a030' : '#62c370' });
    text(`Здоровой резины сошлифовано: ${waste} клеток`, 50, 476, { size: 13, color: waste > this.total * 0.7 ? '#e35d5d' : '#aab' });
    if (button(720, 520, 200, 44, 'Fertig ✓', { primary: true })) this.end(waste);
  },
  end(waste) {
    if (G.mode !== 'play') return;
    let rem = 0; for (let i = 0; i < STRIP.N; i++) if (this.dmg[i]) rem++;
    const remF = rem / this.total, wasteF = waste / this.total, notes = [];
    if (rem) notes.push(`Осталась ржавчина/грязь в ${rem} клетках — ремонтная резина там отслоится.`);
    if (wasteF > 0.7) notes.push(`Лишняя шлифовка здоровой резины: ${waste} клеток — больше заполнять экструдером.`);
    if (!notes.length) notes.push('Все повреждения вычищены до здоровой резины, без лишнего.');
    this.t.groundDepth = this.ground.slice(); this.t.dirtyLeft = rem;
    G.finish({ score: 100 - remF * 160 - Math.max(0, wasteF - 0.7) * 35, verdict: rem ? 'Зачищено не полностью.' : 'Повреждения зачищены.', notes });
  },
});
})();
