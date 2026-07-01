#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_links.py — проверка живых ссылок и якорей дизайн-вики NEXUS.
Полиглот-принцип: Python как «фабрика данных». Запуск:  python check_links.py
Делает:
  1) находит markdown-ссылки на .md (с опциональным #якорем);
  2) проверяет, что файл существует (жёсткая ошибка) и якорь резолвится в заголовок (мягкое предупреждение);
  3) строит обратный индекс «Сюда ссылаются» (backlinks);
  4) пишет отчёт 00-meta/LINKCHECK.md и печатает сводку.
Ничего в самих документах не меняет.
"""
import os, re, glob, sys
try:
    sys.stdout.reconfigure(encoding='utf-8')   # Windows-консоль: Cyrillic в stdout
except Exception:
    pass

META_DIR = os.path.dirname(os.path.abspath(__file__))
DESIGN   = os.path.dirname(META_DIR)
LINK_RE  = re.compile(r'\]\(([^)#]+?\.md)(#[^)]*)?\)')
HEAD_RE  = re.compile(r'^(#{1,6})\s+(.*?)\s*#*$', re.M)

def gh_slug(text):
    s = re.sub(r'[`*_]', '', text.strip().lower())   # снять inline-разметку
    s = re.sub(r'[^\w\s-]', '', s, flags=re.UNICODE)  # GitHub: оставить букв/цифр/пробел/дефис (кириллица ок)
    return s.strip().replace(' ', '-')

# собрать все доки и их slug-заголовков
slugs = {}   # abs_path -> set(slug)
for p in glob.glob(os.path.join(DESIGN, '**', '*.md'), recursive=True):
    ap = os.path.normpath(p)
    if os.path.basename(ap) == 'LINKCHECK.md':
        continue
    if re.search(r'копия|\bcopy\b|\.bak', os.path.basename(ap), re.I):   # рабочие копии — не документы вики
        continue
    try:
        t = open(ap, encoding='utf-8').read()
    except Exception:
        continue
    slugs[ap] = {gh_slug(m.group(2)) for m in HEAD_RE.finditer(t)}

broken_file, broken_anchor, backlinks = [], [], {}
def get_slugs(path):                       # slug-набор для любого файла (в т.ч. вне design/)
    if path not in slugs:
        try:
            tt = open(path, encoding='utf-8').read()
            slugs[path] = {gh_slug(m.group(2)) for m in HEAD_RE.finditer(tt)}
        except Exception:
            slugs[path] = set()
    return slugs[path]

for ap in [p for p in slugs]:              # снимок ключей = доки design/
    t = open(ap, encoding='utf-8').read()
    for href, frag in LINK_RE.findall(t):
        if href.startswith(('http://', 'https://')):
            continue
        tgt = os.path.normpath(os.path.join(os.path.dirname(ap), href))
        rel_src = os.path.relpath(ap, DESIGN).replace('\\', '/')
        if not os.path.exists(tgt):        # проверка по реальной ФС, а не только по design/
            broken_file.append((rel_src, href + (frag or '')))
            continue
        backlinks.setdefault(tgt, set()).add(rel_src)
        if frag and frag[1:] not in get_slugs(tgt):
            broken_anchor.append((rel_src, href + frag))

# --- отчёт ---
out = ['# LINKCHECK — отчёт по ссылкам дизайн-вики', '',
       f'Документов: **{len(slugs)}**. Битых файловых ссылок: **{len(broken_file)}**. '
       f'Непроверенных якорей (renderer-зависимо, мягко): **{len(broken_anchor)}**.', '',
       '> Генерируется `check_links.py`. Файловые ошибки — точные. Якоря — приближённый GitHub-slug.', '',
       '## ❌ Битые файловые ссылки (точно — нужно чинить)', '']
if broken_file:
    out.append('| Документ | Битая ссылка |'); out.append('|---|---|')
    for s, h in sorted(broken_file):
        out.append(f'| {s} | `{h}` |')
else:
    out.append('_нет_')
out += ['', '## ⚠️ Якоря, не найденные по GitHub-slug (проверить вручную)', '']
if broken_anchor:
    out.append('| Документ | Ссылка с якорем |'); out.append('|---|---|')
    for s, h in sorted(broken_anchor):
        out.append(f'| {s} | `{h}` |')
else:
    out.append('_нет_')
out += ['', '## 🔁 Backlinks — «Сюда ссылаются»', '']
out.append('| Документ | Источники ссылок |'); out.append('|---|---|')
for tgt in sorted(backlinks):
    rel_t = os.path.relpath(tgt, DESIGN).replace('\\', '/')
    srcs = ', '.join(sorted(os.path.basename(s) for s in backlinks[tgt]))
    out.append(f'| {rel_t} | {srcs} |')
out.append('')

open(os.path.join(META_DIR, 'LINKCHECK.md'), 'w', encoding='utf-8').write('\n'.join(out))

print(f'Документов: {len(slugs)} | битых файловых ссылок: {len(broken_file)} | якорь-warn: {len(broken_anchor)}')
if broken_file:
    print('--- БИТЫЕ ФАЙЛОВЫЕ ССЫЛКИ ---')
    for s, h in sorted(broken_file):
        print(f'  {s}  ->  {h}')
print('Отчёт: 00-meta/LINKCHECK.md')

# --- гейт (ratchet): --strict → любая битая = стоп; --max-broken N → стоп, если стало БОЛЬШЕ N ---
n = len(broken_file)
strict = '--strict' in sys.argv
max_broken = None
for i, a in enumerate(sys.argv):
    if a == '--max-broken' and i + 1 < len(sys.argv):
        try: max_broken = int(sys.argv[i + 1])
        except ValueError: pass
if strict and n > 0:
    print(f'ГЕЙТ: strict — {n} битых файловых ссылок > 0. Стоп.')
    sys.exit(1)
if max_broken is not None:
    if n > max_broken:
        print(f'ГЕЙТ: битых файловых ссылок {n} > базовой линии {max_broken}. Появились новые — стоп.')
        sys.exit(1)
    if n < max_broken:
        print(f'ГЕЙТ: битых стало меньше ({n} < {max_broken}). Можно понизить .linkcheck-baseline до {n}.')
