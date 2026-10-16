"""Собирает игру в один файл Reifenwerk.html (без сервера: открыть двойным кликом).

Запуск:  py -3 reifenwerk/build.py
"""
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


out = inline_scripts(read("index.html"))
target = ROOT / "Reifenwerk.html"
target.write_text(out, encoding="utf-8")
print(f"{target} — {len(out) // 1024} KB")
