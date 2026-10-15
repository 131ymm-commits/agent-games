'use strict';
// Участок 5. Spachteln — заделка кратеров ремонтной резиной из пистолета-экструдера.
(() => {
const G = RW2, { ctx, input, text, button, circle, STRIP, clamp } = G;
const T_COLD = 110, T_HOT = 160;

function components(gd) {
  const seen = new Uint8Array(STRIP.N), out = [];
  for (let s = 0; s < STRIP.N; s++) {
    if (!gd[s] || seen[s]) continue;
    const cells = [], q = [s]; seen[s] = 1;
    while (q.length) {
      const i = q.pop(); cells.push(i); const x = i % STRIP.gw, y = (i / STRIP.gw) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= STRIP.gw || ny >= STRIP.gh) continue;
        const j = ny * STRIP.gw + nx; if (gd[j] && !seen[j]) { seen[j] = 1; q.push(j); }
      }
    }
    out.push({ cells });
  }
  return out;
}

G.register({
  id: 'spachtel', num: 5, de: 'Spachteln', ru: 'Шпаклёвка пистолетом-экструдером',
  short: 'Нагрей пистолет до 120–150 °C и заполни каждый кратер ремонтной резиной вровень с поверхностью.',
  intro: `В пистолет-экструдер вставлен шнур ремонтной резины (Füllgummi). Пистолет греет резину, и она становится мягкой. Ею заполняют все кратеры после зачистки: от гвоздей, порезов, всех неровностей.

• Включи нагрев (Heizung) и следи за температурой: рабочая зона 120–150 °C.
• Холоднее 110 °C — резина плохо течёт и плохо схватывается. Горячее 160 °C — подгорает (Anvulkanisation).
• Пока выдавливаешь, пистолет остывает. Нагрев включай и выключай по шкале.
• Зажми мышь над кратером: резина заполняет его. Нужно вровень или чуть выше (до 160 %): излишек потом срежут. Сильный перелив — брак.
• Не дави резину мимо кратеров.`,
  init(t) {
    G.ensureCraters(t); this.t = t; this.gd = t.groundDepth; this.fill = new Float32Array(STRIP.N);
    this.flag = new Uint8Array(STRIP.N); this.over = new Float32Array(STRIP.N);
    this.craters = components(this.gd); this.T = 20; this.heat = false; this.grid = STRIP.canvas();
  },
  frame(dt) {
    this.T = clamp(this.T + (this.heat ? 16 : -5) * dt, 20, 210);
    const extruding = !G.locked && input.down && STRIP.inside(input.x, input.y) && this.T >= 60;
    if (extruding) {
      this.T -= 9 * dt; const rate = this.T < T_COLD ? 1.0 : 3.0;
      STRIP.forDisc(input.x, input.y, 2.2, (i, f) => {
        const a = dt * rate * (1 - f * 0.5);
        if (this.gd[i]) { this.fill[i] += a; if (this.T < T_COLD) this.flag[i] = 1; else if (this.T > T_HOT) this.flag[i] = 2; }
        else this.over[i] += a;
      });
    }
    for (let i = 0; i < STRIP.N; i++) {
      let c = STRIP.baseColor(i, 0);
      if (this.gd[i]) {
        const r = Math.min(1, this.fill[i] / this.gd[i]), h = STRIP.baseColor(i, this.gd[i]);
        c = r >= 0.9 ? [20, 20, 22] : [h[0] + (20 - h[0]) * r, h[1] + (20 - h[1]) * r, h[2] + (22 - h[2]) * r];
        if (this.fill[i] / this.gd[i] > 1.6) c = [70, 66, 62];
        if (this.flag[i] === 1) c = [52, 62, 82]; else if (this.flag[i] === 2) c = [126, 72, 32];
      } else if (this.over[i] > 0.35) c = [26, 26, 28];
      STRIP.set(this.grid, i, c[0], c[1], c[2]);
    }
    STRIP.blit(this.grid);
    if (STRIP.inside(input.x, input.y)) {
      const hot = this.T >= T_COLD && this.T <= T_HOT ? '#ffb347' : this.T > T_HOT ? '#ff4d2e' : '#6f8fb3';
      ctx.save(); ctx.translate(input.x, input.y);
      ctx.fillStyle = '#9aa3ad'; ctx.fillRect(6, -60, 26, 52); ctx.fillStyle = '#4a5260'; ctx.fillRect(0, -16, 38, 14); ctx.fillStyle = '#333'; ctx.fillRect(14, -10, 10, 40);
      circle(0, 0, 4, hot); ctx.restore();
    }
    // показатели кратеров
    let good = 0;
    for (const cr of this.craters) { let s = 0; for (const i of cr.cells) s += this.fill[i] / this.gd[i]; cr.ratio = s / cr.cells.length; if (cr.ratio >= 0.9 && cr.ratio <= 1.6) good++; }
    text(`Кратеров заполнено правильно: ${good} из ${this.craters.length}`, 50, 470, { size: 15, bold: true, color: good === this.craters.length ? '#62c370' : '#f0a030' });
    text('Тёмное — заполнено · синее — холодная резина · рыжее — подгорело · светлый бугор — перелив', 50, 494, { size: 12, color: '#aab' });
    G.gauge(50, 525, 300, 'Температура пистолета', this.T, 20, 200, 120, 150, '°C');
    if (this.T < 60) text('Резина не течёт — нагрей пистолет', 50, 560, { size: 12, color: '#6f8fb3' });
    if (button(470, 512, 160, 42, this.heat ? 'Heizung: AN' : 'Heizung: AUS', this.heat ? { on: true, size: 13 } : { size: 13 })) this.heat = !this.heat;
    if (button(720, 512, 200, 42, 'Fertig ✓', { primary: true })) this.end();
  },
  end() {
    if (G.mode !== 'play') return;
    let sum = 0, voids = 0, bumps = 0, cold = 0, hot = 0, over = 0, cells = 0;
    for (const cr of this.craters) {
      const r = cr.ratio || 0; if (r < 0.9) voids++; if (r > 1.6) bumps++;
      sum += r < 0.85 ? Math.max(0, 100 - (0.85 - r) * 250) : r > 1.6 ? Math.max(30, 100 - (r - 1.6) * 60) : 100;
    }
    for (let i = 0; i < STRIP.N; i++) { if (this.gd[i]) { cells++; if (this.flag[i] === 1) cold++; if (this.flag[i] === 2) hot++; } else if (this.over[i] > 0.35) over++; }
    const base = this.craters.length ? sum / this.craters.length : 100, notes = [];
    if (voids) notes.push(`Недолито кратеров: ${voids} — под протектором останутся пустоты.`);
    if (bumps) notes.push(`Перелив: ${bumps} — бугры придётся срезать, протектор ляжет неровно.`);
    if (cold) notes.push(`Холодная резина в ${Math.round(cold / cells * 100)}% кратеров — слабое сцепление.`);
    if (hot) notes.push(`Подгоревшая резина в ${Math.round(hot / cells * 100)}% — подвулканизация, брак.`);
    if (over > 20) notes.push(`Резина мимо кратеров: ${over} клеток — расход материала.`);
    if (!notes.length) notes.push('Все кратеры заполнены вровень, резина правильной температуры.');
    this.t.fillVoids = voids;
    G.finish({ score: base - (cells ? cold / cells * 60 + hot / cells * 80 : 0) - Math.min(20, over / 20), verdict: voids || hot || bumps ? 'Заделка с дефектами.' : 'Кратеры заделаны.', notes });
  },
});
})();
