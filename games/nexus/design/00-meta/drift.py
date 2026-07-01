#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""drift.py — обратный канал «код → спека» (Проход Е: замкнуть цикл циклов).

Когда код-рой (или ревьюер) находит расхождение реализации со спекой, он РЕГИСТРИРУЕТ
дрейф: спека получает `needs_review: true` и потому снова флагается `dod.py` (теряет
готовность), а событие пишется в DECISIONS.md. Так циклы «замечают друг друга»:
код информирует спеку → спека возвращается на пересмотр человеком → только потом снова код.

Снятие дрейфа — тоже именное действие (обычно после того, как человек обновил спеку).

  python drift.py NX-SPEC-005 --by code-swarm --reason "реализация не поддерживает батч X"
  python drift.py NX-SPEC-005 --resolve --by Stefan --reason "спека обновлена под реализацию"
  python drift.py --list         # спеки/документы с открытым дрейфом
"""
import sys, argparse
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception: pass
import nx_common as C


def is_open(d):
    return str(d.get('needs_review', '')).strip().lower() == 'true'


def cmd_list():
    opened = [d['id'] for d in C.load_docs() if is_open(d)]
    print('Документы с открытым дрейфом (needs_review=true):')
    print('  ' + (', '.join(opened) if opened else '—'))


def main():
    ap = argparse.ArgumentParser(description='Обратный канал код→спека (Проход Е)')
    ap.add_argument('target', nargs='?', help='ID (NX-...) или путь к спеке')
    ap.add_argument('--by', help='Кто фиксирует/снимает дрейф — обязательно')
    ap.add_argument('--reason', default='', help='Причина/комментарий (в лог)')
    ap.add_argument('--resolve', action='store_true', help='Снять дрейф (needs_review → false)')
    ap.add_argument('--list', action='store_true', help='Показать документы с открытым дрейфом')
    a = ap.parse_args()

    if a.list:
        cmd_list(); return
    if not a.target:
        ap.error('нужен ID/путь документа (или --list)')
    if not a.by:
        ap.error('--by обязателен: фиксация дрейфа всегда именная')
    path = C.find_doc(a.target)
    if not path:
        ap.error(f'документ не найден: {a.target!r}')

    if a.resolve:
        did = C.update_doc(path, {'needs_review': 'false'})
        C.log_decision(did, 'drift-resolved', a.by, a.reason)
        print(f'✓ дрейф снят: {did} — можно снова к код-рою (после dod.py)')
    else:
        did = C.update_doc(path, {'needs_review': 'true'})
        C.log_decision(did, 'drift-open', a.by, a.reason)
        print(f'⚠ дрейф открыт: {did} — спека теряет готовность до пересмотра человеком')


if __name__ == '__main__':
    main()
