#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fix_links.py — чинит битые markdown-ссылки дизайн-вики NEXUS по ближайшему совпадению.

Находит ссылки вида ](путь.md) в телах документов, где целевой файл не существует, и
пытается разрешить цель: (1) по NX-id в имени → существующий документ с тем же id;
(2) по точному имени файла где-либо под nexus/. Иначе — «не разрешено» (вероятно,
документ ещё не написан — это НЕ чинится автоматически). Предлагает корректный
относительный путь, сохраняя #якорь.

По умолчанию DRY-RUN. --apply записывает уверенные исправления (id / точное имя).

  python fix_links.py                              # предпросмотр
  python fix_links.py --apply                      # применить уверенные
  python fix_links.py --apply --skip NX-SPEC-011,NX-SPEC-012   # не трогать источники
"""
import os, re, sys, glob, argparse, urllib.parse
try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass
import nx_common as C

NEXUS = os.path.dirname(C.DESIGN)                  # .../games/nexus
LINK_RE = re.compile(r'\]\(([^)#]+?\.md)(#[^)]*)?\)')
ID_RE = re.compile(r'(NX-[A-Z]+-\d+)')
SKIP_SRC = {'LINKCHECK.md', 'INDEX.md', 'DECISIONS.md'}


def build_maps():
    id_to_path, base_to_paths = {}, {}
    for p in glob.glob(os.path.join(NEXUS, '**', '*.md'), recursive=True):
        b = os.path.basename(p)
        if C.WORKCOPY.search(b):
            continue
        base_to_paths.setdefault(b, []).append(p)
        m = ID_RE.match(b)
        if m:
            id_to_path.setdefault(m.group(1), p)      # первый выигрывает
    return id_to_path, base_to_paths


def resolve(href, id_to_path, base_to_paths):
    base = os.path.basename(href)
    base_dec = urllib.parse.unquote(base)
    m = ID_RE.match(base_dec)
    if m and m.group(1) in id_to_path:
        return id_to_path[m.group(1)], 'id'
    for cand in (base, base_dec):
        if len(base_to_paths.get(cand, [])) == 1:
            return base_to_paths[cand][0], 'name'
    return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--skip', default='', help='CSV id/имён источников, которые не трогать')
    a = ap.parse_args()
    skip = {x.strip() for x in a.skip.split(',') if x.strip()}
    id_to_path, base_to_paths = build_maps()

    fixes, unresolved = [], []
    for src in glob.glob(os.path.join(C.DESIGN, '**', '*.md'), recursive=True):
        b = os.path.basename(src)
        if b in SKIP_SRC or C.WORKCOPY.search(b):
            continue
        text = open(src, encoding='utf-8').read()
        for href, frag in LINK_RE.findall(text):
            if href.startswith(('http://', 'https://')):
                continue
            tgt = os.path.normpath(os.path.join(os.path.dirname(src), href))
            if os.path.exists(tgt):
                continue                              # ссылка целая
            real, kind = resolve(href, id_to_path, base_to_paths)
            src_rel = os.path.relpath(src, C.DESIGN).replace('\\', '/')
            if real:
                new = os.path.relpath(real, os.path.dirname(src)).replace('\\', '/')
                if new != href:
                    fixes.append((src, src_rel, href, frag or '', new, kind))
            else:
                unresolved.append((src_rel, href + (frag or '')))

    print(f'Битых: {len(fixes) + len(unresolved)} | авто-исправимо: {len(fixes)} | не разрешено: {len(unresolved)}')
    print('\n== Авто-исправимые (по id/имени) ==')
    for _s, srel, old, frag, new, kind in fixes[:70]:
        print(f'  [{kind}] {srel}: {old}{frag}  ->  {new}{frag}')
    if len(fixes) > 70:
        print(f'  ...ещё {len(fixes) - 70}')
    print('\n== Не разрешено (документ, вероятно, не написан) ==')
    for r, h in unresolved[:40]:
        print(f'  {r}: {h}')
    if len(unresolved) > 40:
        print(f'  ...ещё {len(unresolved) - 40}')

    if a.apply:
        by_file = {}
        for src, srel, old, frag, new, kind in fixes:
            sid_m = ID_RE.match(os.path.basename(src))
            sid = sid_m.group(1) if sid_m else ''
            if sid in skip or os.path.basename(src) in skip:
                continue
            by_file.setdefault(src, []).append((old, frag, new))
        n_links = 0
        for src, repls in by_file.items():
            raw = open(src, encoding='utf-8', newline='').read()
            nl = '\r\n' if '\r\n' in raw else '\n'
            text = raw.replace('\r\n', '\n')
            for old, frag, new in repls:
                text = text.replace(f']({old}{frag})', f']({new}{frag})')
                n_links += 1
            open(src, 'w', encoding='utf-8', newline='').write(text.replace('\n', nl))
        print(f'\nПрименено: {n_links} ссылок в {len(by_file)} файлах'
              + (f' (пропущено по --skip: {skip})' if skip else ''))


if __name__ == '__main__':
    main()
