#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""approve.py — авторизация документов дизайн-вики NEXUS человеком (Проход В).

Материализует принцип «ИИ останавливается и ждёт»: рой пишет документы только со
статусом proposed/draft. Повышение до accepted — отдельное ДЕЙСТВИЕ ЧЕЛОВЕКА, которое
(1) проставляет approved_by/approved_date в шапку и (2) регистрирует запись в
DECISIONS.md (append-only лог аудита). check_ids жёстко требует:
status=accepted (кроме type=meta) ⟹ есть approved_by.

  python approve.py NX-STRAT-004 --by Stefan --reason "принято после ревью"
  python approve.py NX-INN-014  --reject --by Stefan --reason "дубль NX-INN-013"
  python approve.py NX-SYS-001  --supersede-by NX-SYS-002 --by Stefan
  python approve.py --log            # показать хвост журнала решений
"""
import os, sys, re, argparse, datetime
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception: pass
import nx_common as C

DECISIONS = os.path.join(C.META, 'DECISIONS.md')
DEC_HEADER = (
    "---\n"
    "title: Журнал решений дизайн-вики NEXUS\n"
    "type: log\n"
    "---\n\n"
    "# DECISIONS — журнал авторизаций (append-only)\n\n"
    "> Регистрируется автоматически через `approve.py`. Не редактировать задним числом.\n"
    "> Лог аудита: кто и когда авторизовал смену статуса (accepted / rejected / superseded).\n\n"
    "| Дата | ID | Решение | Кем | Причина |\n"
    "|---|---|---|---|---|\n"
)


def find_doc(target):
    """target — id (NX-...) или путь. Вернуть путь к файлу или None."""
    if os.path.isfile(target):
        return target
    for d in C.load_docs():
        if d.get('id') == target:
            return d['_path']
    p = os.path.join(C.DESIGN, target)
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
    raw = open(path, encoding='utf-8', newline='').read()
    nl = '\r\n' if '\r\n' in raw else '\n'                 # сохранить стиль переводов строк
    text = raw.replace('\r\n', '\n')
    block, marker, rest = split_fm(text)
    if block is None:
        print(f'ОШИБКА: нет frontmatter в {path}', file=sys.stderr); sys.exit(1)
    for k, v in changes.items():
        block = set_field(block, k, v)
    new = '---' + block + marker + rest
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(new.replace('\n', nl))
    return get_field(block, 'id') or os.path.basename(path)


def log_decision(doc_id, decision, by, reason):
    if not os.path.isfile(DECISIONS):
        with open(DECISIONS, 'w', encoding='utf-8', newline='') as f:
            f.write(DEC_HEADER)
    today = datetime.date.today().isoformat()
    reason = (reason or '—').replace('|', '/').replace('\n', ' ')
    with open(DECISIONS, 'a', encoding='utf-8', newline='') as f:
        f.write(f'| {today} | {doc_id} | {decision} | {by} | {reason} |\n')
    print(f'✓ {decision}: {doc_id} (кем: {by}) → записано в DECISIONS.md')


def cmd_log():
    if not os.path.isfile(DECISIONS):
        print('DECISIONS.md ещё нет — решений не регистрировалось.'); return
    print('\n'.join(open(DECISIONS, encoding='utf-8').read().splitlines()[-15:]))


def main():
    ap = argparse.ArgumentParser(description='Авторизация документов дизайн-вики NEXUS (Проход В)')
    ap.add_argument('target', nargs='?', help='ID (NX-...) или путь к документу')
    ap.add_argument('--by', help='Кто авторизует (человек) — обязательно')
    ap.add_argument('--reason', default='', help='Причина/комментарий (в лог)')
    ap.add_argument('--reject', action='store_true', help='Отклонить: статус → draft')
    ap.add_argument('--supersede-by', metavar='ID', help='Заменить: статус → superseded (+superseded_by)')
    ap.add_argument('--log', action='store_true', help='Показать хвост DECISIONS.md')
    a = ap.parse_args()

    if a.log:
        cmd_log(); return
    if not a.target:
        ap.error('нужен ID/путь документа (или --log)')
    if not a.by:
        ap.error('--by обязателен: авторизация всегда именная (кто взял ответственность)')
    path = find_doc(a.target)
    if not path:
        ap.error(f'документ не найден: {a.target!r}')

    if a.reject:
        did = update_doc(path, {'status': 'draft'})
        log_decision(did, 'rejected', a.by, a.reason)
    elif a.supersede_by:
        if not find_doc(a.supersede_by):
            ap.error(f'цель supersede не найдена: {a.supersede_by!r}')
        did = update_doc(path, {'status': 'superseded', 'superseded_by': a.supersede_by})
        log_decision(did, f'superseded_by {a.supersede_by}', a.by, a.reason)
    else:
        today = datetime.date.today().isoformat()
        did = update_doc(path, {'status': 'accepted', 'approved_by': a.by, 'approved_date': today})
        log_decision(did, 'accepted', a.by, a.reason)


if __name__ == '__main__':
    main()
