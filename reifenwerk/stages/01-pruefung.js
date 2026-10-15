'use strict';
// Участок 1. Eingangsprüfung — входной контроль каркаса со скользящим светом.
(() => {
const G = RW2, { ctx, input, text, button, circle } = G;
const OUT = { x: 60, y: 130, w: 840, h: 140 }, INN = { x: 60, y: 330, w: 840, h: 110 }, LAMP = 85;
const inRect = (r, x, y, pad = 0) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
const pos = d => { const r = d.where === 'aussen' ? OUT : INN; return { x: r.x + d.u * r.w, y: r.y + d.v * r.h }; };

function drawStrips(bright, age) {
  ctx.save(); ctx.beginPath(); ctx.rect(OUT.x, OUT.y, OUT.w, OUT.h); ctx.clip();
  ctx.fillStyle = bright ? '#2a2a2c' : '#0b0b0c'; ctx.fillRect(OUT.x, OUT.y, OUT.w, OUT.h);
  ctx.fillStyle = bright ? '#3b3b3e' : '#111113';
  for (let row = 0; row < 4; row++) for (let bx = -21; bx < OUT.w; bx += 42) ctx.fillRect(OUT.x + bx + (row % 2) * 21 + 3, OUT.y + 8 + row * 33, 32, 25);
  if (bright && age > 5) { // трещины старения на плечах
    ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.lineWidth = 1;
    for (let k = 0; k < 90; k++) { const x = OUT.x + (k * 97 % OUT.w), y = OUT.y + (k % 2 ? 6 : OUT.h - 8); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 6, y + (k % 3) - 1); ctx.stroke(); }
  }
  ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.rect(INN.x, INN.y, INN.w, INN.h); ctx.clip();
  ctx.fillStyle = bright ? '#3a3c41' : '#0d0d0f'; ctx.fillRect(INN.x, INN.y, INN.w, INN.h);
  ctx.strokeStyle = bright ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.015)';
  for (let k = -INN.h; k < INN.w; k += 9) { ctx.beginPath(); ctx.moveTo(INN.x + k, INN.y); ctx.lineTo(INN.x + k + INN.h, INN.y + INN.h); ctx.stroke(); }
  ctx.restore();
}
function drawDefect(d) {
  const p = pos(d);
  if (d.type === 'nagel') { circle(p.x + 2, p.y + 2, 6.5, 'rgba(0,0,0,.6)'); circle(p.x, p.y, 6, '#9aa3ad'); circle(p.x - 2, p.y - 2, 2, '#e5e9ee'); }
  else if (d.type === 'schnitt') {
    const L = d.size * 2.2; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(d.ang);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(-L / 2, 0); ctx.lineTo(L / 2, 0); ctx.stroke();
    ctx.strokeStyle = '#66666b'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-L / 2, -2.5); ctx.lineTo(L / 2, -2.5); ctx.stroke(); ctx.restore();
  } else if (d.type === 'beule') {
    const g = ctx.createRadialGradient(p.x - 5, p.y - 4, 2, p.x, p.y, 26); g.addColorStop(0, '#8a8e96'); g.addColorStop(1, 'rgba(58,60,65,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(p.x, p.y, 28, 17, 0, 0, 7); ctx.fill();
  } else if (d.type === 'kord') {
    ctx.fillStyle = '#17171a'; ctx.beginPath(); ctx.ellipse(p.x, p.y, 20, 12, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = '#b08850'; ctx.lineWidth = 1.5;
    for (let k = 0; k < 7; k++) { ctx.beginPath(); ctx.moveTo(p.x - 15 + k * 5, p.y - 9); ctx.lineTo(p.x - 11 + k * 5, p.y + 9); ctx.stroke(); }
  }
}

G.register({
  id: 'pruef', num: 1, de: 'Eingangsprüfung', ru: 'Входной контроль',
  short: 'Лампой скользящего света найди повреждения, проверь DOT и реши: годен или в лом.',
  intro: `Каркас приехал от клиента. Прежде чем тратить на него работу и материалы, его проверяют на стенде-расширителе бортов.

• Двигай мышью лампу: в скользящем свете видны повреждения на протекторе (вверху) и на внутреннем слое (внизу).
• Кликни по каждому повреждению, чтобы отметить его. Лишние отметки снижают оценку.
• Смотри DOT-код: последние 4 цифры — неделя и год выпуска. Каркас старше 6 лет — в лом.
• Вздутие (Beule) или оголённый корд (Kord) внутри — в лом. Гвозди (Nagel) и порезы (Schnitt) на протекторе — ремонтируются.
• Реши: «годен» или «Schrott».`,
  init(t) { this.t = t; this.defects = t.defects.map(d => ({ ...d, found: false })); this.falseMarks = []; },
  frame(dt) {
    const t = this.t;
    text(`Боковина: ${t.brand} · ${t.size} · `, 60, 92, { size: 15, color: '#bbb' });
    ctx.font = 'bold 15px system-ui'; const w0 = ctx.measureText(`Боковина: ${t.brand} · ${t.size} · `).width;
    text(t.dot, 60 + w0 + 6, 92, { size: 15, bold: true, color: '#ffd166' });
    text('Lauffläche — протектор снаружи', OUT.x, OUT.y - 8, { size: 12, color: '#aab' });
    text('Innenseele — внутренний слой', INN.x, INN.y - 8, { size: 12, color: '#aab' });
    drawStrips(false, t.age);
    const near = inRect(OUT, input.x, input.y, LAMP) || inRect(INN, input.x, input.y, LAMP);
    if (near) {
      ctx.save(); ctx.beginPath(); ctx.arc(input.x, input.y, LAMP, 0, 7); ctx.clip();
      drawStrips(true, t.age); for (const d of this.defects) drawDefect(d);
      const g = ctx.createRadialGradient(input.x, input.y, LAMP * 0.45, input.x, input.y, LAMP);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.9)'); ctx.fillStyle = g; ctx.fillRect(input.x - LAMP, input.y - LAMP, LAMP * 2, LAMP * 2);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,240,200,.35)'; ctx.beginPath(); ctx.arc(input.x, input.y, LAMP, 0, 7); ctx.stroke();
    }
    for (const d of this.defects) if (d.found) { const p = pos(d); ctx.strokeStyle = '#62c370'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 16, 0, 7); ctx.stroke(); ctx.lineWidth = 1; }
    for (const m of this.falseMarks) { ctx.strokeStyle = '#e35d5d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(m.x - 6, m.y - 6); ctx.lineTo(m.x + 6, m.y + 6); ctx.moveTo(m.x + 6, m.y - 6); ctx.lineTo(m.x - 6, m.y + 6); ctx.stroke(); ctx.lineWidth = 1; }
    if (!G.locked && input.pressed && (inRect(OUT, input.x, input.y) || inRect(INN, input.x, input.y))) {
      const hit = this.defects.find(d => !d.found && Math.hypot(pos(d).x - input.x, pos(d).y - input.y) < 22);
      if (hit) hit.found = true; else if (!this.defects.some(d => d.found && Math.hypot(pos(d).x - input.x, pos(d).y - input.y) < 22)) this.falseMarks.push({ x: input.x, y: input.y });
    }
    const found = this.defects.filter(d => d.found).length;
    text(`Отмечено повреждений: ${found} · ложных отметок: ${this.falseMarks.length}`, 60, 480, { size: 14 });
    if (button(300, 515, 280, 46, '✓ Годен → на восстановление', { primary: true })) this.decide(false);
    if (button(600, 515, 200, 46, '✗ Schrott — в лом', { danger: true })) this.decide(true);
  },
  decide(scrap) {
    if (G.mode !== 'play') return;
    const t = this.t, need = this.defects.length, found = this.defects.filter(d => d.found).length;
    const correct = scrap === t.shouldScrap, notes = [];
    const missed = this.defects.filter(d => !d.found);
    if (missed.length) notes.push(`Не найдено: ${missed.map(d => ({ nagel: 'гвоздь', schnitt: 'порез', beule: 'вздутие внутри', kord: 'оголённый корд' }[d.type])).join(', ')}.`);
    if (this.falseMarks.length) notes.push(`Ложных отметок: ${this.falseMarks.length} (−4 за каждую).`);
    if (t.age > 6) notes.push(`DOT ${t.dot.slice(-4)}: каркасу ${t.age} лет — старше 6 лет.`);
    if (t.fatal) notes.push('Внутри было повреждение каркаса — такой каркас не восстанавливают.');
    if (!correct && !scrap) notes.push('Плохой каркас пошёл в работу — дефект всплывёт на финальном контроле или у клиента.');
    if (!correct && scrap) notes.push('Годный каркас отправлен в лом — потеряно около 150 €.');
    t.stage1Scrap = scrap; t.hiddenFatal = !scrap && t.shouldScrap;
    G.finish({ score: (correct ? 60 : 0) + 40 * found / need - Math.min(20, this.falseMarks.length * 4), verdict: correct ? (scrap ? 'Верно: каркас в лом.' : 'Верно: каркас годен для восстановления.') : 'Неверное решение по каркасу.', notes, endCampaign: scrap });
  },
});
})();
