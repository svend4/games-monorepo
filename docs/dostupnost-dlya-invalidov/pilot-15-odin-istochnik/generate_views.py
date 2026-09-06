#!/usr/bin/env python3
"""
generate_views.py — пилот идеи №15 из docs/dostupnost-dlya-invalidov/05-...md:
"Один источник — N теней".

Читает *.source.json (структурированное описание услуги) и генерирует из НЕГО ЖЕ
четыре разных представления в generated/:

    01-detalnyj-tekst.md      — подробный текст (аналог существующих документов soz30)
    02-algoritm-diagramma.md  — блок-схема шагов (Mermaid, рендерится нативно на GitHub)
    03-legkaya-kartochka.md   — лёгкая карточка (см. docs/.../02-adaptaciya-soz30.md)
    04-panel-stsenariy.md     — сценарий панели персонала (канбан заявки, см. demo/pult-nuzhd-demo.html)

Смысл пилота: "детализация" и "обобщение в алгоритм" — это не два документа,
которые правят вручную и они расходятся, а два РЕНДЕРА одной модели данных.
Добавить деталь — значит добавить поле в *.source.json, а не переписывать
четыре файла отдельно.

Использование:
    python3 generate_views.py [путь-к-source.json ...]

Без аргументов обрабатывает все *.source.json в своей папке.
Стандартная библиотека Python, без внешних зависимостей — как остальные
генераторы в sites/pomosch-po-domu (generate_all.py, generate_data.py).
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "generated"


def load_source(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Представление 1: подробный текст
# ---------------------------------------------------------------------------

def render_detailed_text(data: dict) -> str:
    lines = []
    lines.append(f"# {data['title_ru']} — подробно")
    lines.append(f"### {data['title_de']}")
    lines.append("")
    lines.append(
        "> Сгенерировано из `haushalt-assistenz.source.json` скриптом "
        "`generate_views.py` (представление 1 из 4, пилот идеи №15 — "
        "см. `../05-mozgovoy-shturm-arhitektura-i-vizualizaciya.md`)."
    )
    lines.append("")
    lines.append(f"Исходный документ для сверки: `{data['source_doc']}`.")
    lines.append("")

    lines.append("## Целевая группа")
    lines.append("")
    for tg in data["target_groups"]:
        lines.append(f"- {tg['icon']} {tg['text_ru']}")
    lines.append("")

    lines.append("## Правовые основания")
    lines.append("")
    lines.append("| Параграф | Что регулирует |")
    lines.append("|---|---|")
    for lb in data["legal_basis"]:
        lines.append(f"| {lb['ref']} | {lb['note_ru']} |")
    lines.append("")

    lines.append("## Стоимость услуг (Leistungskomplex)")
    lines.append("")
    lines.append("| Код | Услуга | Длительность | Стоимость |")
    lines.append("|---|---|---|---|")
    for ci in data["cost_items"]:
        price = f"{ci['price_min']}–{ci['price_max']} {ci['unit']}"
        lines.append(f"| {ci['code']} | {ci['name_de']} | {ci['duration']} | {price} |")
    oc = data["overall_cost_range"]
    lines.append(f"| **Итого** | Полная услуга | по обстоятельствам | **{oc['min']}–{oc['max']} {oc['unit']}** |")
    lines.append("")

    lines.append("## Порядок действий")
    lines.append("")
    for step in data["steps"]:
        lines.append(f"{step['id']}. **[{step['actor']}]** {step['icon']} {step['action_ru']}")
    lines.append("")
    for dp in data.get("decision_points", []):
        lines.append(f"> После шага {dp['after_step']}: {dp['condition_ru']}")
        for br in dp["branches"]:
            target = f"к шагу {br['to_step']}" if "to_step" in br else br.get("to_label_ru", "")
            lines.append(f"> - {br['label_ru']} → {target}")
    lines.append("")

    lines.append("## Необходимые документы")
    lines.append("")
    for doc in data["documents_required"]:
        lines.append(f"- {doc['name_ru']}")
    lines.append("")

    lines.append("## Глоссарий")
    lines.append("")
    lines.append("| Термин | Объяснение |")
    lines.append("|---|---|")
    for g in data["glossary"]:
        lines.append(f"| **{g['term']}** | {g['explanation_ru']} |")
    lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Представление 2: алгоритм как диаграмма (Mermaid)
# ---------------------------------------------------------------------------

def render_algorithm_diagram(data: dict) -> str:
    lines = []
    lines.append(f"# {data['title_ru']} — алгоритм")
    lines.append("")
    lines.append(
        "> Сгенерировано из того же `haushalt-assistenz.source.json` "
        "(представление 2 из 4). Шаги и точки принятия решений взяты из полей "
        "`steps` и `decision_points` — те же данные, что и в подробном тексте."
    )
    lines.append("")
    lines.append("```mermaid")
    lines.append("flowchart TD")

    steps = data["steps"]
    decision_after = {dp["after_step"]: dp for dp in data.get("decision_points", [])}

    for step in steps:
        node_id = f"S{step['id']}"
        label = f"{step['icon']} {step['action_ru']}".replace('"', "'")
        lines.append(f'    {node_id}["{label}"]')

    prev_node = None
    for step in steps:
        node_id = f"S{step['id']}"
        if prev_node:
            lines.append(f"    {prev_node} --> {node_id}")
        dp = decision_after.get(step["id"])
        if dp:
            dec_id = f"D{step['id']}"
            cond = dp["condition_ru"].replace('"', "'")
            lines.append(f'    {node_id} --> {dec_id}{{"{cond}"}}')
            for i, br in enumerate(dp["branches"]):
                label = br["label_ru"].replace('"', "'")
                if "to_step" in br:
                    lines.append(f'    {dec_id} -->|{label}| S{br["to_step"]}')
                else:
                    end_id = f"{dec_id}_end{i}"
                    other = br.get("to_label_ru", "").replace('"', "'")
                    lines.append(f'    {end_id}["{other}"]')
                    lines.append(f"    {dec_id} -->|{label}| {end_id}")
            prev_node = None  # решение уже провело свои стрелки дальше
        else:
            prev_node = node_id

    lines.append("```")
    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Представление 3: лёгкая карточка (Leichte Sprache + пиктограммы)
# ---------------------------------------------------------------------------

def render_light_card(data: dict) -> str:
    lines = []
    icon = data["category"]["icon"]
    lines.append(f"# {icon} {data['title_ru']} — простыми словами")
    lines.append("")
    lines.append(
        "> Сгенерировано из того же источника (представление 3 из 4) — "
        "формат карточки как в `../02-adaptaciya-soz30.md`."
    )
    lines.append("")

    lines.append("## Что это?")
    lines.append("")
    lines.append(f"Кто-то приходит к вам домой и помогает: {data['title_ru'].lower()}.")
    lines.append("")

    lines.append("## Кому подходит? 👤")
    lines.append("")
    for tg in data["target_groups"]:
        lines.append(f"- {tg['icon']} {tg['text_ru']}")
    lines.append("")

    oc = data["overall_cost_range"]
    lines.append("## Сколько это стоит примерно? 💶")
    lines.append("")
    lines.append(f"От **{oc['min']} до {oc['max']} €** за одно посещение.")
    lines.append("")

    lines.append("## Что нужно сделать? ✅")
    lines.append("")
    for step in data["steps"]:
        lines.append(f"{step['id']}. {step['icon']} {step['action_ru']}")
    lines.append("")

    lines.append("## Трудные слова простыми словами 📖")
    lines.append("")
    lines.append("| Слово | Что оно значит |")
    lines.append("|---|---|")
    for g in data["glossary"]:
        lines.append(f"| **{g['term']}** | {g['explanation_ru']} |")
    lines.append("")
    lines.append(f"---\nПодробнее → `01-detalnyj-tekst.md` в этой же папке.")
    lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Представление 4: сценарий панели персонала (канбан заявки)
# ---------------------------------------------------------------------------

def render_panel_scenario(data: dict) -> str:
    lines = []
    lines.append(f"# {data['title_ru']} — сценарий панели персонала")
    lines.append("")
    lines.append(
        "> Сгенерировано из того же источника (представление 4 из 4). Это НЕ "
        "экран жизненно важных потребностей из `../03-pult-upravleniya-uhod.md` "
        "(тот — про мгновенные физические нужды резидента), а его родственник — "
        "канбан-доска для соцработника, ведущего заявки на услуги. Визуальный "
        "язык карточек — тот же, что в `../demo/pult-nuzhd-demo.html` "
        "(`.queue-item`, светофорная заливка по времени ожидания)."
    )
    lines.append("")

    # Колонки канбана выводятся из шагов + точек решения — те же данные.
    lines.append("## Колонки доски")
    lines.append("")
    columns = ["Новая заявка", "На проверке", "Одобрено", "Активно", "Возражение (Widerspruch)"]
    lines.append(" → ".join(columns))
    lines.append("")

    icon = data["category"]["icon"]
    oc = data["overall_cost_range"]
    lines.append("## Пример карточки в колонке «На проверке»")
    lines.append("")
    lines.append("```")
    lines.append(f"┌ {icon} {data['title_ru']} ──────────────┐")
    lines.append(f"│ Клиент: (демо) Иванова А.П.            │")
    lines.append(f"│ Шаг: 3 из {len(data['steps'])} — {data['steps'][2]['action_ru']}")
    lines.append(f"│ Ожидаемая стоимость: {oc['min']}–{oc['max']} {oc['unit']} │")
    lines.append(f"│ Ожидание: 3 дня  [светофор: 🟡]         │")
    lines.append("└─────────────────────────────────────────┘")
    lines.append("```")
    lines.append("")

    lines.append("## Правило светофора (как в демо-панели)")
    lines.append("")
    lines.append("- 🟢 зелёный — заявка младше 5 рабочих дней;")
    lines.append("- 🟡 жёлтый — от 5 до 10 рабочих дней;")
    lines.append("- 🔴 красный — больше 10 рабочих дней без движения (повод позвонить в кассу).")
    lines.append("")
    lines.append(
        "Пороговые значения — не минуты, как в демо-панели ухода, а рабочие дни, "
        "но JS-логика `elapsedClass()` из `pult-nuzhd-demo.html` подходит без "
        "переписывания — меняются только числа порогов."
    )
    lines.append("")

    return "\n".join(lines)


def main(argv):
    OUT_DIR.mkdir(exist_ok=True)
    sources = [Path(p) for p in argv] if argv else sorted(HERE.glob("*.source.json"))
    if not sources:
        print("Не найдено ни одного *.source.json", file=sys.stderr)
        return 1

    renderers = [
        ("01-detalnyj-tekst.md", render_detailed_text),
        ("02-algoritm-diagramma.md", render_algorithm_diagram),
        ("03-legkaya-kartochka.md", render_light_card),
        ("04-panel-stsenariy.md", render_panel_scenario),
    ]

    for src in sources:
        data = load_source(src)
        for filename, renderer in renderers:
            out_path = OUT_DIR / filename
            out_path.write_text(renderer(data), encoding="utf-8")
            print(f"  {src.name} -> generated/{filename}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
