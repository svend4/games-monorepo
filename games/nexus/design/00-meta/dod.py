#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""dod.py — исполняемый DoD (Definition of Done) волны роя и гейт «спеки→код» (Проход Д).

Отвечает на вопрос: «готова ли вика к запуску КОД-роя?». Формализует критерий,
которого раньше не было (гейт «концепция→код» был декларативным). Запускается
ВРУЧНУЮ перед код-роем; при зелёном — человек санкционирует запуск.

Структурные блокеры (жёсткие):
  1) спека (type=spec или maturity=prototyped) без псевдокод-блока (```);
  2) документ с непустыми open_subquestions (незакрытый research);
  3) висячая id-ссылка (relates_to/depends_on/comments_on на несуществующий id).
Гейт авторизации (--require-approved): спеки в scope должны быть accepted (Проход В).

  python dod.py                            # отчёт готовности
  python dod.py --gate                     # exit 1, если есть структурные блокеры
  python dod.py --gate --require-approved   # + требовать accepted у спек
  python dod.py --type spec                # ограничить проверку типом
"""
import sys, argparse, collections
try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass
import nx_common as C


def has_code_block(path):
    try:
        return '```' in open(path, encoding='utf-8').read()
    except OSError:
        return False


def as_list(v):
    if not v:
        return []
    return [v] if isinstance(v, str) else v


def main():
    ap = argparse.ArgumentParser(description='DoD волны роя / гейт «спеки→код» (Проход Д)')
    ap.add_argument('--gate', action='store_true', help='Вернуть exit 1 при неготовности')
    ap.add_argument('--require-approved', action='store_true', help='Требовать accepted у спек в scope')
    ap.add_argument('--type', dest='type_filter', help='Ограничить проверку типом (spec/system/...)')
    a = ap.parse_args()

    all_docs = C.load_docs()
    ids = {d['id'] for d in all_docs}                     # dangling считаем по ВСЕЙ вике
    docs = [d for d in all_docs if not a.type_filter or d.get('type') == a.type_filter]

    # --- структурные блокеры ---
    no_pseudo = [d['id'] for d in docs
                 if (d.get('type') == 'spec' or d.get('maturity') == 'prototyped')
                 and not has_code_block(d['_path'])]
    open_subq = [d['id'] for d in docs if as_list(d.get('open_subquestions'))]
    drifted = [d['id'] for d in docs if str(d.get('needs_review', '')).strip().lower() == 'true']  # Проход Е
    dangling = set()
    for d in docs:
        for fld in ('relates_to', 'depends_on', 'comments_on'):
            for r in as_list(d.get(fld)):
                b = r.split('#')[0].strip()
                if b and b.startswith('NX-') and b not in ids and b not in C.PSEUDO:
                    dangling.add(b)
    hard = len(no_pseudo) + len(open_subq) + len(drifted) + len(dangling)

    # --- авторизация (Проход В) ---
    specs = [d for d in docs if d.get('type') == 'spec']
    unapproved = [d['id'] for d in specs if d.get('status') != 'accepted']

    # --- сводка ---
    mat = collections.Counter(d.get('maturity', '—') for d in docs)
    st = collections.Counter(d.get('status', '—') for d in docs)
    print('== DoD дизайн-вики NEXUS ==' + (f' [type={a.type_filter}]' if a.type_filter else ''))
    print(f'документов в scope: {len(docs)} | спек: {len(specs)}')
    print(f'maturity: {dict(mat)}')
    print(f'status:   {dict(st)}')
    print('\n-- Структурные блокеры --')
    print(f'  спеки без псевдокода: {len(no_pseudo)}' + (f' -> {no_pseudo}' if no_pseudo else ''))
    print(f'  непустые open_subquestions: {len(open_subq)}' + (f' -> {open_subq}' if open_subq else ''))
    print(f'  открытый code-drift (needs_review): {len(drifted)}' + (f' -> {drifted}' if drifted else ''))
    print(f'  висячие id-ссылки: {len(dangling)}' + (f' -> {sorted(dangling)}' if dangling else ''))
    print('\n-- Авторизация (Проход В) --')
    print(f'  спек не accepted: {len(unapproved)}/{len(specs)}' + (f' -> {unapproved}' if unapproved else ''))

    blocked = hard > 0 or (a.require_approved and bool(unapproved))
    print()
    if blocked:
        why = []
        if hard:
            why.append(f'{hard} структурных блокеров')
        if a.require_approved and unapproved:
            why.append(f'{len(unapproved)} неавторизованных спек')
        print(f'ВЕРДИКТ: НЕ ГОТОВО к код-рою ({", ".join(why)}).')
        if a.gate:
            sys.exit(1)
    else:
        print('ВЕРДИКТ: ГОТОВО к код-рою. Санкционируй запуск вручную (человек-гейт).')


if __name__ == '__main__':
    main()
