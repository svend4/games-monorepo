#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ОБРАБОТКА (Python): читает прайс из uslugi-i-ceny.md,
раскладывает услуги на структурированные поля и сохраняет prais.json.
Этот JSON потом показывает витрина prais.php в браузере.

Запуск:  python generate_data.py
Исходные .md не меняются — создаётся только prais.json
"""
import os, re, json, datetime

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, "uslugi-i-ceny.md")

def parse():
    items = []
    if not os.path.exists(SRC):
        return items
    for line in open(SRC, encoding="utf-8"):
        # строки таблицы: | Услуга | Описание | от 1 500 ₽ |
        if line.count("|") >= 3 and "₽" in line:
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) >= 3:
                name, desc, price_raw = cells[0], cells[1], cells[2]
                price = re.sub(r"[^\d]", "", price_raw)
                if price.isdigit() and name and "Услуга" not in name:
                    items.append({
                        "услуга": name,
                        "описание": desc,
                        "цена": int(price),
                    })
    return items

def main():
    items = parse()
    data = {
        "обновлено": datetime.datetime.now().strftime("%d.%m.%Y %H:%M"),
        "всего_услуг": len(items),
        "услуги": sorted(items, key=lambda x: x["цена"]),
    }
    out = os.path.join(BASE, "prais.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Обработано услуг: {len(items)}")
    print(f"Данные сохранены: {out}")

if __name__ == "__main__":
    main()
