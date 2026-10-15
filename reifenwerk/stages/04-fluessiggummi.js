'use strict';
// Участок 4. Flüssiggummi — напыление жидкой резины (Gummilösung) в кабине с вытяжкой.
(() => {
const G = RW2, { ctx, input, text, button, circle, STRIP, R, clamp } = G;
const OK_MIN = 0.75, OK_MAX = 1.9, RUN = 2.6, LEL_ALARM = 40;

G.register({
  id: 'spray', num: 4, de: 'Flüssiggummi', ru: 'Напыление жидкой резины',
  short: 'Покрой всю поверхность ровным слоем Gummilösung. Без пропусков, без подтёков, с включённой вытяжкой.',
  intro: `Зачищенный каркас в окрасочной кабине. Пистолетом напыляют жидкую резину (Gummilösung) — она связывает ремонтную резину и протектор с каркасом.

• Включи вытяжку (Absaugung) ДО начала работы: растворитель летучий и горючий. Датчик взрывоопасной концентрации (UEG/LEL) при 40 % блокирует пистолет.
• Зажми мышь и веди пистолет по поверхности ровными полосами. Нужен один ровный слой: блестящая тёмная плёнка.
• Не держи пистолет на одном месте — будут подтёки (Läufer).
• Пропусков быть не должно, кратеры тоже покрываются.
• Потом «Ablüften»: слой должен подсохнуть до липкости (15 мин). Не торопись дальше.`,
  init(t) {
    G.ensureCraters(t); this.t = t; this.gd = t.groundDepth; this.cov = new Float32Array(STRIP.N);
    this.fan = false; this.lel = 0; this.alarm = false; this.alarms = 0; this.sprayedNoFan = 0;
    this.phase = 'spray'; this.dry = 0; this.mist = []; this.grid = STRIP.canvas(); this.fanA = 0;
  },
  frame(dt) {
    const spraying = this.phase === 'spray' && !G.locked && input.down && STRIP.inside(input.x, input.y) && !this.alarm;
    if (spraying) {
      STRIP.forDisc(input.x, input.y, 9, (i, f) => { this.cov[i] += dt * 9 * Math.exp(-f * f * 4.5); });
      for (let k = 0; k < 3; k++) this.mist.push({ x: input.x + R(-20, 20), y: input.y + R(-20, 20), vy: R(-20, -60), life: R(0.6, 1.4) });
      if (!this.fan) this.sprayedNoFan += dt;
    }
    this.lel = clamp(this.lel + (spraying ? (this.fan ? 1.2 : 9) : 0) * dt - (this.fan ? 7 : 0.6) * dt, 0, 100);
    if (!this.alarm && this.lel >= LEL_ALARM) { this.alarm = true; this.alarms++; }
    if (this.alarm && this.lel < 20) this.alarm = false;
    for (const p of this.mist) { p.y += p.vy * dt; p.x += (this.fan ? 60 : R(-10, 10)) * dt; p.life -= dt * (this.fan ? 1.6 : 0.6); }
    this.mist = this.mist.filter(p => p.life > 0);
    if (this.fan) this.fanA += dt * 12;

    // кабина
    ctx.fillStyle = '#20252b'; ctx.fillRect(20, 50, 920, 400); ctx.strokeStyle = '#3c4552'; ctx.strokeRect(20, 50, 920, 400);
    ctx.save(); ctx.translate(900, 90); ctx.rotate(this.fanA); for (let k = 0; k < 4; k++) { ctx.rotate(Math.PI / 2); ctx.fillStyle = this.fan ? '#8fb3d9' : '#55606c'; ctx.fillRect(0, -5, 22, 10); } ctx.restore();
    text('Absaugung', 866, 130, { size: 11, color: '#aab' });

    for (let i = 0; i < STRIP.N; i++) {
      const b = STRIP.baseColor(i, this.gd[i]), c = this.cov[i];
      if (c <= 0) { STRIP.set(this.grid, i, b[0], b[1], b[2]); continue; }
      if (c > RUN) { STRIP.set(this.grid, i, 26, 30, 44); continue; }
      const k = Math.min(1, c / 1.1), g = 18 + G.NOISE[i] * 8 + (c > OK_MAX ? -6 : 0);
      STRIP.set(this.grid, i, b[0] + (g - b[0]) * k, b[1] + (g - b[1]) * k, b[2] + (g + 4 - b[2]) * k);
    }
    STRIP.blit(this.grid);
    for (let i = 0; i < STRIP.N; i += 7) if (this.cov[i] > RUN) { const x = STRIP.x + (i % STRIP.gw) * STRIP.cs, y = STRIP.y + Math.floor(i / STRIP.gw) * STRIP.cs; ctx.fillStyle = 'rgba(20,24,36,.9)'; ctx.fillRect(x + 1, y, 2, 12); }
    for (const p of this.mist) circle(p.x, p.y, 6, `rgba(150,160,170,${0.12 * p.life})`);
    if (STRIP.inside(input.x, input.y) && this.phase === 'spray') {
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(input.x, input.y, 18, 0, 7); ctx.stroke();
      ctx.fillStyle = '#777f8a'; ctx.fillRect(input.x + 10, input.y + 10, 14, 34); ctx.fillStyle = '#c0392b'; ctx.fillRect(input.x + 6, input.y + 40, 22, 10);
    }

    // статистика покрытия
    let ok = 0, thin = 0, runs = 0;
    for (let i = 0; i < STRIP.N; i++) { const c = this.cov[i]; if (c > RUN) runs++; else if (c >= OK_MIN && c <= OK_MAX) ok++; else if (c < OK_MIN) thin++; }
    this.stats = { ok: ok / STRIP.N, thin: thin / STRIP.N, runs: runs / STRIP.N };
    text(`Ровный слой: ${Math.round(this.stats.ok * 100)}%`, 50, 482, { size: 15, bold: true, color: this.stats.ok > 0.9 ? '#62c370' : '#f0a030' });
    text(`Пропуски: ${Math.round(this.stats.thin * 100)}% · подтёки: ${Math.round(this.stats.runs * 100)}%`, 50, 506, { size: 13, color: '#ccd' });
    G.gauge(330, 476, 220, 'Датчик UEG (взрывоопасность)', this.lel, 0, 100, 0, LEL_ALARM - 1, '%');
    if (this.alarm) text('⚠ АВАРИЯ: концентрация паров! Пистолет заблокирован', 330, 524, { size: 13, bold: true, color: '#e35d5d' });
    if (this.phase === 'spray') {
      if (button(640, 466, 140, 38, this.fan ? 'Absaugung: AN' : 'Absaugung: AUS', this.fan ? { on: true, size: 13 } : { danger: true, size: 13 })) this.fan = !this.fan;
      if (button(640, 514, 280, 44, 'Fertig → Ablüften (сушка)', { primary: true })) this.phase = 'dry';
    } else {
      this.dry += dt; const f = Math.min(1, this.dry / 5);
      text(`Ablüften: ${Math.round(f * 15)} из 15 мин`, 640, 482, { size: 14, bold: true }); G.bar(640, 490, 280, 10, f, '#f0a030');
      if (button(640, 514, 280, 44, f < 1 ? 'Дальше (ещё не высохло!)' : 'Дальше ▸', { primary: f >= 1 })) this.end(f < 1);
      if (f >= 1 && !G.locked) this.end(false);
    }
  },
  end(early) {
    if (G.mode !== 'play') return;
    const s = this.stats, notes = [];
    if (s.thin > 0.02) notes.push(`Пропуски на ${Math.round(s.thin * 100)}% поверхности — там протектор не приклеится.`);
    if (s.runs > 0.005) notes.push(`Подтёки (Läufer) на ${Math.round(s.runs * 100)}% — толстый слой даёт пузыри.`);
    if (this.alarms) notes.push(`Аварий по парам растворителя: ${this.alarms}. Вытяжку включают до напыления.`);
    else if (this.sprayedNoFan > 0.5) notes.push('Часть работы без вытяжки — нарушение техники безопасности.');
    if (early) notes.push('Слой не просох — растворитель останется под протектором: пузыри в автоклаве.');
    if (!notes.length) notes.push('Ровная плёнка без пропусков и подтёков, кабина под вытяжкой.');
    this.t.sprayEarly = early;
    G.finish({ score: s.ok * 100 - s.runs * 150 - this.alarms * 15 - (this.sprayedNoFan > 0.5 && !this.alarms ? 10 : 0) - (early ? 25 : 0), verdict: s.ok > 0.9 && !early ? 'Gummilösung нанесена правильно.' : 'Слой неровный или нарушена технология.', notes });
  },
});
})();
