#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""approve.py — авторизация документов дизайн-вики NEXUS человеком (Проход В).

Материализует принцип «ИИ останавливается и ждёт»: рой пишет документы только со
статусом proposed/draft. Повышение до accepted — отдельное ДЕЙСТВИЕ ЧЕЛОВЕКА, которое
проставляет approved_by/approved_date И регистрирует запись в DECISIONS.md. check_ids
жёстко требует: status=accepted (кроме type=meta) ⟹ есть approved_by.
Общий редактор frontmatter и лог решений — в nx_common (Проход Е).

  python approve.py NX-STRAT-004 --by Stefan --reason "принято после ревью"
  python approve.py NX-INN-014  --reject --by Stefan --reason "дубль NX-INN-013"
  python approve.py NX-SYS-001  --supersede-by NX-SYS-002 --by Stefan
  python approve.py --log            # показать хвост журнала решений
"""
import os, sys, argparse, datetime
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception: pass
import nx_common as C


def cmd_log():
    if not os.path.isfile(C.DECISIONS):
        print('DECISIONS.md ещё нет — решений не регистрировалось.'); return
    print('\n'.join(open(C.DECISIONS, encoding='utf-8').read().splitlines()[-15:]))


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
    path = C.find_doc(a.target)
    if not path:
        ap.error(f'документ не найден: {a.target!r}')

    if a.reject:
        did = C.update_doc(path, {'status': 'draft'})
        C.log_decision(did, 'rejected', a.by, a.reason)
    elif a.supersede_by:
        if not C.find_doc(a.supersede_by):
            ap.error(f'цель supersede не найдена: {a.supersede_by!r}')
        did = C.update_doc(path, {'status': 'superseded', 'superseded_by': a.supersede_by})
        C.log_decision(did, f'superseded_by {a.supersede_by}', a.by, a.reason)
    else:
        today = datetime.date.today().isoformat()
        did = C.update_doc(path, {'status': 'accepted', 'approved_by': a.by, 'approved_date': today})
        C.log_decision(did, 'accepted', a.by, a.reason)
    print(f'✓ {did}: применено (кем: {a.by}) → записано в DECISIONS.md')


if __name__ == '__main__':
    main()
