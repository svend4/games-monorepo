#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""nx_common.py — общие примитивы дизайн-вики NEXUS (Проход Б).

ЕДИНЫЙ источник истины для инструментов вики (check_ids / check_style / build_index /
allocate_id). Раньше парсинг frontmatter и список документов дублировались в каждом
скрипте и расходились — теперь всё здесь.

Экспортирует:
  DESIGN, META            — пути
  SKIP, WORKCOPY, PSEUDO  — политика исключений/псевдо-id
  parse_frontmatter(text) — минимальный парсер YAML-шапки (без зависимостей)
  doc_paths()             — список путей документов вики (без INDEX/LINKCHECK/копий)
  load_docs()             — список шапок документов с полями _path/_rel/_base
  id_area_num(id)         — ('SPEC', 5) из 'NX-SPEC-005-...'
"""
import os, re, glob

META = os.path.dirname(os.path.abspath(__file__))
DESIGN = os.path.dirname(META)                       # .../design

SKIP = {'INDEX.md', 'LINKCHECK.md', 'DECISIONS.md'}  # сгенерированные/журналы — не исходные документы
WORKCOPY = re.compile(r'копия|\bcopy\b|\.bak', re.I) # рабочие копии («— копия.md») — не документы вики
PSEUDO = {'NX-ARCH', 'NX-REVIEW', 'NX-META-003'}     # внешние/сгенерированные id (NX-META-003 = INDEX.md)
ID_RE = re.compile(r'^NX-([A-Z]+)-(\d+)')


def is_doc_file(path):
    b = os.path.basename(path)
    return b not in SKIP and not WORKCOPY.search(b)


def doc_paths(design=DESIGN):
    """Отсортированный список путей исходных документов вики."""
    return sorted(p for p in glob.glob(os.path.join(design, '**', '*.md'), recursive=True)
                  if is_doc_file(p))


def parse_frontmatter(text):
    """Минимальный парсер YAML-frontmatter. Возвращает dict или None.
    Списки [a, b] → list; пустые/'#'-строки игнорируются."""
    if not text.startswith('---'):
        return None
    end = text.find('\n---', 3)
    if end == -1:
        return None
    fm = {}
    for line in text[3:end].splitlines():
        s = line.strip()
        if not s or s.startswith('#'):
            continue
        m = re.match(r'^([A-Za-z_]+):\s*(.*)$', line)
        if not m:
            continue
        k, v = m.group(1), m.group(2).strip()
        if v.startswith('[') and v.endswith(']'):
            fm[k] = [x.strip() for x in v[1:-1].split(',') if x.strip()]
        else:
            fm[k] = v
    return fm


def load_docs(design=DESIGN):
    """Документы с frontmatter (только те, где есть id). К шапке добавлены _path/_rel/_base."""
    docs = []
    for p in doc_paths(design):
        try:
            fm = parse_frontmatter(open(p, encoding='utf-8').read())
        except Exception:
            continue
        if not fm or 'id' not in fm:
            continue
        fm['_path'] = p
        fm['_rel'] = os.path.relpath(p, design).replace('\\', '/')
        fm['_base'] = os.path.basename(p)
        docs.append(fm)
    return docs


def id_area_num(doc_id):
    """'NX-SPEC-005-echo' -> ('SPEC', 5); прочее -> (None, None)."""
    m = ID_RE.match(doc_id or '')
    return (m.group(1), int(m.group(2))) if m else (None, None)
