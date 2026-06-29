---
id: NX-POLY-005
title: Python в проекте — роль и расширение (фабрика данных)
type: system
status: draft
layer: technical
abstraction: extended
version: 0.1
created: 2026-06-29
updated: 2026-06-29
authors: [claude-opus-4-8]
tags: [polyglot, python, tooling, data-driven, validation, balance, codegen, ml, pipeline]
relates_to: [NX-SYS-003, NX-POLY-001, NX-POLY-003, NX-POLY-002, NX-VIS-001]
depends_on: [NX-POLY-001]
comments_on: [NX-ARCH#sec-stack, NX-POLY-001#map]
superseded_by: null
inspiration_sources: [c20-proven, humanities]
new_vs_known: >
  НОВОЕ — не «писать на Python», а сделать Python единой «фабрикой данных» оффлайн-конвейера:
  один CLI-инструмент (click), который валидирует, симулирует, генерирует и кодогенерирует
  все артефакты data-driven пайплайна NX-SYS-003. Кирпичики проверены десятилетиями — stdlib,
  JSON Schema, numpy, click; новое измерение — дисциплина «контент только через фабрику».
innovation_score: 3
improves: { quantitative: "−40..70% ручной работы над балансом/контентом; 0 невалидных data-файлов в проде за счёт schema-gate; воспроизводимость по seed=100%", qualitative: "контент перестаёт быть рукописным и становится вычисляемым и проверяемым; геймдизайнер крутит числа, а не редактирует JSON руками" }
maturity: analyzed
risk: med
effort: M
language: ru
---

# Python в проекте: роль и расширение (фабрика данных)

## TL;DR
Python в NEXUS уже есть как генератор прайса/уровней, но используется стихийно. Превращаем
его в **единую «фабрику данных»** — один CLI (`nxgen` на `click`), который умеет
**валидировать** (JSON Schema), **симулировать** баланс (numpy), **процедурно генерировать**
контент и **кодогенерировать** артефакты (`*.js`/`*.json`/`*.sql`) для data-driven пайплайна
[NX-SYS-003](../30-systems/NX-SYS-003-build-and-deploy.md). «Велосипед с крылышками»: колесо —
проверенные `stdlib`+`click`+`jsonschema`+`numpy`; крылышко — правило «весь контент рождается
только через фабрику и проходит schema-gate».

## Краткое содержание
Сейчас Python живёт в зоне **оффлайн-конвейера** ([NX-POLY-001#zones](NX-POLY-001-language-per-role.md))
и пишет артефакты, которые грузит клиент (например, `data/level1.js`). Это правильная зона,
но роль Python недоформализована: нет валидации входных данных, нет симуляции баланса, нет
единой точки входа, генераторы разрозненны. Документ предлагает **пять ролей Python** и
сводит их под один CLI:

1. **Валидатор** — проверяет все data-файлы по JSON Schema до коммита/деплоя (schema-gate).
2. **Билд-скрипты** — единый `nxgen build`, заменяющий ручной запуск разрозненных скриптов.
3. **Симулятор баланса** — numpy-модель боя/экономики, прогон 10⁶ боёв за секунды, отчёт.
4. **Процедурная генерация** — детерминированный (по seed) генератор уровней/лута/имён.
5. **ML-инструменты геймдизайна** — кластеризация билдов, поиск «доминирующих стратегий».

Все пять — **build-time**, ни одна не попадает в runtime игры (предохранитель из
[NX-POLY-001](NX-POLY-001-language-per-role.md)). Контракт со всеми языками — **файлы и схемы**
(JSON/JS/SQL + JSON Schema), interop-механика описана в
[NX-POLY-003](NX-POLY-003-interop.md).

## Расширенное содержание (общее)

### Где Python уже
- **Генератор уровней:** скрипт пишет `data/levelN.js` (видно по структуре `v3-3d/data/*.js`).
- **Прайс/контент-таблицы:** генерация прайс-листов и сводок (`ceny_svodka*.csv` в соседних
  проектах монорепо — тот же паттерн «Python → CSV/JSON артефакт»).
- **Markdown как источник истины:** Python естественно читает `design/**` для извлечения
  параметров.

Общая черта: Python **читает источник истины и пишет потребляемый артефакт**. Это и есть
определение «фабрики данных». Не хватает только: (а) проверки, что артефакт валиден; (б)
единой команды; (в) вычисления, а не ручного ввода чисел баланса.

### Куда расширить — пять ролей

**Роль 1. Валидатор (schema-gate).** Каждый data-файл (лут, враги, уровни, экономика)
описывается **JSON Schema**. Python-валидатор — единственные ворота: невалидный файл не
коммитится (pre-commit hook) и не деплоится (CI-шаг в [NX-SYS-003](../30-systems/NX-SYS-003-build-and-deploy.md)).
Это «один источник правды о форме данных», который читают и Python, и JS (через ту же схему),
и документация.

**Роль 2. Билд-скрипты (единый CLI).** Вместо «запусти gen_levels.py, потом gen_loot.py,
потом руками собери» — одна команда `nxgen build`, оркестрирующая шаги с зависимостями,
кэшированием по хэшу входов и понятным логом. Кирпичик — `click` (де-факто стандарт CLI в
Python) + `pathlib` из stdlib.

**Роль 3. Симулятор баланса (numpy).** Геймдизайнер задаёт числа (atk/def/hp/crit), Python
прогоняет **миллион боёв** векторизованно на numpy и выдаёт: win-rate матрицу классов,
TTK (time-to-kill), кривую сложности по уровням. Баланс становится **измеряемым**, а не
«на глаз». Логика боя совпадает с клиентской `CombatSystem.resolveHit`
([NX-POLY-001#examples](NX-POLY-001-language-per-role.md)) — единый контракт формулы.

**Роль 4. Процедурная генерация.** Детерминированный по `seed` генератор уровней, лут-таблиц,
имён NPC, карт. Каждый артефакт несёт `seed` и версию генератора (требование
[NX-POLY-001#anti-patterns](NX-POLY-001-language-per-role.md)) → 100% воспроизводимость.

**Роль 5. ML-инструменты геймдизайна.** Не ML *в игре*, а ML *для дизайнера*: кластеризация
логов билдов игроков (`scikit-learn` KMeans), выявление доминирующих стратегий, аномалий
экономики. Опционально и позже — самый «дальний» лепесток.

### Принцип «фабрики данных»
Контент в data-driven архитектуре ([NX-SYS-003](../30-systems/NX-SYS-003-build-and-deploy.md))
не должен быть **рукописным**. Рукописный JSON — это: опечатки, рассинхрон со схемой,
невоспроизводимость, баланс «на глаз». Фабрика заменяет это конвейером
**`источник истины (MD/числа) → Python → валидный артефакт (JS/JSON/SQL)`**, где каждая
стрелка проверяема. Python здесь — не «ещё один язык», а **компилятор контента**.

## Детали и частные случаи

### Единая точка входа: CLI `nxgen` на click
```python
# tools/nxgen/__main__.py  — единый CLI «фабрики данных»
import click

@click.group()
def cli():
    """nxgen — фабрика данных NEXUS (build-time, оффлайн-конвейер)."""

@cli.command()
@click.option("--strict/--no-strict", default=True, help="падать на первой ошибке")
def validate(strict):
    """Проверить все data-файлы по JSON Schema (schema-gate)."""
    from . import validation
    code = validation.run_all(strict=strict)
    raise SystemExit(code)

@cli.command()
@click.option("--seed", default=42, type=int)
@click.option("--out", default="games/nexus/shared/data", type=click.Path())
def build(seed, out):
    """Сгенерировать все артефакты (уровни/лут/имена) детерминированно по seed."""
    from . import generators
    generators.build_all(seed=seed, out_dir=out)

@cli.command()
@click.option("--battles", default=1_000_000, type=int)
def balance(battles):
    """Симулировать баланс боя (numpy) и напечатать отчёт."""
    from . import balance as bal
    bal.report(n=battles)

if __name__ == "__main__":
    cli()
```
```bash
python -m tools.nxgen validate         # ворота: невалидный data-файл = ненулевой код выхода
python -m tools.nxgen build --seed 42  # детерминированная генерация всех артефактов
python -m tools.nxgen balance --battles 1000000   # отчёт по балансу
```

### Роль 1 — валидация по JSON Schema
Схема — общий контракт (тот же файл читает и JS на клиенте):
```json
// games/nexus/shared/schemas/loot.schema.json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "array",
  "items": {
    "type": "object",
    "required": ["id", "rarity", "weight"],
    "properties": {
      "id":     { "type": "string", "pattern": "^[a-z0-9_]+$" },
      "rarity": { "enum": ["common", "rare", "epic", "legendary"] },
      "weight": { "type": "integer", "minimum": 1 }
    },
    "additionalProperties": false
  }
}
```
```python
# tools/nxgen/validation.py
import json, pathlib, sys
from jsonschema import Draft202012Validator   # pip install jsonschema

SCHEMA_DIR = pathlib.Path("games/nexus/shared/schemas")
DATA_DIR   = pathlib.Path("games/nexus/shared/data")

def run_all(strict: bool = True) -> int:
    errors = 0
    for schema_path in SCHEMA_DIR.glob("*.schema.json"):
        name = schema_path.stem.replace(".schema", "")      # loot.schema -> loot
        data_path = DATA_DIR / f"{name}.json"
        if not data_path.exists():
            continue
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        data   = json.loads(data_path.read_text(encoding="utf-8"))
        validator = Draft202012Validator(schema)
        for err in sorted(validator.iter_errors(data), key=lambda e: e.path):
            loc = "/".join(map(str, err.path)) or "<root>"
            print(f"[INVALID] {data_path}:{loc}: {err.message}", file=sys.stderr)
            errors += 1
            if strict:
                return 1
    print(f"validate: {'OK' if errors == 0 else f'{errors} errors'}")
    return 0 if errors == 0 else 1
```
> Та же `loot.schema.json` подключается на клиенте (например через `ajv`), так что **форма
> данных описана один раз** — это устраняет дубль клиент/сервер из
> [NX-POLY-001#anti-patterns](NX-POLY-001-language-per-role.md).

### Роль 3 — симуляция баланса на numpy
```python
# tools/nxgen/balance.py — векторизованный прогон боёв
import numpy as np

def simulate(atk, df, hp, crit, n, seed=0):
    """Возвращает win-rate стороны A против B по n параллельным боям."""
    rng = np.random.default_rng(seed)
    hp_a = np.full(n, hp[0], dtype=float)
    hp_b = np.full(n, hp[1], dtype=float)
    alive = np.ones(n, dtype=bool)
    for _ in range(1000):                      # потолок раундов
        # тот же контракт, что resolveHit() в JS: dmg = max(1, atk - def), crit ×2
        dmg_a = np.maximum(1, atk[0] - df[1]) * np.where(rng.random(n) < crit[0], 2, 1)
        hp_b = np.where(alive, hp_b - dmg_a, hp_b)
        b_dead = hp_b <= 0
        dmg_b = np.maximum(1, atk[1] - df[0]) * np.where(rng.random(n) < crit[1], 2, 1)
        hp_a = np.where(alive & ~b_dead, hp_a - dmg_b, hp_a)
        alive &= ~(b_dead | (hp_a <= 0))
        if not alive.any():
            break
    return float((hp_a > hp_b).mean())          # доля побед A

def report(n=1_000_000):
    classes = {"warrior": (12, 8, 100, 0.10), "mage": (18, 3, 70, 0.20)}
    names = list(classes)
    print("win-rate matrix (строка бьёт столбец):")
    for a in names:
        row = []
        for b in names:
            ca, cb = classes[a], classes[b]
            wr = simulate(atk=(ca[0], cb[0]), df=(ca[1], cb[1]),
                          hp=(ca[2], cb[2]), crit=(ca[3], cb[3]), n=n)
            row.append(f"{wr:5.1%}")
        print(f"  {a:8} {row}")
```
1 000 000 боёв на numpy считаются за доли секунды; чистый Python-цикл был бы в сотни раз
медленнее — это и есть «правильный язык под задачу» из [NX-POLY-001](NX-POLY-001-language-per-role.md).

### Роль 4 — процедурная генерация с метаданными воспроизводимости
```python
# tools/nxgen/generators.py
import json, random, pathlib

GEN_VERSION = "1.0.0"   # бампать при изменении алгоритма → невоспроизводимость отлавливается

def make_level(seed: int, n_rooms: int) -> dict:
    rng = random.Random(seed)
    rooms = [{"x": rng.randint(0, 40), "y": rng.randint(0, 40)} for _ in range(n_rooms)]
    return {"_seed": seed, "_gen": GEN_VERSION, "rooms": rooms}

def build_all(seed: int, out_dir: str):
    out = pathlib.Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    level = make_level(seed, n_rooms=12)
    # пишем И как JSON (валидируемый), И как ES-модуль (грузимый клиентом) — codegen
    (out / "level1.json").write_text(json.dumps(level, ensure_ascii=False, indent=2), "utf-8")
    (out / "level1.js").write_text(
        f"// AUTO-GENERATED by nxgen {GEN_VERSION}, seed={seed} — НЕ редактировать вручную\n"
        f"export const LEVEL1 = {json.dumps(level, ensure_ascii=False)};\n", "utf-8")
```

### Таблица выбора: какую роль Python включать и когда
| Роль | Кирпичик | Когда включать | Триггер | Risk | Effort |
|---|---|---|---|---|---|
| Валидация (schema-gate) | `jsonschema`, stdlib | **сразу** | есть ≥1 рукописный data-файл | low | S |
| Билд-CLI `nxgen` | `click`, `pathlib` | **сразу** | ≥2 разрозненных скрипта | low | S |
| Симуляция баланса | `numpy` | когда есть классы/числа | первый дисбаланс «на глаз» | low | M |
| Процедурная генерация | `random`/`numpy` | когда нужен объём контента | ручная генерация утомила | med | M |
| ML-инструменты | `scikit-learn`/`pandas` | поздно, опционально | есть логи игроков | med | L |

### Когда Python — НЕ ответ (анти-паттерны)
- **Python в runtime.** Никогда не дёргать Python из PHP `exec()` на каждый запрос — это
  оффлайн-конвейер (предохранитель [NX-POLY-001#anti-patterns](NX-POLY-001-language-per-role.md)).
  Если нужно «по запросу» — через очередь/воркер ([NX-POLY-003](NX-POLY-003-interop.md)).
- **Тяжёлый regex/ETL текста.** Это лепесток Perl, а не Python
  ([NX-POLY-001#map](NX-POLY-001-language-per-role.md)) — если задача чисто «прогнать текст».
  Граница нечёткая; правило: структурные данные → Python, потоковый текст one-liner'ом → Perl.
- **Горячая математика в браузере.** Симуляция баланса — да (offline). Физика в кадре — нет,
  это WASM-лепесток.

### Зависимости и их обоснование (минимализм)
| Пакет | Зачем | Можно ли без него |
|---|---|---|
| stdlib (`json`,`random`,`pathlib`,`argparse`) | ядро фабрики | — (всегда есть) |
| `click` | удобный CLI с группами/опциями | да, через `argparse`, но многословнее |
| `jsonschema` | schema-gate | да, но ручная валидация хрупка |
| `numpy` | векторная симуляция баланса | да, но в сотни раз медленнее |
| `scikit-learn`/`pandas` | ML-аналитика дизайна | да, роль 5 опциональна |

> Принцип: **stdlib + click — обязательный минимум**; numpy и далее — по доказанной нужде,
> «крылышко за крылышком» (вариант B из [NX-POLY-001](NX-POLY-001-language-per-role.md)).

## Предложения и варианты реализации

### Вариант A. «Минимальная фабрика» (рекомендуемый старт)
Сделать пакет `tools/nxgen/` с двумя командами: `validate` (jsonschema) и `build` (перенести
существующие генераторы под единый CLI). Добавить `tools/nxgen/schemas/*.schema.json` для
текущих data-файлов. Без numpy/ML. Risk: low, effort: S.

### Вариант B. «Фабрика с балансом» (целевой)
Поверх A — команда `balance` на numpy и метаданные воспроизводимости (`_seed`/`_gen`) во всех
артефактах. Подключить schema-gate в pre-commit и в CI ([NX-SYS-003](../30-systems/NX-SYS-003-build-and-deploy.md)).
Risk: med, effort: M.

### Вариант C. «Фабрика с ML» (не сейчас)
Поверх B — роль 5: сбор логов билдов, `pandas`+`scikit-learn`, дашборд «доминирующих
стратегий». Требует телеметрии и данных игроков, поэтому позже. Risk: med, effort: L.

### Псевдокод: место фабрики в пайплайне сборки
```pseudo
// build-time, вызывается из CI/pre-commit (NX-SYS-003)
function nexus_build(seed):
    nxgen.validate(strict=true)          // ВОРОТА: падаем, если форма данных нарушена
        -> on_fail: abort_build()
    artifacts = nxgen.build(seed)        // источник истины -> *.json + *.js (+ при нужде *.sql)
    nxgen.validate(strict=true)          // ВОРОТА-2: проверяем то, что сами сгенерили
    if changed("balance_inputs"):
        report = nxgen.balance(n=1e6)    // регрессия баланса: алерт при сдвиге win-rate
        assert within_bounds(report)
    commit(artifacts)                    // артефакты несут _seed/_gen -> воспроизводимы
```

### Кодоген SQL-сидов из того же источника (для серверной границы)
```python
# та же фабрика умеет писать SQL-сиды для PHP/MySQL слоя (контракт — таблицы)
def emit_loot_seed(loot: list[dict]) -> str:
    rows = ",\n".join(
        f"  ('{i['id']}', '{i['rarity']}', {i['weight']})" for i in loot)
    return ("INSERT INTO loot_table(id, rarity, weight) VALUES\n" + rows + ";\n")
```
Так один источник истины (`loot.json`) порождает **и** клиентский `loot.js`, **и** серверный
`loot_seed.sql` — interop через codegen ([NX-POLY-003](NX-POLY-003-interop.md)), без дубля.

## Что нового и какие кирпичики
- **НОВОЕ:** не «использовать Python», а **возвести его в роль единой фабрики данных** с одним
  CLI и обязательным schema-gate. Новое измерение поверх существующего использования —
  **дисциплина «весь контент рождается только через фабрику и проходит валидацию»**, плюс
  кодоген одного источника в несколько целевых форматов (`*.js`/`*.json`/`*.sql`).
- **Источники:** `c20-proven` — Unix-философия (один инструмент-CLI, композиция шагов, текст/файл
  как универсальный интерфейс), идея *компилятора* (контент компилируется из источника, а не
  пишется руками); `humanities` — понятие *генеративной грамматики* (конечный набор правил
  порождает бесконечный контент) как метафора процедурной генерации.
- **Проверенные кирпичики:** Python stdlib, `click` (стандарт CLI), JSON Schema (стандарт
  валидации данных), `numpy` (векторные вычисления с 2006-го), `scikit-learn` (классический ML).
  Ничего не изобретается — всё **компонуется** в фабрику.
- **Чего нет в других играх (или редко):** обычно баланс правят «на глаз» и хранят рукописный
  JSON; здесь контент **вычисляется и валидируется**, а баланс — **измеряется** прогоном 10⁶
  боёв до релиза. Schema-gate как обязательные ворота сборки для геймдата — нечастая практика
  в инди/браузерных играх.

## Риски, открытые вопросы
- **Совпадение формул баланса.** Симулятор на numpy и клиентская `CombatSystem` должны считать
  по одной формуле, иначе симуляция врёт. Открыто: канонизировать формулу как данные/схему или
  как разделяемый WASM ([NX-POLY-001#risks](NX-POLY-001-language-per-role.md)).
- **Канонический формат схем.** JSON Schema vs `.d.ts` vs DDL — какой источник истины формы
  данных канонизировать (пересекается с открытым вопросом [NX-POLY-003](NX-POLY-003-interop.md)).
- **Версии Python и окружение.** Нужна фиксация версии (`.python-version`/`requirements.txt`),
  иначе невоспроизводимость сборки на разных машинах. Пока не зафиксировано.
- **Граница Python/Perl.** Где именно «структурные данные» (Python) переходят в «потоковый
  текст» (Perl) — нечёткая, требует правила в [NX-POLY-001](NX-POLY-001-language-per-role.md).
- **ML — переусложнение?** Роль 5 рискует стать «ML ради ML» без достаточных данных. Митигируем
  тем, что она опциональна и последняя (вариант C).
- **Связь со сборкой.** Точная интеграция schema-gate в CI/pre-commit зависит от ещё не
  написанного [NX-SYS-003](../30-systems/NX-SYS-003-build-and-deploy.md) — ссылка на будущий док.

## Комментарии
Документ конкретизирует роль Python из главной карты
[NX-POLY-001#map](NX-POLY-001-language-per-role.md) и снабжает data-driven пайплайн
[NX-SYS-003](../30-systems/NX-SYS-003-build-and-deploy.md) исполнителем. Если рой добавляет
новый тип контента, он сначала пишет `*.schema.json`, затем команду в `nxgen`, и только потом
data-файл — никогда не наоборот.

## Связанные документы
- [NX-POLY-001 Полиглот-архитектура: язык под роль (обзор)](NX-POLY-001-language-per-role.md)
- [NX-POLY-003 Механизмы interop](NX-POLY-003-interop.md)
- [NX-POLY-002 Проект-в-проекте](NX-POLY-002-project-in-project.md)
- [NX-SYS-003 Сборка и деплой / data-driven пайплайн](../30-systems/NX-SYS-003-build-and-deploy.md)
- [NX-VIS-001 Видение и столпы](../10-vision/NX-VIS-001-vision-and-pillars.md)
- [NX-META-001 Конституция дизайн-вики](../00-meta/CONSTITUTION.md)
