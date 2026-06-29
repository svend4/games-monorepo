#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_index.py — собирает INDEX.md дизайн-вики NEXUS из YAML-шапок документов.
Полиглот-принцип: Python как «фабрика данных» (см. NX-POLY-005).
Запуск:  python build_index.py
Пишет:   design/00-meta/INDEX.md
Без сторонних зависимостей (минимальный парсер frontmatter).
"""
import os, re, glob, datetime

META_DIR = os.path.dirname(os.path.abspath(__file__))
DESIGN = os.path.dirname(META_DIR)               # .../design
PSEUDO = {"NX-ARCH", "NX-REVIEW"}                 # внешние псевдо-id (не файлы вики)

AREA_TITLES = {
    "00-meta": "Мета", "10-vision": "Видение", "15-strategy": "Стратегия",
    "20-innovation": "Инновации", "30-systems": "Системы", "40-specs": "Спеки/псевдокод",
    "50-polyglot": "Полиглот", "60-research": "Исследования", "90-comments": "Комментарии",
}

def parse_frontmatter(text):
    if not text.startswith("---"):
        return None
    end = text.find("\n---", 3)
    if end == -1:
        return None
    block = text[3:end]
    fm = {}
    for line in block.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        m = re.match(r"^([A-Za-z_]+):\s*(.*)$", line)
        if not m:
            continue
        key, val = m.group(1), m.group(2).strip()
        if val.startswith("[") and val.endswith("]"):
            items = [x.strip() for x in val[1:-1].split(",") if x.strip()]
            fm[key] = items
        else:
            fm[key] = val
    return fm

def area_of(path):
    rel = os.path.relpath(path, DESIGN).replace("\\", "/")
    return rel.split("/")[0] if "/" in rel else "(root)"

def base_id(ref):
    return ref.split("#")[0].strip()

docs = []
for path in glob.glob(os.path.join(DESIGN, "**", "*.md"), recursive=True):
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    fm = parse_frontmatter(text)
    if not fm or "id" not in fm:
        continue
    docs.append({
        "id": fm.get("id", ""), "title": fm.get("title", ""),
        "type": fm.get("type", ""), "status": fm.get("status", ""),
        "abstraction": fm.get("abstraction", ""),
        "relates_to": fm.get("relates_to", []) if isinstance(fm.get("relates_to", []), list) else [],
        "comments_on": fm.get("comments_on", []) if isinstance(fm.get("comments_on", []), list) else [],
        "area": area_of(path),
        "rel": os.path.relpath(path, META_DIR).replace("\\", "/"),
    })

ids = {d["id"] for d in docs}
docs.sort(key=lambda d: d["id"])

# граф комментариев
edges = []
for d in docs:
    for tgt in d["comments_on"]:
        edges.append((d["id"], tgt))

# висячие ссылки
dangling = set()
for d in docs:
    for ref in d["relates_to"] + d["comments_on"]:
        b = base_id(ref)
        if b and b not in ids and b not in PSEUDO and re.match(r"^NX-", b):
            dangling.add(b)

# --- сборка INDEX.md ---
out = []
# самозарегистрированная шапка, чтобы индекс не висел «висячей ссылкой» NX-META-003
out.append("---")
out.append("id: NX-META-003")
out.append("title: Мастер-индекс дизайн-вики NEXUS")
out.append("type: meta")
out.append("status: accepted")
out.append("abstraction: general")
out.append("language: ru")
out.append("---\n")
out.append("# NEXUS · Дизайн-вики — Мастер-индекс\n")
out.append(f"> Сгенерировано `build_index.py`. Документов: **{len(docs)}**. "
           f"Ссылок-комментариев: **{len(edges)}**. Висячих ссылок: **{len(dangling)}**.\n")
out.append("> Не редактировать вручную — перегенерируется скриптом.\n")

# статистика по областям
out.append("\n## Статистика по областям\n")
out.append("| Область | Префикс | Документов |")
out.append("|---|---|---|")
from collections import Counter
cnt = Counter(d["area"] for d in docs)
for area in sorted(cnt):
    out.append(f"| {AREA_TITLES.get(area, area)} | `{area}` | {cnt[area]} |")

# каталог
out.append("\n## Каталог документов\n")
cur = None
for d in docs:
    if d["area"] != cur:
        cur = d["area"]
        out.append(f"\n### {AREA_TITLES.get(cur, cur)} (`{cur}`)\n")
        out.append("| ID | Заголовок | Тип | Статус | Уровень |")
        out.append("|---|---|---|---|---|")
    title = d["title"].replace("|", "\\|")
    out.append(f"| [{d['id']}]({d['rel']}) | {title} | {d['type']} | {d['status']} | {d['abstraction']} |")

# граф комментариев
out.append("\n## Индекс комментариев (кто что комментирует)\n")
out.append("| Документ | Комментирует |")
out.append("|---|---|")
for src, tgt in sorted(edges):
    out.append(f"| {src} | {tgt} |")

# висячие ссылки
out.append("\n## Висячие ссылки (цель ещё не написана)\n")
if dangling:
    for b in sorted(dangling):
        out.append(f"- `{b}` — упоминается, но документа нет (кандидат на следующую волну)")
else:
    out.append("_нет_")

out.append("")
index_path = os.path.join(META_DIR, "INDEX.md")
with open(index_path, "w", encoding="utf-8") as f:
    f.write("\n".join(out))

print(f"OK: {len(docs)} docs, {len(edges)} comment-edges, {len(dangling)} dangling -> {index_path}")
for area in sorted(cnt):
    print(f"  {area}: {cnt[area]}")
if dangling:
    print("  dangling:", ", ".join(sorted(dangling)))
