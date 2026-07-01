#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check_style.py — слой СТИЛЬ/ГРАММАТИКА-LITE (без внешних зависимостей).
Ловит надёжные дефекты формы: склейки слов «низ→ВЕРХ» (началаДля) и двойные пробелы.
ОГРАНИЧЕНИЕ: склейки строчная+строчная (рождаютсяиз) ловит только словарь/LanguageTool — см. отчёт.
Запуск: python check_style.py
"""
import os, re, glob, sys
import nx_common as C                        # Проход Б: единый скан документов
try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass

META = os.path.dirname(os.path.abspath(__file__)); DESIGN = os.path.dirname(META)
GLUE = re.compile(r'[а-яё][А-ЯЁ]')          # строчная→ЗАГЛАВНАЯ внутри слова — почти всегда склейка
DBL  = re.compile(r'\S(  +)\S')             # двойные+ пробелы между непустыми

def strip_code(t):
    t = re.sub(r'```.*?```', '', t, flags=re.S)   # снять fenced-блоки кода
    t = re.sub(r'`[^`]*`', '', t)                  # снять inline-код
    t = re.sub(r'^---\n.*?\n---\n', '', t, flags=re.S)  # снять frontmatter
    t = re.sub(r'(?m)^[ \t]*\|.*$', '', t)         # снять строки markdown-таблиц (выравнивание ≠ дефект)
    return t

findings = []
for p in C.doc_paths():                       # Проход Б: единый список документов (nx_common)
    body = strip_code(open(p, encoding='utf-8').read())
    rel = os.path.relpath(p, C.DESIGN).replace('\\', '/')
    glues = GLUE.findall(body); dbls = DBL.findall(body)
    if glues or dbls:
        ex = ''
        m = GLUE.search(body)
        if m:
            s = m.start(); ex = body[max(0, s - 18):s + 18].replace('\n', ' ').strip()
        findings.append((rel, len(glues), len(dbls), ex))

findings.sort(key=lambda x: -(x[1] + x[2]))
print(f'Файлов с дефектами формы: {len(findings)} '
      f'(склеек всего: {sum(f[1] for f in findings)}, двойных пробелов: {sum(f[2] for f in findings)})')
for rel, g, d, ex in findings[:25]:
    print(f'  склеек={g:3} 2проб={d:3}  {rel}' + (f'   …{ex}…' if ex else ''))
