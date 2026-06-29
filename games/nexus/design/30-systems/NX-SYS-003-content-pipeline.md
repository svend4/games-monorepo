---
id: NX-SYS-003
title: Контент-пайплайн и data-driven — папка data/, AssetLoader, валидация, целостность ссылок, i18n
type: system
status: proposed
layer: technical
abstraction: extended
version: 0.1
created: 2026-06-29
updated: 2026-06-29
authors: [claude-opus-4-8]
tags: [data-driven, content-pipeline, assetloader, json-schema, referential-integrity, i18n, validation, fetch, cache, designer-workflow]
relates_to: [NX-VIS-001, NX-SYS-001, NX-SYS-004, NX-SYS-006, NX-INN-012, NX-INN-004]
depends_on: [NX-SYS-001]
comments_on: [NX-ARCH#sec5-data, NX-REVIEW#sec3-3, NX-REVIEW#sec5]
superseded_by: null
language: ru
---

# Контент-пайплайн и data-driven — папка data/, AssetLoader, валидация, целостность ссылок, i18n

## TL;DR
Выносим весь геймплейный контент (враги, лут, квесты, лавки, события) из хардкод-массивов JS
(`eDefs[]`, `QUESTS[]`, `SHOP_ITEMS`) в **реальную папку `data/` с JSON-файлами**, грузим их через
**AssetLoader** (`fetch` + кеш + `Promise.all` + честный `.catch`), проверяем тремя воротами качества:
**(1)** структурная валидация по **JSON Schema**, **(2)** проверка **ссылочной целостности** строковых
`id` (опечатка в `dropTable.item` = ошибка сборки, а не тихий битый ref), **(3)** наличие **i18n-ключей**
вместо захардкоженных строк. Это закрывает пробел контент-пайплайна из ревью ([NX-REVIEW#sec3-3]) и даёт
дизайнеру возможность править баланс, не трогая код.

## Краткое содержание
Ревью прямо зафиксировало ([NX-REVIEW#sec3-3] 🟠): «весь контент-пайплайн отсутствует» — нет папки
`data/`, ни одного `.json` контента, ни `_schema.json`, ни `AssetLoader`; данные захардкожены в
`shared/systems/EnemySystem.js` (`var eDefs = [...]`), `QuestSystem.js`, `Shop.js`, `WorldEvents.js`.
Без загрузчика «дизайнер правит JSON» физически невозможен — а `ARCHITECTURE.md` обещал и `data/*.json`,
и `AssetLoader`, и `_schema.json`-валидацию ([NX-ARCH#sec5-data]) как сделанное.

Этот документ — **технический дизайн контент-пайплайна v1**: где лежат данные, как они грузятся, и три
**вороты качества** на входе. Он встраивает прагматичный namespace `NEXUS.*` и слоистые контракты из
[NX-SYS-001] (AssetLoader — слой 1 `engine`, данные контента заменяют глобал-массивы), служит
**поставщиком формата** для процедурно-авторского гибрида [NX-INN-012] (сгенерированные зоны текут через
тот же пайплайн), и закрывает три конкретных дефекта ревью: отсутствие загрузчика, рассинхрон схем с
механикой и отсутствие i18n/целостности ссылок. Ассеты-байты (звук/текстуры/модели) — в соседнем
[NX-SYS-006]; здесь речь о **контент-данных** (балансные таблицы, дефиниции).

## Расширенное содержание (общее)

### Что не так сейчас (факты из кода и ревью)
- **Данные = код.** `EnemySystem.js:9-15` объявляет `var eDefs = [{x:-5,z:-3,c:0x27ae60,n:'Гоблин',hp:60,
  atk:8,xp:30,g:8,...}]` — пять врагов прямо в JS, в глобальной области. Аналогично квесты, лавка, события.
- **Имена захардкожены без i18n.** `n: 'Гоблин'` — русская строка внутри данных; перевести игру = править
  данные ([NX-REVIEW#sec3-3] 🟡, [NX-REVIEW#sec3-5] ⚪ «строки захардкожены по-русски»).
- **Схемы рассинхронизированы с механикой.** `ARCHITECTURE.md` обещает врагу `dropTable` с `sword_iron`
  (chance 0.02), но движок (`CombatSystem`/`LootSystem`) дропает только `gold`/`potion`, и шансы
  захардкожены. Дизайнер, правя `goblin.json`, не изменит в игре ничего ([NX-REVIEW#sec3-3] 🟡).
- **Связи по строковым id без проверки.** `unlocks`, `targetZone`, `dropTable.item` — опечатка = тихий
  битый ref ([NX-REVIEW#sec3-3] 🟡).
- **Нет обработки ошибок загрузки.** `AssetLoader.loadAll().then()` без `.catch` ([NX-REVIEW#sec3-5] 🟡).
- **Путь схемы битый.** `$schema: "../_schema.json"` резолвится мимо файла ([NX-REVIEW#sec3-3] ⚪).

### Целевая модель: данные отдельно, движок читает таблицы
Контент перестаёт быть кодом и становится **данными**, которые движок загружает на старте. Принцип из
[NX-SYS-001]: «данные контента (`eDefs`, `QUESTS`, `SHOP_ITEMS`) уезжают в JSON; в коде их заменяют
загруженные таблицы, а не хардкод-массивы». Движок после загрузки видит `NEXUS.data.enemies['goblin']`
вместо `eDefs[0]`.

### Три вороты качества (валидация в один проход на старте/сборке)
1. **Структура — JSON Schema.** Каждый тип контента (`enemy`, `loot`, `quest`, `shopItem`, `worldEvent`)
   имеет схему в `data/_schema/`. Файл, не прошедший схему (нет `hp`, `atk` — строка вместо числа,
   лишнее поле) — отвергается **с понятной ошибкой и путём к файлу**, а не падает где-то в рантайме.
2. **Ссылочная целостность — линкер id.** После загрузки всех таблиц строится граф ссылок: каждый
   строковый `id` в полях-ссылках (`dropTable[].item`, `quest.unlocks[]`, `quest.targetZone`,
   `enemy.lootTable`) обязан резолвиться в существующую запись. Битый ref = ошибка **списком**, а не
   тихий `undefined`. Это превращает опечатку из рантайм-сюрприза в ошибку загрузки/CI.
3. **i18n-ключи — отделение текста от данных.** В данных — **не строки, а ключи** (`nameKey:
   "enemy.goblin.name"`). Сами строки — в `data/i18n/{ru,en}.json`. Ворота проверяет, что для каждого
   ключа есть перевод хотя бы в базовой локали (`ru`), и сообщает о недостающих ключах. Это закрывает
   ⚪ «i18n и доступность» из [NX-REVIEW#sec3-5] на уровне данных.

### Поток загрузки (AssetLoader)
`AssetLoader` (слой 1 `engine` по [NX-SYS-001]) делает `fetch` манифеста контента → параллельная
загрузка через `Promise.all` → кеш в `NEXUS.data` → прогон через три вороты → событие
`content:loaded` (или `content:error` с диагностикой). `StateMachine` держит состояние `loading`, пока
не придёт одно из событий ([NX-SYS-001] StateMachine `menu/loading/playing`).

## Детали и частные случаи

### Раскладка папки `data/`
```
games/nexus/data/
├── manifest.json            # список всех контент-файлов + версия схемы
├── _schema/
│   ├── enemy.schema.json
│   ├── loot.schema.json
│   ├── quest.schema.json
│   ├── shopItem.schema.json
│   └── worldEvent.schema.json
├── enemies/
│   ├── goblin.json
│   ├── orc.json
│   ├── troll.json
│   ├── ghost.json
│   └── skeleton.json
├── loot/
│   ├── gold.json · potion.json · sword_iron.json
├── quests/        *.json
├── shop/          items.json
├── events/        rage.json · harvest.json …
└── i18n/
    ├── ru.json    # базовая локаль (источник истины ключей)
    └── en.json
```
Заметь: `$schema` внутри `goblin.json` указывает на `"../_schema/enemy.schema.json"` — **исправление**
битого пути из [NX-REVIEW#sec3-3] ⚪ (исходник ссылался мимо файла).

### Пример: `eDefs[0]` → `enemies/goblin.json`
Сейчас (`EnemySystem.js:10`):
```js
{ x:-5, z:-3, c:0x27ae60, n:'Гоблин', hp:60, atk:8, xp:30, g:8, w:.4, h:.82, d:.4, yB:.41, spd:2.6 }
```
Целевой `data/enemies/goblin.json` (данные + ключ + ссылочный лут вместо хардкода):
```json
{
  "$schema": "../_schema/enemy.schema.json",
  "id": "goblin",
  "nameKey": "enemy.goblin.name",
  "stats": { "hp": 60, "atk": 8, "xp": 30, "gold": 8, "spd": 2.6 },
  "body":  { "w": 0.4, "h": 0.82, "d": 0.4, "yBase": 0.41, "color": "0x27ae60" },
  "spawn": { "x": -5, "z": -3 },
  "lootTable": [
    { "item": "gold",   "min": 4, "max": 12, "chance": 1.0 },
    { "item": "potion", "chance": 0.25 },
    { "item": "sword_iron", "chance": 0.02 }
  ]
}
```
И `data/i18n/ru.json`: `{ "enemy.goblin.name": "Гоблин" }`, `en.json`: `{ "enemy.goblin.name": "Goblin" }`.
Линкер проверит, что `gold`/`potion`/`sword_iron` существуют в `loot/`. Это синхронизирует данные с
механикой: чтобы `sword_iron` реально дропался, движок (`LootSystem`) обязан читать `lootTable` из
данных, а не из хардкода — устранение рассинхрона из [NX-REVIEW#sec3-3] 🟡.

### Граничные случаи и решения
- **Циклические ссылки квестов** (`A.unlocks=[B], B.unlocks=[A]`): линкер допускает граф, но помечает
  циклы предупреждением (могут быть легитимны для развилок, но чаще — ошибка дизайна).
- **Опечатка в ключе i18n** (`nameKey: "enemy.gobln.name"`): ворота 3 ловит как «нет перевода для
  ключа» со списком файлов-нарушителей.
- **Отсутствие локали** (`en.json` неполон): не блокирует загрузку, но падает в `console.warn` с
  fallback на базовую `ru`; полнота `en` — отдельная задача, не стоп-фактор.
- **Числа как hex-цвет.** JSON не имеет hex-литералов; цвет хранится строкой `"0x27ae60"`, парсится в
  движке. Схема валидирует паттерн `^0x[0-9a-fA-F]{6}$`.
- **Версия схемы.** `manifest.json.schemaVersion` сверяется с версией движка; рассинхрон → явная ошибка
  (предотвращает «новый загрузчик ест старые данные» — параллель к версионированию сейвов [NX-REVIEW#sec5]).
- **Ошибка сети при `fetch`.** `Promise.all` с одним reject роняет всё — оборачиваем каждую загрузку, чтобы
  собрать **все** ошибки разом (а не первую попавшуюся), и эмитим `content:error` с полным списком.

### Где запускаются ворота: дев-сборка vs рантайм
- **В деве / CI:** полная валидация (все три вороты) — скрипт `validate-content`. Битый контент = красный
  CI ([NX-REVIEW#sec3-5] ⚪ «нет CI/линта»). Это «сдвиг влево»: ошибка ловится до запуска игры.
- **В рантайме (прод):** ворота 1 (schema) можно отключить ради скорости, если CI уже прогнал; ворота 2
  (целостность) дёшевы и остаются; i18n-fallback всегда мягкий. Развилка — ниже в вариантах.

## Предложения и варианты реализации

Псевдокод-заготовка для второго роя (детальные сигнатуры — в `40-specs/`, спека AssetLoader).

```pseudo
// ── СЛОЙ 1 engine: AssetLoader (fetch + Promise.all + кеш + .catch) ──────────
NEXUS.engine.AssetLoader = {
  loadContent(manifestUrl):
    manifest = await fetchJson(manifestUrl)
    assertSchemaVersion(manifest.schemaVersion)        // версия данных == версия движка
    // параллельно, но СОБИРАЕМ все ошибки (не падаем на первой):
    results = await Promise.all(
      manifest.files.map(f =>
        fetchJson(f.url).then(d => ({ok:true, type:f.type, id:f.id, data:d}))
                        .catch(e => ({ok:false, url:f.url, error:e}))   // ФИКС: .catch на каждом
      ))
    netErrors = results.filter(r => !r.ok)
    if netErrors.length: emit('content:error', {stage:'fetch', errors:netErrors}); return

    tables = groupByType(results)                       // {enemies:{goblin:{...}}, loot:{...}, ...}
    report = validateAll(tables)                        // три вороты, см. ниже
    if report.errors.length:
      emit('content:error', {stage:'validate', errors:report.errors}); return
    NEXUS.data = tables                                 // кеш: движок читает NEXUS.data.enemies['goblin']
    NEXUS.i18n = buildI18n(tables.i18n)
    emit('content:loaded', {counts: countByType(tables), warnings: report.warnings})
}

// ── Три вороты качества ──────────────────────────────────────────────────────
function validateAll(tables):
  errors = []; warnings = []
  // (1) СТРУКТУРА — JSON Schema по типу
  for (type, entries) in tables.byType:
    schema = SCHEMAS[type]
    for (id, doc) in entries:
      for problem in jsonSchemaCheck(doc, schema):
        errors.push(`[schema] ${type}/${id}: ${problem.path} ${problem.message}`)
  // (2) ССЫЛОЧНАЯ ЦЕЛОСТНОСТЬ — все строковые id резолвятся
  refFields = { enemy:['lootTable[].item'], quest:['unlocks[]','targetZone'], shopItem:['gives'] }
  for (type, entries) in tables.byType:
    for (id, doc) in entries:
      for ref in extractRefs(doc, refFields[type]):
        if not exists(tables, ref.targetType, ref.value):
          errors.push(`[ref] ${type}/${id}.${ref.path} -> '${ref.value}' не найден`)
      // мягкая проверка циклов для quest.unlocks:
      if type=='quest' and hasCycle(id, tables.quests): warnings.push(`[cycle] quest ${id}`)
  // (3) I18N — ключи имеют перевод в базовой локали
  base = tables.i18n['ru']
  for (type, entries) in tables.byType:
    for (id, doc) in entries:
      for key in extractI18nKeys(doc):                  // nameKey, descKey, ...
        if not base[key]: errors.push(`[i18n] нет перевода '${key}' (${type}/${id})`)
  return { errors, warnings }
```

### Развилки реализации
- **A. Лёгкий ручной валидатор схем (рекомендую для v1).** Минимальный чек типов/required без внешней
  зависимости. Достаточно для масштаба прототипа (5 врагов, [NX-REVIEW#sec3-2]), 0 кб бандла, работает в
  браузере. Минус — не полный JSON Schema (нет `$ref`, `allOf`).
- **B. Полный JSON Schema (Ajv).** Стандарт, мощно (`$ref`, форматы, `oneOf`), но +вес и сборка. Брать,
  когда контента станет много и нужны переиспользуемые под-схемы. Совместимо с CI.
- **C. Кодогенерация типов из схем** (schema → TS-типы) — для будущего, если перейдём на ES-модули+бандлер
  ([NX-SYS-001] открытый вопрос namespace vs модули).
- **Где валидировать:** дев/CI — всегда полная (вороты 1–3); прод-рантайм — вороты 2 (дёшево) обязательно,
  ворота 1 опционально (флаг `NEXUS.config.validateSchemasAtRuntime`). i18n всегда мягкая с fallback.
- **Формат хранения:** JSON для v1 (нативный `fetch`/`JSON.parse`, читается дизайнером). JSON5/YAML — позже,
  если нужны комментарии в данных (требует парсер в бандле).

## Риски, открытые вопросы
- **Двойной источник истины формата.** Схема и движок описывают одни и те же поля — рассинхрон
  возможен (ровно тот баг `dropTable`/`sword_iron` из [NX-REVIEW#sec3-3]). Митигация: ворота целостности +
  правило «движок читает только из `NEXUS.data`, хардкод-массивов нет» (линт по [NX-SYS-001]).
- **Стоимость старта.** Множество мелких `fetch` на старте — латентность. Митигация: на проде склеивать в
  один `bundle.json` (build-шаг); в деве — отдельные файлы для удобства правок. Бюджеты загрузки — [NX-SYS-006].
- **i18n как поставщик ключей для UI.** Диегетичный UI ([NX-INN-005]) и прогрессия знанием ([NX-INN-004])
  тоже потребляют строки — формат ключей должен быть общим, а не только для контента. Согласовать в спеке.
- **Процедурный контент через тот же пайплайн.** [NX-INN-012] генерирует зоны: сгенерированный артефакт
  обязан проходить те же три вороты, иначе генератор станет лазейкой мимо валидации. Контракт «генератор
  выдаёт валидный по схеме документ» — открытый пункт для [NX-INN-012]/спеки.
- **Версионирование данных vs сейвов.** `schemaVersion` контента и `schemaVersion` сейва — разные оси;
  миграции сейвов ([NX-REVIEW#sec5]) — отдельный документ, но обе оси должны жить по одному принципу.
- **Анти-чит и доверие.** Данные грузятся клиентом и в асинхронной модели ([NX-VIS-001], [NX-INN-003])
  могут быть подменены — балансные таблицы, влияющие на «эхо», должны валидироваться и на сервере
  (область сетевого документа [NX-SYS-002], не здесь).

## Комментарии
Документ комментирует раздел data-driven `ARCHITECTURE.md` ([NX-ARCH#sec5-data]) — где `data/*.json`,
`AssetLoader` и `_schema.json` поданы как сделанное, — и закрывает дефекты ревью [NX-REVIEW#sec3-3]
(отсутствие пайплайна, рассинхрон схем, отсутствие i18n/целостности, битый путь `$schema`) и пункт
[NX-REVIEW#sec5] «AssetLoader поднять из Фазы 3 в Фазу 2». Это технический фундамент, на который опирается
процедурно-авторский гибрид [NX-INN-012] и прогрессия знанием [NX-INN-004] (рецепты/бестиарий как данные).
Возражения и развилки — в `90-comments/`.

## Связанные документы
- [NX-VIS-001 Видение и столпы](../10-vision/NX-VIS-001-vision-and-pillars.md) — северная звезда
- [NX-SYS-001 Ядро v2: ECS/EventBus/namespace](./NX-SYS-001-core-architecture-v2.md) — слои, `NEXUS.*`, контракты
- [NX-SYS-004 Рендер-абстракция 2D/2.5D/3D](./) — один контент, три клиента
- [NX-SYS-006 Ассеты и бюджеты загрузки](./) — байты (звук/текстуры/модели), кеш-бастинг, SRI
- [NX-INN-012 Процедурно-авторский гибрид](../20-innovation/NX-INN-012-procedural-authored-hybrid.md) — поставщик зон через этот пайплайн
- [NX-INN-004 Прогрессия знанием](../20-innovation/NX-INN-004-knowledge-progression.md) — рецепты/бестиарий как данные
- [ARCHITECTURE.md](../../ARCHITECTURE.md) (NX-ARCH) · [ARCHITECTURE_REVIEW.md](../../ARCHITECTURE_REVIEW.md) (NX-REVIEW)
- [Конституция вики](../00-meta/CONSTITUTION.md) · [Шаблон](../00-meta/TEMPLATE.md)
</content>
</invoke>
