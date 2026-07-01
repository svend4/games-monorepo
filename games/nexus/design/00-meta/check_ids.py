#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check_ids.py — слой ИДЕНТИЧНОСТЬ/СХЕМА дизайн-вики NEXUS.
Проверяет: дубли id, id↔имя файла, обязательные поля шапки, ссылки relates_to/depends_on/
comments_on на несуществующие id, значения enum (status). Запуск: python check_ids.py
Код возврата 1 при жёстких ошибках — для pre-commit гейта.
Скан/парсинг документов — из общего модуля nx_common (Проход Б).
"""
import sys, collections
import nx_common as C
try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass

REQ = ['id', 'title', 'type', 'status']
STATUS_OK = {'draft', 'proposed', 'accepted', 'superseded', 'planned'}
MISM_EXEMPT = {'CONSTITUTION.md', 'TEMPLATE.md'}   # мета-файлы с человекочитаемым именем — правило id=имя не применяется

docs = C.load_docs()
byid = collections.defaultdict(list)
for d in docs:
    byid[d['id']].append(d['_rel'])

ids = {d['id'] for d in docs}
dup     = [(i, ps) for i, ps in byid.items() if len(ps) > 1]
mism    = [d['_rel'] for d in docs if not d['_base'].startswith(d['id'])
           and d.get('type') != 'meta' and d['_base'] not in MISM_EXEMPT]
missreq = [(d['_rel'], [k for k in REQ if k not in d]) for d in docs if any(k not in d for k in REQ)]
badref  = []
for d in docs:
    for fld in ('relates_to', 'depends_on', 'comments_on'):
        vals = d.get(fld) or []
        if isinstance(vals, str): vals = [vals]
        for r in vals:
            b = r.split('#')[0].strip()
            if b and b.startswith('NX-') and b not in ids and b not in C.PSEUDO:
                badref.append((d['_rel'], fld, r))
badenum = [(d['_rel'], d['status']) for d in docs if isinstance(d.get('status'), str) and d['status'] not in STATUS_OK]
# Проход В: accepted (кроме type=meta) обязан иметь approved_by — авторизация человеком, а не самоштамп агента
noappr = [d['_rel'] for d in docs if d.get('status') == 'accepted' and d.get('type') != 'meta' and not d.get('approved_by')]

print(f'Доков: {len(docs)} | дубль-id: {len(dup)} | id≠файл: {len(mism)} | нет обяз.полей: {len(missreq)} | '
      f'битые id-ссылки: {len(badref)} | status-enum: {len(badenum)} | accepted без approved_by: {len(noappr)}')
for i, ps in dup: print('  DUP-ID  ', i, ps)
for r in mism[:20]: print('  ID≠FILE ', r)
for r, k in missreq[:20]: print('  MISS    ', r, k)
for r, f, x in badref[:40]: print('  BADREF  ', r, f, '->', x)
for r, v in badenum[:20]: print('  ENUM    ', r, 'status=', v)
for r in noappr[:20]: print('  NOAPPR  ', r, '(accepted без approved_by — требуется авторизация: approve.py)')

# --- гейт: код возврата для pre-commit (жёсткие ошибки блокируют коммит) ---
hard = len(dup) + len(mism) + len(missreq) + len(badref) + len(badenum) + len(noappr)
if hard:
    print(f'\nИТОГ: {hard} жёстких ошибок схемы/идентичности — коммит должен быть остановлен.')
    sys.exit(1)
print('\nИТОГ: жёстких ошибок нет.')
