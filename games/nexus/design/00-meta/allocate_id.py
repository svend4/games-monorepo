#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""allocate_id.py — выдача и РЕЗЕРВ id дизайн-вики NEXUS (Проход Б: контроль коллизий).

Единый источник следующего свободного NX-<AREA>-<NNN>. Перед запуском РОЯ можно
заранее нарезать непересекающиеся диапазоны на каждого агента, чтобы параллельная
запись не выдала одинаковые id (реальная гонка — см. коммит 7888234).

Резерв учитывает И существующие файлы, И ранее выданные брони (атомарно, под файловым
локом), поэтому повторные вызовы — в т.ч. конкурентные — не пересекаются.

Примеры:
  python allocate_id.py SPEC                          # следующий свободный id области
  python allocate_id.py SPEC --reserve 5 --agent A    # зарезервировать 5 id для агента A
  python allocate_id.py --status                      # состояние по всем областям
  python allocate_id.py --release A                   # снять брони агента A (после мёрджа)
"""
import os, sys, json, time, argparse
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception: pass
import nx_common as C

RES_PATH = os.path.join(C.META, '.id-reservations.json')
LOCK_PATH = RES_PATH + '.lock'


def _lock():
    for _ in range(500):                      # ~10 c ожидания
        try:
            fd = os.open(LOCK_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(fd)
            return True
        except FileExistsError:
            time.sleep(0.02)
    return False


def _unlock():
    try: os.remove(LOCK_PATH)
    except OSError: pass


def _load():
    try:
        return json.load(open(RES_PATH, encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def _save(d):
    with open(RES_PATH, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=1)


def max_existing(area):
    mx = 0
    for d in C.load_docs():
        a, n = C.id_area_num(d.get('id', ''))
        if a == area and n is not None:
            mx = max(mx, n)
    return mx


def high_water(area, res):
    """Максимум из существующих файлов области и всех активных броней области."""
    hw = max_existing(area)
    for _agent, blocks in res.get(area, {}).items():
        for lo, hi in blocks:
            hw = max(hw, hi)
    return hw


def fmt(area, n):
    return f'NX-{area}-{n:03d}'


def cmd_next(area):
    print(fmt(area, high_water(area, _load()) + 1))


def cmd_reserve(area, count, agent):
    if not _lock():
        print('ОШИБКА: не удалось взять лок .id-reservations.json.lock', file=sys.stderr)
        sys.exit(2)
    try:
        res = _load()
        start = high_water(area, res) + 1
        block = [start, start + count - 1]
        res.setdefault(area, {}).setdefault(agent, []).append(block)
        res.setdefault('_log', []).append(
            {'area': area, 'agent': agent, 'range': block, 'ts': time.strftime('%Y-%m-%dT%H:%M:%S')})
        _save(res)
    finally:
        _unlock()
    for n in range(block[0], block[1] + 1):
        print(fmt(area, n))
    print(f'# зарезервировано {count} id для «{agent}»: {fmt(area, block[0])}..{fmt(area, block[1])}',
          file=sys.stderr)


def cmd_status():
    res = _load()
    areas = sorted({a for d in C.load_docs() for a in [C.id_area_num(d.get('id', ''))[0]] if a}
                   | {a for a in res if not a.startswith('_')})
    print('Область | макс. файл | верхняя граница (с бронями) | активные брони')
    print('--------|-----------|-----------------------------|---------------')
    for area in areas:
        mx = max_existing(area)
        hw = high_water(area, res)
        brs = '; '.join(f'{ag}:{lo}-{hi}' for ag, bl in res.get(area, {}).items() for lo, hi in bl) or '—'
        print(f'{area:7} | {mx:9} | {hw:27} | {brs}')


def cmd_release(agent):
    if not _lock():
        print('ОШИБКА: не удалось взять лок', file=sys.stderr); sys.exit(2)
    try:
        res = _load()
        removed = 0
        for area in [a for a in res if not a.startswith('_')]:
            if agent in res[area]:
                removed += len(res[area].pop(agent))
            if not res[area]:
                res.pop(area)
        _save(res)
    finally:
        _unlock()
    print(f'Снято броней у «{agent}»: {removed}')


def main():
    ap = argparse.ArgumentParser(description='Выдача/резерв id дизайн-вики NEXUS')
    ap.add_argument('area', nargs='?', help='Область: VIS/STRAT/INN/SYS/SPEC/POLY/RND/CMT/META')
    ap.add_argument('--reserve', type=int, metavar='N', help='Зарезервировать N id')
    ap.add_argument('--agent', default='anon', help='Имя агента-получателя брони')
    ap.add_argument('--status', action='store_true', help='Показать состояние по областям')
    ap.add_argument('--release', metavar='AGENT', help='Снять все брони агента')
    a = ap.parse_args()

    if a.status:
        cmd_status(); return
    if a.release:
        cmd_release(a.release); return
    if not a.area:
        ap.error('нужна область (или --status/--release)')
    area = a.area.upper()
    if not C.ID_RE.match(f'NX-{area}-000'):
        ap.error(f'некорректная область: {a.area!r}')
    if a.reserve:
        if a.reserve < 1:
            ap.error('--reserve должен быть >= 1')
        cmd_reserve(area, a.reserve, a.agent)
    else:
        cmd_next(area)


if __name__ == '__main__':
    main()
