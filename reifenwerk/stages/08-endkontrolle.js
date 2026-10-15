'use strict';
// Участок 8. Fehlerbeseitigung + Endkontrolle — после автоклава: облой, пузыри, отслоения, решение.
(() => {
const G = RW2, { ctx, input, text, button, circle, R, RI, clamp } = G;
const T = { x: 80, y: 150, w: 800, h: 210 }, SW = { y: 400, h: 50 }, SEG = 16;

G.register({
  id: 'endk', num: 8, de: 'Endkontrolle', ru: 'Дефекты и финальный контроль',
  short: 'Срежь облой, устрани мелкие пузыри, найди отслоения и реши: отправка, переделка или лом.',
  intro: `Шина вышла из автоклава, чехлы сняты. Теперь устраняют дефекты (Fehlerbeseitigung) и принимают решение.

• Облой (Austrieb) — тонкие выдавленные полоски резины по краям протектора. Зажми мышь и проведи ножом вдоль кромки, чтобы срезать.
• Мелкие пузыри (Blasen) на протекторе — кликни, чтобы зашлифовать и исправить.
• Отслоение (Ablösung) у плеча — тёмная щель. Здесь его не исправить: шина идёт на переделку (Nacharbeit).
• Вздутие на боковине — каркас повреждён: в лом.
• Реши: «Versand» — маркировка ECE R109 и отправка клиенту, «Nacharbeit» или «Schrott».`,
  init(t) {
    this.t = t;
    const keys = ['rauen', 'ausschl', 'spray', 'spachtel', 'belegen', 'autoklav'].filter(k => t.scores[k] != null);
    const avg = keys.length ? keys.reduce((a, k) => a + t.scores[k], 0) / keys.length : null;
    let p = avg == null ? 0.3 : clamp((78 - avg) / 55, 0.03, 0.9);
    if (t.cureBad || t.sprayEarly || t.rauHit) p = Math.max(p, 0.6);
    this.sep = G.rnd() < p; this.fatal = !!t.hiddenFatal || (avg == null && G.rnd() < 0.12);
    this.flash = []; for (const side of [0, 1]) for (let k = 0; k < SEG; k++) this.flash.push({ side, k, cut: false, wob: R(0, 6) });
    const nb = (t.bubblesLeft != null ? Math.min(4, t.bubblesLeft) : RI(0, 2)) + (avg != null && avg < 60 ? 1 : 0);
    this.bubbles = Array.from({ length: nb }, () => ({ x: R(T.x + 40, T.x + T.w - 40), y: R(T.y + 40, T.y + T.h - 40), fixed: 0 }));
    this.sepK = RI(2, SEG - 3); this.sepSide = RI(0, 1); this.bulgeX = R(200, 760);
    this.msg = ''; this.msgT = 0;
  },
  frame(dt) {
    const segW = T.w / SEG;
    // протектор (вид сверху)
    ctx.fillStyle = '#202124'; ctx.fillRect(T.x, T.y, T.w, T.h);
    ctx.fillStyle = '#121214';
    for (let x = 10; x < T.w - 20; x += 46) for (let r = 0; r < 4; r++) ctx.fillRect(T.x + x + (r % 2) * 18, T.y + 18 + r * 48, 22, 30);
    text('Протектор после автоклава (вид сверху)', T.x, T.y - 30, { size: 12, color: '#aab' });
    // облой по кромкам
    for (const f of this.flash) {
      if (f.cut) continue;
      const x0 = T.x + f.k * segW, ey = f.side ? T.y + T.h : T.y, dir = f.side ? 1 : -1;
      ctx.fillStyle = '#3c3d42'; ctx.beginPath(); ctx.moveTo(x0, ey);
      for (let s = 0; s <= 10; s++) ctx.lineTo(x0 + s / 10 * segW, ey + dir * (6 + Math.sin(s + f.wob) * 3));
      ctx.lineTo(x0 + segW, ey); ctx.closePath(); ctx.fill();
    }
    // отслоение
    if (this.sep) { const sx = T.x + this.sepK * segW, sy = this.sepSide ? T.y + T.h - 14 : T.y + 6; ctx.fillStyle = '#000'; ctx.fillRect(sx, sy, segW * 1.6, 8); ctx.strokeStyle = '#55575d'; ctx.strokeRect(sx, sy - 2, segW * 1.6, 12); }
    // пузыри
    for (const b of this.bubbles) {
      if (b.fixed > 0) { circle(b.x, b.y, 10, '#5a554f'); continue; }
      circle(b.x, b.y, 9, '#3d3e44'); circle(b.x - 3, b.y - 3, 3, '#8a8c93');
    }
    // боковина
    ctx.fillStyle = '#1a1b1e'; ctx.fillRect(T.x, SW.y, T.w, SW.h);
    text(`${this.t.brand.split(' ')[0].toUpperCase()} · ${this.t.size} · RETREAD`, T.x + 20, SW.y + 31, { size: 15, bold: true, color: '#3a3b40' });
    if (this.fatal) { const g = ctx.createRadialGradient(this.bulgeX, SW.y + 25, 2, this.bulgeX, SW.y + 25, 30); g.addColorStop(0, '#5d6067'); g.addColorStop(1, 'rgba(26,27,30,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(this.bulgeX, SW.y + 25, 34, 20, 0, 0, 7); ctx.fill(); }
    text('Боковина (Seitenwand)', T.x, SW.y - 6, { size: 12, color: '#aab' });
    // инструменты
    if (!G.locked && input.down) for (const f of this.flash) {
      const x0 = T.x + f.k * segW, ey = f.side ? T.y + T.h : T.y;
      if (!f.cut && input.x >= x0 && input.x <= x0 + segW && Math.abs(input.y - ey) < 14) f.cut = true;
    }
    if (!G.locked && input.pressed) {
      const b = this.bubbles.find(b => !b.fixed && Math.hypot(b.x - input.x, b.y - input.y) < 14); if (b) b.fixed = 1;
      if (this.sep) { const sx = T.x + this.sepK * segW, sy = this.sepSide ? T.y + T.h - 10 : T.y + 10; if (input.x > sx - 10 && input.x < sx + segW * 1.6 + 10 && Math.abs(input.y - sy) < 16) { this.msg = 'Отслоение протектора: здесь не исправить → Nacharbeit.'; this.msgT = 3; } }
    }
    if (input.down && (Math.abs(input.y - T.y) < 20 || Math.abs(input.y - T.y - T.h) < 20)) { ctx.strokeStyle = '#d0d4da'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(input.x, input.y); ctx.lineTo(input.x + 26, input.y - 26); ctx.stroke(); ctx.lineWidth = 1; }
    if (this.msgT > 0) { this.msgT -= dt; text(this.msg, T.x, 118, { size: 14, bold: true, color: '#f0a030' }); }
    const cut = this.flash.filter(f => f.cut).length, fixed = this.bubbles.filter(b => b.fixed).length;
    text(`Облой срезан: ${cut} / ${this.flash.length}   ·   пузыри исправлены: ${fixed} / ${this.bubbles.length}`, T.x, 482, { size: 14 });
    if (button(80, 512, 260, 48, '✓ Versand (ECE R109)', { primary: true })) this.decide('versand');
    if (button(360, 512, 200, 48, '↺ Nacharbeit')) this.decide('nacharbeit');
    if (button(580, 512, 180, 48, '✗ Schrott', { danger: true })) this.decide('schrott');
  },
  decide(d) {
    if (G.mode !== 'play') return;
    const exp = this.fatal ? 'schrott' : this.sep ? 'nacharbeit' : 'versand', notes = [];
    const cutF = this.flash.filter(f => f.cut).length / this.flash.length, fixF = this.bubbles.length ? this.bubbles.filter(b => b.fixed).length / this.bubbles.length : 1;
    let score = d === exp ? 50 : (d === 'versand' ? 0 : 15);
    if (this.fatal) notes.push('На боковине вздутие — каркас повреждён: только в лом.');
    if (this.sep) notes.push('У плеча отслоение протектора — шину на переделку.');
    if (!this.fatal && !this.sep) notes.push('Скрытых дефектов нет — шину можно отправлять.');
    if (d === 'versand' && exp !== 'versand') notes.push('Дефектная шина ушла клиенту → рекламация!');
    if (d !== 'versand' && exp === 'versand') notes.push('Годная шина задержана — потеря времени и денег.');
    if (cutF < 1) notes.push(`Облой срезан не полностью (${Math.round(cutF * 100)}%).`);
    if (fixF < 1) notes.push('Не все пузыри исправлены.');
    score += cutF * 25 + fixF * 25;
    if (d === 'versand' && (cutF < 1 || fixF < 1)) score -= 15;
    this.t.outcome = d; this.t.expected = exp;
    G.finish({ score, verdict: d === exp ? 'Решение верное.' : 'Решение неверное.', notes, endCampaign: true });
  },
});
})();
