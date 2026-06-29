#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Скрипт-пример: собирает услуги и цены из Markdown-документов
в одной папке и сохраняет сводную таблицу в CSV.

Запуск (Python установлен в системе):
    python sobrat_ceny.py
или:
    py sobrat_ceny.py

Исходные файлы НЕ изменяются — создаётся только новый файл ceny_svodka.csv
"""

import os
import re
import csv
import glob

# Папка со скриптом (берём файлы рядом со скриптом)
BASE = os.path.dirname(os.path.abspath(__file__))

def extract_prices(md_path):
    """Ищет в Markdown-файле строки с услугой и ценой (от ... ₽)."""
    rows = []
    fname = os.path.basename(md_path)
    with open(md_path, encoding="utf-8") as f:
        for line in f:
            # ищем цену вида "от 1 500 ₽" или "500 ₽"
            m = re.search(r"(.+?)\|?\s*(от\s*)?([\d\s]+)\s*₽", line)
            if m and "₽" in line:
                name = m.group(1).strip(" |*-#").strip()
                price = re.sub(r"\s", "", m.group(3))
                if name and price.isdigit():
                    rows.append({"файл": fname, "услуга": name, "цена_руб": price})
    return rows

def main():
    all_rows = []
    md_files = sorted(glob.glob(os.path.join(BASE, "*.md")))
    print(f"Найдено Markdown-файлов: {len(md_files)}")
    for md in md_files:
        found = extract_prices(md)
        print(f"  {os.path.basename(md)}: цен найдено {len(found)}")
        all_rows.extend(found)

    out = os.path.join(BASE, "ceny_svodka.csv")
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["файл", "услуга", "цена_руб"])
        w.writeheader()
        w.writerows(all_rows)

    print(f"\nГотово! Собрано строк: {len(all_rows)}")
    print(f"Результат сохранён: {out}")

if __name__ == "__main__":
    main()
