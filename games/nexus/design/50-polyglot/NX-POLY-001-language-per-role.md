---
id: NX-POLY-001
title: Полиглот-архитектура — язык под роль (обзор)
type: system
status: draft
layer: technical
abstraction: general
version: 0.1
created: 2026-06-29
updated: 2026-06-29
authors: [claude-opus-4-8]
tags: [polyglot, architecture, interop, languages, tooling, wasm, overview]
relates_to: [NX-POLY-004, NX-SYS-003, NX-VIS-001, NX-INN-001]
depends_on: []
comments_on: [NX-ARCH#sec-stack, NX-REVIEW#stack]
superseded_by: null
inspiration_sources: [c20-proven, humanities]
new_vs_known: >
  НОВОЕ — не новый язык, а карта «роль → язык» и дисциплина interop поверх уже
  существующего стека (HTML/JS+PHP+Python+SQL). Кирпичики — проверенные за 30+ лет
  Unix-философия «один инструмент = одна задача», pipes, HTTP/JSON, WASM, FFI.
innovation_score: 3
improves: { quantitative: "−30..50% времени на горячие пути и генерацию контента за счёт правильного языка; 0 переписываний движка", qualitative: "каждый слой пишется на языке, где он выразителен; снижение когнитивной нагрузки и багов на стыках" }
maturity: analyzed
risk: med
effort: L
language: ru
---

# Полиглот-архитектура: язык под роль (обзор)

## TL;DR
Не один язык на всё, а **правильный инструмент под задачу**: JS/TS — клиент и игровая
логика, PHP — бэкенд/SSR (уже есть), Python — тулинг/генерация данных/симуляции баланса/ML
(уже есть), Perl — тяжёлый текст и склейка, SQL — данные, Rust/AssemblyScript→WASM —
горячие пути, Lua/JS-sandbox — моддинг, GLSL — шейдеры, Markdown/JSON/YAML/TOML — контент.
Это «велосипед с крылышками»: проверенный полиглот-стек как колесо, новое измерение —
**строгая карта ролей и контрактов interop**, чтобы стыки не текли.

## Краткое содержание
Монорепо NEXUS уже полиглотное: клиент на HTML/JS (`games/nexus/shared/**`,
`v1-2d-mmo/game.html`), бэкенд на PHP (`nexus_api.php`), схема на SQL (`nexus_setup.sql`),
генераторы контента на Python, источник истины — Markdown (`design/**`). Этот документ —
**обзорная карта верхнего уровня**: для каждой роли в системе называет язык, объясняет
*почему именно он*, даёт минимальные примеры кода/команд и фиксирует, *как* слои общаются
(HTTP/JSON, stdin/stdout-пайпы, FFI, WASM, codegen, общие data-файлы, очереди). Детальные
механизмы interop вынесены в [NX-POLY-004](NX-POLY-004-filetype-language-matrix.md), границы
проекта-в-проекте и деплой — в [NX-SYS-003](../30-systems/NX-SYS-003-content-pipeline.md).

Главный принцип: **язык выбирается по тому, что в нём выразительно и безопасно**, а не по
вкусу. Каждый стык между языками — это контракт (схема JSON, сигнатура CLI, таблица БД,
ABI WASM), и именно контракты, а не сами языки, — то, что мы дисциплинируем.

## Расширенное содержание (общее)

### Почему вообще полиглот
Монолит на одном языке вынуждает писать слой в чужой для языка манере: считать матрицы на
PHP, парсить мегабайты текста на JS, описывать схему данных императивным кодом. Полиглот
позволяет каждому слою говорить на своём диалекте. Цена — **стыки**. Поэтому стратегия:
немного языков, много дисциплины на границах.

Правило выбора в одну строку: *«взять язык, на котором эта конкретная задача пишется
короче, безопаснее и сопровождается дешевле — при условии, что у нас уже есть способ
безопасно склеить его с остальными»*.

### Карта «роль → язык» (главная таблица)

| Роль / слой | Язык(и) | Почему именно он | Где уже в проекте | Interop-контракт |
|---|---|---|---|---|
| Рендер + UI клиента | JS (опц. TS) | DOM/Canvas/WebGL — родная среда, мгновенный итеративный цикл | `shared/ui/*`, `game.html` | DOM-события, `fetch`→JSON |
| Игровая логика (клиент) | JS/TS | один язык с рендером, общий код состояния | `shared/systems/*` | вызовы функций, события |
| Бэкенд / API / SSR | PHP | уже развёрнут (XAMPP), быстрый старт, прямой доступ к MySQL | `nexus_api.php` | HTTP/JSON, сессии |
| Хранение данных | SQL (MySQL/SQLite) | декларативная модель данных, транзакции, индексы | `nexus_setup.sql` | таблицы, prepared statements |
| Генерация контента / тулинг | Python | библиотеки (numpy, faker, PIL), читаемость, быстрый скриптинг | генераторы уровней/баланса | пишет JSON/JS/SQL-файлы |
| Симуляции баланса / ML | Python | numpy/scipy/ML-стек, ноутбуки | планируется | offline → артефакты JSON/CSV |
| Тяжёлый текст / regex / склейка | Perl | непревзойдён в regex и one-liner'ах ETL, «клей» между шагами | планируется | stdin/stdout пайпы |
| Горячие пути (физика, генерация мира, поиск пути) | Rust или AssemblyScript → WASM | near-native скорость в браузере, детерминизм | планируется | WASM ABI / shared memory |
| Моддинг / пользовательские скрипты | Lua (или JS-песочница) | компактный встраиваемый язык, песочница, культурный стандарт игр | планируется | host-функции, sandbox |
| Шейдеры / эффекты | GLSL | единственный язык GPU-пайплайна WebGL | планируется (частицы) | uniforms/attributes |
| Контент и данные | Markdown / JSON / YAML / TOML | человекочитаемый источник истины, diff-friendly | `design/**`, data-файлы | файлы как контракт |

> Принцип ядра: **JS — лингва-франка времени выполнения в браузере** (всё в итоге сходится
> в него или в WASM рядом с ним). PHP — лингва-франка серверной границы. Python — лингва-франка
> *оффлайн*-конвейера. Остальные языки — «специальные инструменты», вызываемые точечно.

### Три зоны исполнения
Чтобы не путать «где живёт язык», делим систему на три зоны:

1. **Runtime браузера** — JS, WASM (Rust/AssemblyScript), GLSL, Lua-в-песочнице. Жёсткое
   требование: всё грузится в браузер. Perl/Python сюда не попадают.
2. **Серверная граница** — PHP (+ SQL через него). Принимает HTTP, отдаёт JSON/HTML.
3. **Оффлайн-конвейер (build-time)** — Python, Perl, любые CLI. Не работает в проде во время
   игры; производит **артефакты** (JS/JSON/SQL/PNG), которые коммитятся или деплоятся.

Это разделение — главный предохранитель: язык не из зоны runtime **никогда** не оказывается
в горячем цикле игры; он лишь готовит данные заранее.

## Детали и частные случаи

### Минимальные примеры «каждый язык в своей роли»

**JS — игровая логика клиента** (уже стиль `shared/systems/*`):
```js
// CombatSystem: чистая логика, без рендера
export function resolveHit(attacker, target, rng) {
  const dmg = Math.max(1, attacker.atk - target.def);
  const crit = rng() < attacker.critChance;
  return { dmg: crit ? dmg * 2 : dmg, crit };
}
```

**PHP — серверная граница** (стиль `nexus_api.php`):
```php
// POST /nexus_api.php?action=save_score  →  JSON
$pdo = new PDO('mysql:host=localhost;dbname=nexus', $u, $p);
$stmt = $pdo->prepare('INSERT INTO scores(player_id, score) VALUES(?, ?)');
$stmt->execute([$playerId, $score]);
header('Content-Type: application/json');
echo json_encode(['ok' => true, 'id' => $pdo->lastInsertId()]);
```

**SQL — модель данных** (стиль `nexus_setup.sql`):
```sql
CREATE TABLE loot_table (
  id        INT PRIMARY KEY AUTO_INCREMENT,
  rarity    ENUM('common','rare','epic','legendary') NOT NULL,
  weight    INT NOT NULL,            -- вес для взвешенного выбора
  item_json JSON NOT NULL            -- параметры предмета
);
```

**Python — генератор контента** (оффлайн → артефакт):
```python
# tools/gen_levels.py — пишет data/level1.js, который грузит клиент
import json, random
def make_level(seed, n_rooms):
    rng = random.Random(seed)
    rooms = [{"x": rng.randint(0, 40), "y": rng.randint(0, 40)} for _ in range(n_rooms)]
    return {"seed": seed, "rooms": rooms}
data = make_level(42, 12)
with open("data/level1.js", "w", encoding="utf-8") as f:
    f.write("export const LEVEL1 = " + json.dumps(data, ensure_ascii=False) + ";")
```
```bash
python tools/gen_levels.py   # build-time, артефакт коммитится
```

**Perl — тяжёлый текст / склейка** (one-liner ETL, чего на JS/PHP писать больно):
```bash
# извлечь все ключи локализации из исходников в плоский список
perl -nE 'say $1 while /t\((["\x27])(.+?)\1\)/g' shared/**/*.js | sort -u > i18n/keys.txt
```

**Rust → WASM — горячий путь** (детерминированная генерация мира):
```rust
// crate worldgen → worldgen.wasm; вызывается из JS
#[no_mangle]
pub extern "C" fn heightmap(seed: u32, x: i32, y: i32) -> f32 {
    perlin(seed, x as f32 * 0.01, y as f32 * 0.01) // быстро и детерминированно
}
```
```js
const { instance } = await WebAssembly.instantiateStreaming(fetch('worldgen.wasm'));
const h = instance.exports.heightmap(42, x, y);
```

**AssemblyScript — «почти TS» путь к WASM** (если Rust-toolchain избыточен):
```ts
// assembly/index.ts → build/worldgen.wasm (asc)
export function heightmap(seed: u32, x: i32, y: i32): f32 {
  return perlin(seed, <f32>x * 0.01, <f32>y * 0.01);
}
```

**Lua — моддинг в песочнице** (host задаёт безопасное API):
```lua
-- mods/double_loot.lua — мод игрока, грузится в sandbox
function on_loot(item)
  if item.rarity == "rare" then item.count = item.count * 2 end
  return item
end
```

**GLSL — шейдер эффекта** (фрагментный, для частиц/пост-обработки):
```glsl
precision mediump float;
uniform float u_time;
void main() {
  float glow = 0.5 + 0.5 * sin(u_time * 3.0);
  gl_FragColor = vec4(0.2, 0.8 * glow, 1.0, 1.0);
}
```

### Граничные случаи и анти-паттерны
- **Не тащить Python/Perl в runtime.** Они — оффлайн-конвейер. Соблазн «дернуть Python из PHP
  через `exec()` на каждый запрос» — анти-паттерн (latency, безопасность). Допустимо только
  через очередь/воркер (см. [NX-POLY-004](NX-POLY-004-filetype-language-matrix.md#queues)).
- **WASM ради WASM — нет.** Включаем горячий путь в Rust/AS только когда профайлер показал
  узкое место. Преждевременный WASM = сложность сборки без выгоды.
- **TS — постепенно, не «большой взрыв».** Текущий код — JS. TS вводится через `// @ts-check`
  + JSDoc и `.d.ts`, без обязательного шага компиляции на старте.
- **Дубль логики клиент/сервер.** Логика, которой нужно совпадать (валидация очков, лут),
  не пишется дважды на JS и PHP — выносится в один контракт-данные (SQL/JSON) или в WASM,
  разделяемый обеими сторонами (см. ниже «общие data-файлы»).
- **Версии артефактов.** Сгенерированный `level1.js` обязан нести `seed`/версию генератора,
  иначе невоспроизводимость.

### Критерии выбора языка (чек-лист на 5 вопросов)
1. **Зона исполнения?** runtime браузера → JS/WASM/GLSL/Lua; сервер → PHP/SQL; offline → Python/Perl.
2. **Это горячий путь (профайлер красный)?** да → WASM; нет → оставить как есть.
3. **Это много текста/regex/склейки?** да → Perl one-liner; нет → язык слоя.
4. **Это данные, а не код?** да → SQL/JSON/YAML/TOML, не императивный язык.
5. **Это пользовательский скрипт (мод)?** да → Lua/JS-sandbox, никогда не `eval` в основном контексте.

## Предложения и варианты реализации

### Вариант A. «Консервативный» (рекомендуемый старт)
Оставить ровно текущий стек (JS + PHP + Python + SQL + Markdown), добавить только
**дисциплину**: эта таблица ролей + папка `tools/` для оффлайн-конвейера + `data/` для
артефактов. Никаких новых рантаймов. Risk: low, effort: S.

### Вариант B. «Велосипед с крылышками» (целевой)
Поверх A добавляем **одно новое измерение за раз**, по мере доказанной нужды:
- (B1) Один Rust/AssemblyScript→WASM модуль для самого горячего пути (worldgen или pathfinding).
- (B2) Lua-песочница для моддинга, когда появится контент-сообщество.
- (B3) Perl-скрипты ETL в `tools/`, когда объём текстовых данных вырастет.
Каждое «крылышко» — отдельный документ-спека и отдельный риск. Risk: med, effort: L.

### Вариант C. «Максималистский» (не сейчас)
Полный TS-переход + сборочный конвейер (bundler), микросервисы, очередь задач, GraphQL-граница.
Преждевременно для текущей стадии. Зафиксирован как ориентир, не как план. Risk: high, effort: XL.

### Псевдокод: «диспетчер роли» (как принимать решение в репозитории)
```pseudo
function chooseLanguage(task):
    if task.zone == "browser-runtime":
        if task.is_hot_path and profiler.is_bottleneck(task): return WASM(Rust|AssemblyScript)
        if task.is_shader:                                    return GLSL
        if task.is_user_mod:                                  return Lua|JS_sandbox
        return JS // или TS через JSDoc
    if task.zone == "server-boundary":
        if task.is_pure_data:                                 return SQL
        return PHP
    if task.zone == "offline-pipeline":
        if task.is_heavy_text_or_glue:                        return Perl
        return Python
    // данные вместо кода — всегда декларативно
    if task.is_content_or_config:                             return Markdown|JSON|YAML|TOML
```

### Карта interop одним взглядом (детали — в NX-POLY-004)
```
Python(tools) --writes--> data/*.js,*.json,*.sql   (общие data-файлы, build-time)
Perl(tools)   --pipe--->  Python|files             (stdin/stdout)
JS(client)    --HTTP/JSON--> PHP(nexus_api.php) --SQL--> MySQL
JS(client)    --WASM ABI--> Rust|AssemblyScript    (горячий путь, shared memory)
JS(host)      --sandbox--> Lua                      (моддинг, host-функции)
JS            --uniforms--> GLSL                     (GPU)
*.md/*.yaml/*.toml = источник истины, читается всеми инструментами
```

## Что нового и какие кирпичики
- **НОВОЕ:** не язык и не движок, а **формализованная карта «роль → язык» + три зоны
  исполнения + чек-лист выбора**, специфичные для уже существующего стека NEXUS. Новое
  «измерение» — дисциплина контрактов на стыках (схема JSON / сигнатура CLI / WASM ABI /
  таблица БД), превращающая стихийный полиглот в управляемый.
- **Источники:** `c20-proven` (Unix-философия «один инструмент — одна задача», pipes,
  Perl как «клей интернета», SQL как декларативная модель), `humanities` (идея *регистра
  языка* из лингвистики — язык выбирается под коммуникативную задачу, как стиль речи).
- **Проверенные кирпичики:** HTTP/JSON, prepared statements, stdin/stdout-пайпы, WASM,
  FFI, GLSL-пайплайн WebGL, Lua-встраивание (Lua встраивают в игры с 1990-х), Markdown как
  источник истины. Ничего из этого не изобретается заново — мы их **компонуем**.
- **Чего нет в других играх (или редко):** обычно команды либо моноязычны, либо полиглот
  стихийный и недокументированный. Явная, версионируемая карта ролей с предохранителем
  «runtime-язык ≠ offline-язык» и встроенным чек-листом выбора — редкость; здесь это
  первичный артефакт архитектуры, а не побочный README.

## Риски, открытые вопросы
- **Стоимость стыков.** Каждый дополнительный язык добавляет границу, где теряется
  типобезопасность. Митигируем: контракты-схемы (JSON Schema / `.d.ts` / DDL) — открытый
  вопрос, какой формат канонизировать (см. [NX-POLY-004](NX-POLY-004-filetype-language-matrix.md)).
- **Сборка WASM.** Toolchain Rust/asc усложняет CI и онбординг. Открыто: брать Rust (быстрее,
  но тяжелее) или AssemblyScript (ближе к TS, легче, но менее зрел).
- **Дубль клиент/сервер логики.** Где именно граница «общего» кода? Кандидат — WASM,
  разделяемый JS-клиентом и… но PHP не исполняет WASM тривиально. Открытый вопрос границы.
- **Безопасность моддинга.** Lua/JS-песочница требует строгого host-API; утечка возможностей =
  RCE у игрока. Нужна отдельная спека угроз.
- **Найм/онбординг.** Полиглот повышает порог входа контрибьютора. Митигируем тем, что
  «горячих» языков всего два (JS, PHP), остальные — точечные.
- **Версионирование артефактов.** Нужна конвенция метаданных в сгенерированных файлах
  (seed, версия генератора, дата) — пока не зафиксирована.

## Комментарии
Документ — обзорный «корень» ветки `50-polyglot`. Частные механизмы (как именно течёт JSON,
как маршалится WASM-память, как устроены пайпы и очереди) намеренно не раскрыты здесь —
они в дочерних доках. Если рой добавляет новый язык, он сначала вносит строку в главную
таблицу этого документа, затем пишет спеку interop.

## Связанные документы
- [NX-POLY-004 Механизмы interop (HTTP/JSON, пайпы, FFI, WASM, codegen, очереди)](NX-POLY-004-filetype-language-matrix.md)
- [NX-SYS-003 Сборка и деплой полиглот-монорепо](../30-systems/NX-SYS-003-content-pipeline.md)
- [NX-VIS-001 Видение и столпы](../10-vision/NX-VIS-001-vision-and-pillars.md)
- [NX-INN-001 Инновационная повестка (велосипед с крылышками)](../20-innovation/NX-INN-001-systemic-emergent-world.md)
- [NX-META-001 Конституция дизайн-вики](../00-meta/CONSTITUTION.md)
