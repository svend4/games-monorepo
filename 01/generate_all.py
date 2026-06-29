#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ОБРАБОТКА (Python): обходит ВСЕ .md документы и собирает единую базу
(услуги с ценами, контакты, условия, метаданные). Сохраняет database.json.
Запуск: python generate_all.py"""
import os, re, json, glob, datetime

BASE = os.path.dirname(os.path.abspath(__file__))
TYPE_BY_NAME = {"uslugi":"Услуги и цены","obyavlenie":"Объявление",
                "dogovor":"Договор","anketa":"Анкета/памятка"}

def doc_type(fname):
    for k,v in TYPE_BY_NAME.items():
        if k in fname.lower(): return v
    return "Документ"

def first_heading(path):
    for line in open(path, encoding="utf-8"):
        m = re.match(r"#\s+(.+)", line.strip())
        if m: return m.group(1).strip()
    return os.path.basename(path)

def clean_md(s):
    for ch in ("**","*","`",">","#"): s = s.replace(ch,"")
    return s.strip()

def extract_services(path):
    items = []
    for line in open(path, encoding="utf-8"):
        if line.count("|") >= 3 and "₽" in line:
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) >= 3:
                name, desc, praw = cells[0], cells[1], cells[2]
                price = re.sub(r"[^\d]","",praw)
                if price.isdigit() and name and "Услуга" not in name:
                    items.append({"услуга":name,"описание":desc,
                                  "цена":int(price),"источник":os.path.basename(path)})
    return items

def extract_contacts(text):
    c = {}
    m = re.search(r"\+?\d[\d\s()\-]{8,}\d", text)
    if m: c["телефон"] = m.group(0).strip()
    m = re.search(r"[\w.\-]+@[\w.\-]+\.\w+", text)
    if m: c["email"] = m.group(0)
    m = re.search(r"(пн[–\-—]?[а-я]{0,3}[ ,]*[\d:.– \-—]+\d)", text, re.I)
    if m: c["режим"] = m.group(1).strip()
    m = re.search(r"Зона[^:]*:\s*([^\n*]+)", text)
    if m: c["зона"] = m.group(1).strip()
    return c

def extract_conditions(text):
    out = []
    for line in text.splitlines():
        s = clean_md(line.strip().strip("-|☐✅ ").strip())
        # пропускаем нумерованные пункты договора (1.1, 2.2) и заголовки/служебное
        if re.match(r"^\d", s): continue
        if "☐" in line or "Исполнитель обязуется" in s: continue
        if not re.search(r"Минимальн|скидк|Оплат[аи]|инвентар", s, re.I): continue
        if len(s) > 130: continue
        if s and s not in out: out.append(s)
    return out

def main():
    services, docs, all_text = [], [], ""
    for md in sorted(glob.glob(os.path.join(BASE,"*.md"))):
        text = open(md, encoding="utf-8").read()
        all_text += "\n" + text
        docs.append({"файл":os.path.basename(md),"заголовок":first_heading(md),
                     "тип":doc_type(os.path.basename(md)),"размер_байт":os.path.getsize(md)})
        services.extend(extract_services(md))
    services.sort(key=lambda x: x["цена"])
    data = {"обновлено":datetime.datetime.now().strftime("%d.%m.%Y %H:%M"),
            "документов":len(docs),"услуг":len(services),
            "контакты":extract_contacts(all_text),"условия":extract_conditions(all_text),
            "документы":docs,"услуги":services}
    out = os.path.join(BASE,"database.json")
    json.dump(data, open(out,"w",encoding="utf-8"), ensure_ascii=False, indent=2)
    print("Документов: %d | Услуг: %d" % (len(docs), len(services)))
    print("Контакты:", data["контакты"])
    print("Условий:", len(data["условия"]))

if __name__ == "__main__":
    main()
