"""Собирает всю игру в один файл Reifenwerk.html (без сервера: открыть двойным кликом).

Запуск:  py -3 reifenwerk/build.py
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent


def read(name):
    return (ROOT / name).read_text(encoding="utf-8")


def inline_scripts(html):
    """Заменяет <script src="x.js"></script> содержимым файла."""
    def repl(m):
        return "<script>\n" + read(m.group(1)) + "\n</script>"
    return re.sub(r'<script src="([^"]+)"></script>', repl, html)


back = 'href="#" onclick="if (parent.RWShow) parent.RWShow(\'{0}\'); return false;"'
werk = inline_scripts(read("index.html")).replace('href="stations.html"', back.format("stations"))
stations = inline_scripts(read("stations.html")).replace('href="index.html"', back.format("werk"))


def js_string(html):
    # "</" внутри строки закрыл бы внешний <script> — экранируем
    return json.dumps(html, ensure_ascii=False).replace("</", "<\\/")


LAUNCHER = """<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reifenwerk</title>
<style>
  html, body { height: 100%; margin: 0; }
  body { background: #17191e; color: #e7e7e7; font: 15px system-ui, "Segoe UI", Roboto, sans-serif; }
  #start { max-width: 980px; margin: 0 auto; padding: 28px 20px; }
  h1 { font-size: 42px; letter-spacing: 3px; color: #f0a030; margin: 0 0 4px; text-shadow: 4px 4px 0 #1e1c26, 0 0 0 #000; }
  .sub { color: #aab; margin-bottom: 22px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); gap: 16px; }
  .card { background: #23262e; border: 3px solid #1e1c26; box-shadow: 0 0 0 2px #3a3f4b, 6px 6px 0 #0d0e12; padding: 16px; display: flex; flex-direction: column; }
  .card h2 { margin: 0 0 6px; font-size: 19px; }
  .card ol, .card ul { margin: 8px 0 14px; padding-left: 20px; color: #ccd; line-height: 1.45; font-size: 14px; flex: 1; }
  .play { cursor: pointer; font: bold 17px system-ui, sans-serif; color: #1a1a1a; background: #f0a030; border: 3px solid #1e1c26; box-shadow: 4px 4px 0 #0d0e12; padding: 12px; }
  .play:hover { background: #ffbb55; }
  .play:active { transform: translate(2px, 2px); box-shadow: 2px 2px 0 #0d0e12; }
  .keys { margin-top: 20px; color: #aab; font-size: 13px; line-height: 1.6; }
  kbd { background: #2c3039; border: 1px solid #4a505c; border-radius: 3px; padding: 0 5px; color: #fff; }
  #game { position: fixed; inset: 0; display: none; }
  #game iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: none; background: #17191e; }
  #back { position: fixed; right: 10px; bottom: 10px; z-index: 5; cursor: pointer; font: bold 13px system-ui; background: #2c3039; color: #fff; border: 2px solid #1e1c26; box-shadow: 3px 3px 0 #0d0e12; padding: 7px 12px; }
  #back:hover { background: #3b404c; }
</style>
</head>
<body>
<div id="start">
  <h1>REIFENWERK</h1>
  <div class="sub">Цех восстановления грузовых шин в Германии. Холодный метод (Kaltrunderneuerung), 15 рабочих, 2 смены, цель — 80 шин в сутки.</div>
  <div class="cards">
    <div class="card">
      <h2>🏭 Весь цех</h2>
      <ol>
        <li>Цех уже работает: шины едут на крюках, люди берут инструмент и работают, погрузчики разгружают грузовики.</li>
        <li>Станки ломаются ⚠ — техник берёт ящик с инструментами в мастерской и чинит. Пыль у станков = больше поломок и брака, свободные рабочие подметают.</li>
        <li>Ты — мастер цеха: меняй приоритеты во вкладке <b>«Рабочие»</b>, нанимай людей, выбирай заказы сам (можно выключить автопринятие).</li>
        <li>Цель — 80 шин в сутки и прибыль.</li>
      </ol>
      <button class="play" data-go="werk">▶ Играть: весь цех</button>
    </div>
    <div class="card">
      <h2>🔧 Участки по отдельности</h2>
      <ul>
        <li>8 мини-игр — каждую операцию делаешь сам, мышью.</li>
        <li>Контроль, шероховка, зачистка, Gummilösung, пистолет-экструдер, протектор, автоклав, финальный контроль.</li>
        <li>В каждой игре кнопка <b>«? Задание»</b> объясняет, что делать.</li>
      </ul>
      <button class="play" data-go="stations">▶ Выбрать участок</button>
    </div>
    <div class="card">
      <h2>🛞 Шина целиком</h2>
      <ul>
        <li>Одна шина проходит все 8 участков подряд.</li>
        <li>Ошибки, сделанные раньше, всплывают в конце: брак или рекламация от клиента.</li>
        <li>В конце — итог и ожидаемый пробег шины.</li>
      </ul>
      <button class="play" data-go="campaign">▶ Начать с первой шины</button>
    </div>
  </div>
  <div class="keys">
    В цехе: <kbd>Пробел</kbd> — пауза, <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> — скорость, колесо мыши или <kbd>+</kbd> <kbd>−</kbd> — приблизить,
    <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> или правая кнопка мыши — двигать камеру, клик по человечку или станку — подробности,
    кнопка «🎨 Графика» сверху — пиксели или схема. В мини-играх всё делается мышью.
    Кнопка «← Меню» внизу справа возвращает сюда.
  </div>
</div>
<div id="game">
  <iframe id="f-werk" title="Весь цех"></iframe>
  <iframe id="f-stations" title="Участки"></iframe>
  <button id="back">← Меню</button>
</div>
<script>
const PAGES = { werk: __WERK__, stations: __STATIONS__ };
const frames = { werk: document.getElementById('f-werk'), stations: document.getElementById('f-stations') };
function show(which, campaign) {
  document.getElementById('start').style.display = 'none';
  document.getElementById('game').style.display = 'block';
  for (const [k, f] of Object.entries(frames)) f.style.display = k === which ? 'block' : 'none';
  const f = frames[which];
  const go = () => {
    const w = f.contentWindow;
    if (which === 'stations' && w.RW2) { if (campaign) w.RW2.startCampaign(); else if (w.RW2.mode !== 'play') w.RW2.toMenu(); }
    f.focus();
  };
  if (!f.srcdoc) { f.onload = go; f.srcdoc = PAGES[which]; } else go();
}
window.RWShow = which => show(which, false);
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
  const g = b.dataset.go; show(g === 'campaign' ? 'stations' : g, g === 'campaign');
}));
document.getElementById('back').addEventListener('click', () => {
  document.getElementById('game').style.display = 'none';
  document.getElementById('start').style.display = 'block';
});
</script>
</body>
</html>
"""

out = LAUNCHER.replace("__WERK__", js_string(werk)).replace("__STATIONS__", js_string(stations))
target = ROOT / "Reifenwerk.html"
target.write_text(out, encoding="utf-8")
print(f"{target} — {len(out) // 1024} KB")
