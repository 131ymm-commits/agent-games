'use strict';
// Участок 6. Belegen — наложить готовый протектор (Laufstreifen) и прикатать (Anrollen).
(() => {
const G = RW2, { ctx, input, text, button, circle, R, clamp } = G;
const C = { x: 290, y: 335 }, RC = 165, A0 = -Math.PI / 2;
const ROLL = { x: 250, w: 460, top: 70, bot: 560, line: 330, speed: 160, len: 1600, revs: 4, rw: 90 };
function circumference(size) {
  const m = size.match(/(\d+)\/(\d+)\s*R([\d.]+)/), w = +m[1], ar = +m[2], rim = +m[3];
  return Math.round(Math.PI * (rim * 25.4 + 2 * w * ar / 100 - 20));
}

G.register({
  id: 'belegen', num: 6, de: 'Belegen', ru: 'Наложение протектора',
  short: 'Отрежь протектор точно по окружности каркаса и прикатай его роликом без пузырей воздуха.',
  intro: `Сборочный станок (Builder): на каркас автоматически ложится связующая резина (Bindegummi), затем с рольганга подаётся готовый протектор (Laufstreifen).

Шаг 1 — отрезать по длине:
• Протектор наматывается на каркас. Окружность каркаса измерена. Протектор режут чуть короче (натяг ≈0,6 %), чтобы стык сошёлся плотно.
• Зажми мышь — подача замедлится. «✂ Schneiden» (или клавиша C) — отрезать.

Шаг 2 — прикатать (Anrollen):
• Шина вращается, под протектором пузыри воздуха. Веди ролик мышью влево-вправо по ширине и выдави все пузыри за 4 оборота.`,
  init(t) {
    this.t = t; this.C = circumference(t.size); this.target = Math.round(this.C * 0.994);
    this.phase = 'bind'; this.timer = 0; this.laid = 0; this.cut = null; this.A = 0;
    this.bubbles = Array.from({ length: 18 }, () => ({ u: R(0, 1), v: R(0.06, 0.94), alive: true, pop: 0 }));
    this.scroll = 0; this.rollerX = ROLL.x + ROLL.w / 2;
  },
  frame(dt) {
    this.timer += dt;
    if (this.phase === 'bind' || this.phase === 'cut' || this.phase === 'splice') this.drawBuilder(dt);
    else this.drawRoll(dt);
  },
  drawBuilder(dt) {
    const frac = this.phase === 'bind' ? Math.min(1, this.timer / 1.6) : 1;
    circle(C.x, C.y, RC + 34, '#14161a');
    ctx.strokeStyle = '#3e4148'; ctx.lineWidth = 12; ctx.beginPath(); ctx.arc(C.x, C.y, RC - 2, A0, A0 + frac * Math.PI * 2); ctx.stroke();
    circle(C.x, C.y, RC - 8, '#33363c'); circle(C.x, C.y, RC - 60, '#24272c'); circle(C.x, C.y, 40, '#2f7ab8');
    if (this.phase === 'bind') { text(`Bindegummi экструдируется… ${Math.round(frac * 100)}%`, 560, 120, { size: 15, bold: true }); if (frac >= 1 && !G.locked) { this.phase = 'cut'; this.timer = 0; } return; }
    if (this.phase === 'cut' && !G.locked) {
      const slow = input.down && !G.overUI;
      this.laid += (slow ? 35 : 300) * dt;
      if (input.keyPressed.has('KeyC') || input.keyPressed.has('Enter') || this.laid > this.C * 1.08) this.doCut();
    }
    const L = this.cut ?? this.laid, ang = L / this.C * Math.PI * 2;
    ctx.strokeStyle = '#1d1e21'; ctx.lineWidth = 28; ctx.beginPath(); ctx.arc(C.x, C.y, RC + 14, A0, A0 + ang); ctx.stroke(); ctx.lineWidth = 1;
    ctx.strokeStyle = '#3b3c40';
    for (let a = 0; a < ang; a += 0.07) { const c = Math.cos(A0 + a), s = Math.sin(A0 + a); ctx.beginPath(); ctx.moveTo(C.x + c * (RC + 3), C.y + s * (RC + 3)); ctx.lineTo(C.x + c * (RC + 25), C.y + s * (RC + 25)); ctx.stroke(); }
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(C.x, C.y - RC - 34); ctx.lineTo(C.x, C.y - RC + 6); ctx.stroke(); ctx.lineWidth = 1;
    if (this.phase === 'cut') { // подача с рольганга
      const ex = C.x + Math.cos(A0 + ang) * (RC + 14), ey = C.y + Math.sin(A0 + ang) * (RC + 14);
      ctx.strokeStyle = '#1d1e21'; ctx.lineWidth = 22; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(40, 70); ctx.stroke(); ctx.lineWidth = 1;
      for (let k = 0; k < 5; k++) circle(60 + k * 28, 92, 8, '#8a939e');
    }
    G.panel(560, 80, 380, 250);
    text('Измерение', 580, 108, { size: 15, bold: true, color: '#f0a030' });
    text(`Окружность каркаса: ${this.C} мм`, 580, 136, { size: 14 });
    text(`Натяг ≈0,6 % → резать при ≈${this.target} мм`, 580, 160, { size: 14, color: '#62c370' });
    text(`Уложено протектора: ${Math.round(L)} мм`, 580, 196, { size: 20, bold: true, color: '#ffd166' });
    if (this.phase === 'cut') {
      text(input.down && !G.overUI ? 'Подача: медленно' : 'Подача: быстро (зажми мышь — медленнее)', 580, 224, { size: 13, color: '#aab' });
      if (button(580, 260, 220, 48, '✂ Schneiden (C)', { primary: true })) this.doCut();
    } else {
      const err = this.cut - this.target, ov = this.cut - this.C;
      text(err >= 0 ? `Отрезано длиннее на ${Math.round(err)} мм` : `Отрезано короче на ${Math.round(-err)} мм`, 580, 232, { size: 15, bold: true, color: Math.abs(err) <= 8 ? '#62c370' : '#e35d5d' });
      text(ov > 0 ? `Стык: нахлёст ${Math.round(ov)} мм` : `Стык: натяг ${(-ov / this.C * 100).toFixed(1)} %`, 580, 256, { size: 13 });
      if (this.timer > 2.2 && !G.locked) { this.phase = 'roll'; this.timer = 0; }
    }
  },
  doCut() {
    if (this.phase !== 'cut') return;
    this.cut = this.laid; this.phase = 'splice'; this.timer = 0;
    this.A = clamp(100 - Math.max(0, Math.abs(this.cut - this.target) - 8) * 1.6, 0, 100);
  },
  drawRoll(dt) {
    if (!G.locked) {
      this.scroll += ROLL.speed * dt;
      if (input.x > 0) this.rollerX = clamp(input.x, ROLL.x + ROLL.rw / 2, ROLL.x + ROLL.w - ROLL.rw / 2);
    }
    const { x, w, top, bot, line, len } = ROLL;
    ctx.save(); ctx.beginPath(); ctx.rect(x, top, w, bot - top); ctx.clip();
    ctx.fillStyle = '#26272b'; ctx.fillRect(x, top, w, bot - top);
    ctx.fillStyle = '#18191c';
    for (let y = top - 60 + (this.scroll % 60); y < bot; y += 60) { ctx.fillRect(x + 40, y, w - 80, 10); ctx.fillRect(x + 20, y + 30, 60, 8); ctx.fillRect(x + w - 80, y + 30, 60, 8); }
    for (const b of this.bubbles) {
      const by = top + ((b.u * len - this.scroll) % len + len) % len, bx = x + b.v * w;
      if (b.alive && Math.abs(by - line) < 12 && Math.abs(bx - this.rollerX) < ROLL.rw / 2 && !G.locked) { b.alive = false; b.pop = 0.4; }
      if (b.alive && by < bot) { circle(bx, by, 8, 'rgba(120,120,128,.8)'); circle(bx - 2.5, by - 2.5, 2.5, 'rgba(230,230,240,.8)'); }
      if (!b.alive && b.pop > 0) { b.pop -= dt; ctx.strokeStyle = `rgba(255,255,255,${b.pop * 2})`; ctx.beginPath(); ctx.arc(bx, by, 14 - b.pop * 15, 0, 7); ctx.stroke(); }
    }
    ctx.restore();
    ctx.fillStyle = '#c9a227'; G.rr(this.rollerX - ROLL.rw / 2, line - 9, ROLL.rw, 18, 8); ctx.fill();
    ctx.strokeStyle = '#7a6420'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(this.rollerX, line - 9); ctx.lineTo(this.rollerX + 40, 40); ctx.stroke(); ctx.lineWidth = 1;
    text('Anrollen — прикатка (протектор сверху, шина вращается)', x, 60, { size: 13, color: '#aab' });
    const left = this.bubbles.filter(b => b.alive).length, rev = this.scroll / len;
    G.panel(730, 80, 210, 160);
    text(`Пузырей: ${left}`, 746, 112, { size: 18, bold: true, color: left ? '#f0a030' : '#62c370' });
    text(`Оборот: ${Math.min(ROLL.revs, rev).toFixed(1)} / ${ROLL.revs}`, 746, 140, { size: 14 }); G.bar(746, 150, 178, 8, rev / ROLL.revs, '#f0a030');
    text(`Отрезка: ${Math.round(this.A)} баллов`, 746, 184, { size: 13, color: '#aab' });
    if (left === 0 || rev >= ROLL.revs) this.end();
  },
  end() {
    if (G.mode !== 'play') return;
    const left = this.bubbles.filter(b => b.alive).length, B = 100 * (1 - left / this.bubbles.length), notes = [];
    const err = this.cut - this.target;
    notes.push(Math.abs(err) <= 8 ? `Длина протектора точная (${Math.round(this.cut)} мм).` : `Длина протектора ошибочна на ${Math.round(err)} мм — ${err > 0 ? 'нахлёст на стыке' : 'перетяг, стык может разойтись'}.`);
    notes.push(left ? `Не выдавлено пузырей: ${left} — в автоклаве будут вздутия.` : 'Весь воздух выдавлен.');
    this.t.bubblesLeft = left; this.t.spliceErr = err;
    G.finish({ score: this.A * 0.5 + B * 0.5, verdict: left || Math.abs(err) > 20 ? 'Протектор наложен с дефектами.' : 'Протектор наложен.', notes });
  },
});
})();
