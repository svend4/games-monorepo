# Orchard Peaks — прод-порт (TypeScript + Vite + Capacitor)

Прод-приложение по проверенному прототипу `../prototype` (Проходы А–Д) и книге
GDD `../` (главы 01–12). Архитектура повторяет завершённый порт Block Surge
(`../../block-puzzle/app`): чистое ядро, слои экономики/меты/монетизации со
Store и санитайзингом, реклама за интерфейсом AdProvider, DOM-оверлеи,
детерминированный симулятор экономики с headless-CLI.
**Линейка Е.1 → Е.2 → Е.3 закрыта.** Вся реклама и покупки — СИМУЛЯЦИЯ.

## Статус линейки Е

| Проход | Объём | Статус |
| --- | --- | --- |
| **Е.1** | Vite + TS strict, ядро TriPeaks (`src/core`), экономика/мета (`src/economy`, `src/meta`), DOM-рендер стола (`TableUi`) + мета-экран (`MetaUi`) | ✅ |
| **Е.2** | Слой рекламы за интерфейсом (`src/ads`), монетизация с капами на Clock (`src/monetize`): 6 rewarded-плейсментов RW1–RW6 + INT1, 12 SKU, подписка, копилка; магазин 💎 / дашборд 📊 | ✅ |
| **Е.3** | Симулятор экономики (`src/sim`, порт `prototype/sim.js` **бит-в-бит**), A/B + тюнинг + гейты (`src/experiments`), кокпит 🚀 (`CockpitUi`), CLI `npm run sim`, Capacitor + safe-area | ✅ |

## Решение по рендеру: стол — DOM, не Phaser

Прототип сознательно рендерит стол чистым DOM, и порт это **сохраняет**
(`src/ui/TableUi.ts`, порт 1:1). Причина — требования доступности для ЦА 45+
из главы 07-ux-ui-ftue.md:

- карты — крупные DOM-кнопки (`role="button"`, `aria-label`, `aria-hidden`);
- полная клавиатурная навигация (`tabindex` на открытых картах, Enter/Space);
- `aria-live`-тосты и оверлеи, базовый кегль ≥ 18px, лейаут на CSS `calc()`.

В канвасе всё это потребовало бы параллельного accessibility-дерева. Прод-стек
при этом полный: **TypeScript strict + Vite + Capacitor** — WebView рендерит
DOM нативно; паритет со стеком Block Surge — на уровне слоёв, а не рендера.

## Архитектура слоёв

```
src/
  core/         чистая логика партии (ни DOM, ни Phaser): раскладка «3 пика»,
                правила ±1 A↔K, генератор с отбором по плейаутам, ходы/ундо,
                rng.ts (mulberry32 + fnv1a32 — бит-в-бит на всех платформах)
  economy/      Store (сейв orchardPeaks.meta), Economy (монеты/урожай/бустеры),
                Analytics (+onTrack — лента дашборда); санитайзинг — save.ts
  meta/         сад 4 зоны × 4 заказа, стрик «Утренняя лейка», миссии, даты
  ads/          Проход Е.2: AdProvider-ИНТЕРФЕЙС (provider.ts) +
                SimAdProvider (СИМУЛЯЦИЯ: оверлей 3–5 c, метка «СИМУЛЯЦИЯ»,
                eCPM-модель по гео Tier-1/Tier-2-3) + MaxAdProvider (скелет
                AppLovin MAX) + фабрика createAdProvider + ecpm.ts (06 §6.7)
  monetize/     Проход Е.2: MonetizeController — капы показов на инжектируемом
                Clock (06 §6.3 — интервалы/дневные/сессионные/усталость/покой
                плательщика), 6 rewarded-плейсментов, INT1, полка 12 SKU,
                подписка «Клуб садовода», копилка; замок adInFlight против
                гонки check-then-act; сейв orchardPeaks.monetize (схема 1:1)
  sim/          Проход Е.3: ДЕТЕРМИНИРОВАННЫЙ симулятор экономики
                (порт prototype/sim.js ВЕРБАТИМ, приложение 12) — sim.ts
                (BOOK + движок + checkGates + formatSummary), cli.ts (headless)
  experiments/  Проход Е.3: A/B-фреймворк ([09] §9.6), панель тюнинга с белым
                списком ручек, гейты go/iterate/kill ([09] §9.5); ключи
                orchardPeaks.tuning / abSession / softScen (те же, что прототип)
  ui/           DOM-оверлеи: TableUi (стол + rewarded-CTA + INT1),
                MetaUi (Сад/Задания/Лавка), ShopUi (💎), DashboardUi (📊 KPI,
                светлая тема 45+), CockpitUi (🚀 soft-launch кокпит)
  style.css     порт prototype/style.css 1:1 + safe-area (Проход Е.3)
  main.ts       композиция: сервисы → провайдеры → UI → стол
```

Правила зависимостей: `core` ни от чего не зависит; `sim` — самодостаточен
(свой PRNG — как в прототипе); `experiments` — от `sim` + `core/rng` +
интерфейса хранилища; `monetize` — от `ads` (интерфейс) + `economy`;
UI-классы — только от сервисов.

## Скрипты

| Скрипт | Что делает |
| --- | --- |
| `npm run dev` | dev-сервер Vite (порт 5175) |
| `npm run typecheck` | `tsc --noEmit` (strict, без any) |
| `npm test` | Vitest: 118 тестов (ядро, экономика, мета, монетизация, симулятор/кокпит) |
| `npm run build` | typecheck + прод-сборка в `dist/` (base `./`) |
| `npm run sim -- [seed] [N]` | headless-симулятор экономики (сводка в stdout) |
| `npm run cap:sync` | `npx cap sync` — копирует `dist/` в нативные проекты |
| `npm run cap:android` / `cap:ios` | sync + открыть Android Studio / Xcode |

### Симулятор экономики (Проход Е.3)

```
npm run sim -- seed42 200     # seed=42, N=200 игроков × 30 дней
npm run sim                   # дефолты прототипа: seed=1000, N=2000
```

Печатает монетный контур по дням (медианы когорты), точку «Кошелька»
(профицит→дефицит, окно дня 12–16), метрики сада и рекламы (ad-ARPDAU,
rewarded/DAU, INT/DAU) и контрольные точки приёмки К1–К8 (§12.6).

- **Детерминизм (I-E1)**: весь случай — через seeded-PRNG (mulberry32),
  сид игрока = `seed + 7·i`; никаких `Math.random`/`Date.now` в расчётах.
- **БИТ-В-БИТ с прототипом — главный критерий верности порта**: вывод
  `npm run sim` **побайтово идентичен** `node ../prototype/sim.js`
  (дефолты CLI), а произвольные seed/N — прогону через API прототипа
  `run({N, days:30, seed})`. Закреплено тестами `tests/sim.test.ts`
  (порт сравнивается с `require('../prototype/sim.js')` напрямую).
- **Один модуль — два входа**: браузерный кокпит (🚀) и CLI вызывают один и
  тот же `src/sim/sim.ts`.

### Кокпит 🚀 (кнопка HUD «Soft»)

- **Симулятор**: N 50–400 игроков × 30 дней (<1 c), график и таблица
  монетного контура, гейты К1–К8. К7/К8 — известные находки Ф2/Ф4
  приложения 12, их адресует тюнинг.
- **A/B ([09] §9.6)**: 3 эксперимента прототипа 1:1 (наклон E(n) 1.010/1.012,
  заказы ±20%, rewarded-урожай ×1/×2); вариант =
  `fnv1a32(sessionId + ':' + key) % число_арм` по персистентному session-id.
- **Тюнинг**: 10 ручек (E(n), WR-плато, заказы, миссии, RW6-грант, eCPM,
  IAP-ARPDAU) в `orchardPeaks.tuning`; чужие ключи отбрасываются белым
  списком; «↺ Сброс к значениям книги» возвращает номиналы глав 05–06/12.
  Ручной тюнинг побеждает A/B-патч (сознательное переопределение).
- **Гейты ([09] §9.5)**: сценарии Пессимист/База/Оптимист, юнит-экономика
  (LTV/ROAS/payback), вердикт GO / ITERATE / KILL. **Без прогона симулятора
  GO невозможен** (экономическая готовность — предусловие; ложного GO нет),
  kill — после 3 исчерпанных iterate-циклов.

### Монетизация (Проход Е.2) — карта плейсментов 06 §6.2

| Плейсмент | Что делает | Кап |
| --- | --- | --- |
| RW1 «Второй шанс» | тупик при столе ≥ 60% → +5 карт в колоду | 1/уровень |
| RW2 «Удвоить награду» | ×2 монеты за пройденный уровень | 1/уровень |
| RW3 «Бустер до уровня» | бесплатный джокер/лукошко | 2/день |
| RW4 «Колесо ярмарки» | сектор 100–1200 монет | 1/день |
| RW5 «×2 жетоны ярмарки» | только в ивент-уикенд (тумблер в 📊) | 3/день |
| RW6 «Кошелёк садовода» | грант 0.8·E(n) при балансе < 2·E(n) | 3/день |
| INT1 межуровневый | возврат в сад после победы | правила §6.3 |

Правила INT1 (§6.3, все на инжектируемом Clock): уровень ≥ 12, установка
≥ 24 ч, ≥ 2 уровня и ≥ 180 c с прошлого INT, ≤ 8/день, ≤ 3/сессию, 60 c
после rewarded, окно покоя плательщика 72 ч после покупки, eCPM-floor
запроса; remove-ads/подписка убирают INT (rewarded остаётся).

**Замок `adInFlight` (урок Block Surge)**: капы проверяются ДО `await`
показа, награды — ПОСЛЕ; без замка двойной тап по офферу до открытия ролика
дважды прошёл бы проверку капа и удвоил награду. Гонка закреплена тестом
(`reward-once при гонке`).

## Подмена AdProvider на MAX (прод)

Игра знает только интерфейс `AdProvider` (`src/ads/provider.ts`); реализация
выбирается фабрикой `createAdProvider` (`src/ads/index.ts`) по флагу окружения:

```
VITE_AD_PROVIDER=max npm run build   # → MaxAdProvider (скелет 06 §6.8)
npm run build                        # → SimAdProvider (СИМУЛЯЦИЯ)
```

Шаги прод-интеграции AppLovin MAX — в `src/ads/maxProvider.stub.ts` (SDK-ключ,
ad unit'ы, consent до init, OnAdRevenuePaid → onImpression). Покупки — за
интерфейсом `PurchaseProvider` (`src/monetize/purchase.ts`): в проде StoreKit /
Play Billing с серверной валидацией чека, здесь — SimPurchaseProvider.

## Capacitor: путь до устройств

Конфиг: `capacitor.config.ts` (`appId com.surgegames.orchardpeaks`,
`appName Orchard Peaks`, `webDir dist`). Нативные проекты **не в репозитории** —
генерируются локально:

```
npm run build          # dist/ (base './' — работает в WebView)
npx cap add android    # один раз: генерирует android/
npx cap add ios        # один раз (macOS): генерирует ios/
npm run cap:sync       # копирует dist/ в нативные проекты
npm run cap:android    # sync + открыть Android Studio → Run
npm run cap:ios        # sync + открыть Xcode → Run
```

Safe-area: `viewport-fit=cover` в `index.html` + блок `env(safe-area-inset-*)`
в конце `src/style.css` (HUD и шапки экранов — сверху, нижняя панель и
тосты — снизу), чтобы вырезы/чёлки не перекрывали UI. `@capacitor/core`/`cli` —
devDeps; рантайм-API Capacitor в коде не используется (веб-сборка одна и та же).

## Сейв-совместимость с прототипом

Схемы localStorage 1:1 с `../prototype` — прогресс подхватывается без миграции
(закреплено тестами-фикстурами):

| Ключ | Слой | Санитайзинг |
| --- | --- | --- |
| `orchardPeaks.meta` | экономика+мета (монеты, урожай, сад, миссии, стрик) | `economy/save.ts` (deepMerge + sanitize) |
| `orchardPeaks.coins` / `.bestScore` / `.wins` / `.games` | legacy Прохода А | `Store` / `TableUi` |
| `orchardPeaks.monetize` | remove-ads, подписка, копилка, дневные капы, lifetime-выручка | `monetize/save.ts` |
| `orchardPeaks.tuning` | ручки кокпита (JSON-объект) | белый список `experiments.ts` |
| `orchardPeaks.abSession` | session-id A/B (сырая строка, не JSON) | `experiments.ts` |
| `orchardPeaks.softScen` | сценарий гейтов (сырая строка) | валидация по списку |

Повреждённый JSON любого ключа не роняет игру: числа приводятся к конечным
(целые счётчики ≥ 0, баланс копилки ≤ 15000), неизвестные гео/сценарии — к
дефолтным, чужие tune-ключи отбрасываются.

## Самопроверка

```
npm run typecheck            # зелёный
npm test                     # 118/118
npm run build                # dist/
npm run sim -- seed42 200    # сводка симулятора
# бит-в-бит с прототипом:
node ../prototype/sim.js > js.txt ; npm run sim --silent > ts.txt ; diff js.txt ts.txt
```
