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
import os, re, glob, datetime

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


# ---------------------------------------------------------------------------
# Запись/аудит (Проход В+Е): единый редактор frontmatter и лог решений.
# Используют approve.py (авторизация) и drift.py (обратный канал код→спека).
# ---------------------------------------------------------------------------
DECISIONS = os.path.join(META, 'DECISIONS.md')
DEC_HEADER = (
    "---\n"
    "title: Журнал решений дизайн-вики NEXUS\n"
    "type: log\n"
    "---\n\n"
    "# DECISIONS — журнал решений (append-only)\n\n"
    "> Регистрируется автоматически (approve.py / drift.py). Не редактировать задним числом.\n"
    "> Лог аудита: кто и когда авторизовал смену статуса или зафиксировал дрейф код↔спека.\n\n"
    "| Дата | ID | Решение | Кем | Причина |\n"
    "|---|---|---|---|---|\n"
)


def find_doc(target):
    """target — id (NX-...) или путь. Вернуть путь к файлу или None."""
    if os.path.isfile(target):
        return target
    for d in load_docs():
        if d.get('id') == target:
            return d['_path']
    p = os.path.join(DESIGN, target)
    return p if os.path.isfile(p) else None


def split_fm(text):
    """text с LF-переводами. → (block, marker, rest); block БЕЗ маркеров '---'."""
    if not text.startswith('---'):
        return None, None, text
    end = text.find('\n---', 3)
    if end == -1:
        return None, None, text
    return text[3:end], text[end:end + 4], text[end + 4:]


def set_field(block, key, value):
    """Идемпотентно заменить/вставить `key: value` в блоке frontmatter."""
    lines = block.split('\n')
    pat = re.compile(r'^\s*%s\s*:' % re.escape(key))
    for i, l in enumerate(lines):
        if pat.match(l):
            lines[i] = f'{key}: {value}'
            return '\n'.join(lines)
    ins = len(lines)
    while ins > 0 and lines[ins - 1].strip() == '':
        ins -= 1
    lines.insert(ins, f'{key}: {value}')
    return '\n'.join(lines)


def get_field(block, key):
    m = re.search(r'^\s*%s\s*:\s*(.*)$' % re.escape(key), block or '', re.M)
    return m.group(1).strip() if m else None


def update_doc(path, changes):
    """Проставить поля frontmatter, сохранив исходный стиль переводов строк."""
    raw = open(path, encoding='utf-8', newline='').read()
    nl = '\r\n' if '\r\n' in raw else '\n'
    block, marker, rest = split_fm(raw.replace('\r\n', '\n'))
    if block is None:
        raise ValueError(f'нет frontmatter в {path}')
    for k, v in changes.items():
        block = set_field(block, k, v)
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(('---' + block + marker + rest).replace('\n', nl))
    return get_field(block, 'id') or os.path.basename(path)


def log_decision(doc_id, decision, by, reason=''):
    """Append-only строка в DECISIONS.md (лог аудита)."""
    if not os.path.isfile(DECISIONS):
        with open(DECISIONS, 'w', encoding='utf-8', newline='') as f:
            f.write(DEC_HEADER)
    today = datetime.date.today().isoformat()
    reason = (reason or '—').replace('|', '/').replace('\n', ' ')
    with open(DECISIONS, 'a', encoding='utf-8', newline='') as f:
        f.write(f'| {today} | {doc_id} | {decision} | {by} | {reason} |\n')
