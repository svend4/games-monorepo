# Block Surge — прод-порт (TypeScript + Phaser 3 + Vite + Capacitor)

Прод-приложение по проверенному прототипу `../prototype` и книге GDD `../`
(главы 01–10, приложения 11–12). Линейка **Е.1 → Е.2 → Е.3 закрыта**:
ядро+мета, монетизация, soft-launch кокпит и Capacitor-обвязка.

## Статус линейки Е

| Проход | Объём | Статус |
| --- | --- | --- |
| **Е.1** | Vite + TS strict + Phaser 3, ядро партии (`src/core`), экономика/мета (`src/economy`, `src/meta`), DOM-оверлеи (`MetaUi`) | ✅ |
| **Е.2** | Слой рекламы за интерфейсом (`src/ads`), монетизация с капами на Clock (`src/monetize`), магазин/дашборд (`ShopUi`/`DashboardUi`) | ✅ |
| **Е.3** | Симулятор экономики (`src/sim`, порт Прохода Г), A/B+тюнинг+гейты (`src/experiments`), кокпит 🚀 (`CockpitUi`), CLI `npm run sim`, Capacitor | ✅ |

## Архитектура слоёв

```
src/
  core/         чистая логика партии: поле, фигуры, скоринг, солвер, RNG
                (mulberry32 + fnv1a32, бит-в-бит на всех платформах, INV-G3)
  economy/      Store (сейв blocksurge_meta), Economy (монеты/бустеры),
                Analytics; санитайзинг сейва — economy/save.ts
  meta/         карта «Путешествия», миссии, стрик, бустер-контроллер, даты
  ads/          AdProvider-ИНТЕРФЕЙС + SimAdProvider (симуляция) +
                MaxAdProvider (скелет) + фабрика createAdProvider + eCPM-модель
  monetize/     MonetizeController: капы показов на инжектируемом Clock,
                interstitial/rewarded/revive, покупки (SimPurchaseProvider),
                сейв blocksurge_monetize
  sim/          Проход Е.3: ДЕТЕРМИНИРОВАННЫЙ симулятор экономики
                (порт prototype/sim.js, приложение 12) — constants.ts (числа
                1:1), sim.ts (движок), cli.ts (headless-вход)
  experiments/  Проход Е.3: A/B-фреймворк, панель тюнинга, гейты 09 §5.4
                (порт prototype/experiments.js), сейв blocksurge_softlaunch
  ui/           DOM-оверлеи: MetaUi (топбар/мета), ShopUi (🛒),
                DashboardUi (📊), CockpitUi (🚀 soft-launch кокпит)
  scenes/       GameScene (Phaser) — единственный рендер партии
  main.ts       композиция: сервисы → провайдеры → UI → Phaser.Game
```

Правила зависимостей: `core` ни от чего не зависит; `sim` зависит только от
`core/rng`; `experiments` — от `sim` + `economy/store` (интерфейс хранилища);
UI-классы — только от сервисов, DOM-контейнеры и стили живут в `index.html`.

## Скрипты

| Скрипт | Что делает |
| --- | --- |
| `npm run dev` | dev-сервер Vite (порт 5173) |
| `npm run typecheck` | `tsc --noEmit` (strict, без any) |
| `npm test` | Vitest: 127 тестов (ядро, мета, монетизация, симулятор/кокпит) |
| `npm run build` | typecheck + прод-сборка в `dist/` (base `./`) |
| `npm run sim -- [runId] [N]` | headless-симулятор экономики, сводка в stdout |
| `npm run cap:sync` | `npx cap sync` — копирует `dist/` в нативные проекты |
| `npm run cap:android` / `cap:ios` | sync + открыть Android Studio / Xcode |

### Симулятор экономики (Проход Е.3)

```
npm run build        # не обязательно для sim
npm run sim -- seed42 200
```

Печатает баланс BASE×CORE по дням против таблицы 05 §4 (отклонения, чекпоинты
калибровки M1), earn/spend ratio, rewarded/DAU, ad-ARPDAU, долю дефицита,
fail-коридоры и красные флаги дизайна (12 §8.4) + короткую COHORT-сводку.

- **Детерминизм (INV-E2)**: сид игрока = `fnv1a32('blocksurge:econsim:v1:{runId}:{playerId}')`,
  никаких `Math.random`/`Date.now` в расчётах. Один runId → бит-в-бит один
  результат: вывод `npm run sim -- seed42 200` **идентичен** `node ../prototype/sim.js seed42 200`.
- **Один модуль — два входа**: браузерный кокпит (🚀) и CLI вызывают один и
  тот же `src/sim/sim.ts`.
- **INV-E1**: номиналы (цены, награды, капы) — константы `src/sim/constants.ts`,
  тюнится только TUNE-слой (свободные EV, калибровка 12 §8).

### Кокпит 🚀 (в приложении, кнопка топбара)

- **A/B**: 3 эксперимента прототипа 1:1 (`int_cap` 7/5, `rw2_mult` ×2/×3,
  `start_grant` 200/300); вариант — `fnv1a32(sessionId + ':' + expId) % 2`
  по персистентному session-id; «Сравнить A/B» гонит оба варианта.
- **Тюнинг**: W_HARD, ad-капы, earn-rate, eCPM — в localStorage
  (`blocksurge_softlaunch`), сброс к «книге» (калиброванный baseline 12 §8).
- **Прогон**: N 100–400 игроков × 30 дней (<1 с), таблица с цветовой
  разметкой vs 05 §4, KPI-плитки, доля sinks.
- **Гейты 09 §5.4**: D1/D7/ad-ARPDAU/D7 ROAS против kill/scale-порогов,
  сценарии удержания (пессимист/база/оптимист), счётчик iterate ≤2 (10 P7).
  Без прогона ad-ARPDAU=0 → вердикт не может стать ложным GO.

Кокпит — офлайн-инструмент прод-команды: в игру не вмешивается, пишет только
свой ключ localStorage.

## Подмена AdProvider на MAX (прод)

Игра знает только интерфейс `AdProvider` (`src/ads/provider.ts`); реализация
выбирается фабрикой `createAdProvider` (`src/ads/index.ts`) по флагу окружения:

```
VITE_AD_PROVIDER=max npm run build   # → MaxAdProvider (скелет 06 §8)
npm run build                        # → SimAdProvider (симуляция)
```

Шаги прод-интеграции AppLovin MAX (06 §8):
1. `npm i @capacitor-community/... / applovin-max` (нативный SDK через
   Capacitor-плагин) и заполнить скелет `src/ads/maxProvider.stub.ts`:
   init SDK, load/show для `int|rw|banner`, impression-level revenue callback.
2. Ничего в `MonetizeController` менять не нужно — капы, воронка офферов и
   аналитика работают поверх интерфейса.
3. Дашборд 📊 продолжит показывать выручку — из MAX API вместо eCPM-модели.

## Capacitor: путь до устройств

Конфиг: `capacitor.config.ts` (`appId com.surgegames.blocksurge`,
`appName Block Surge`, `webDir dist`). Нативные проекты **не в репозитории** —
генерируются локально:

```
npm run build          # dist/ (base './' — работает в WebView)
npx cap add android    # один раз: генерирует android/
npx cap add ios        # один раз (macOS): генерирует ios/
npm run cap:sync       # копирует dist/ + плагины в нативные проекты
npm run cap:android    # sync + открыть Android Studio → Run
npm run cap:ios        # sync + открыть Xcode → Run
```

Safe-area: `viewport-fit=cover` + `env(safe-area-inset-*)` в `index.html`
(топбар — сверху, бустер-бар и баннер BAN-1 — снизу, оверлеи — сверху), чтобы
вырезы/чёлки не перекрывали UI. `@capacitor/core`/`@capacitor/cli` — devDeps;
рантайм-API Capacitor в коде не используется (веб-сборка одна и та же).

## Сейв-совместимость с прототипом

Схемы localStorage 1:1 с `../prototype` — прогресс подхватывается без миграции:

| Ключ | Слой | Санитайзинг |
| --- | --- | --- |
| `blocksurge_meta` | экономика+мета (монеты, бустеры, карта, миссии, стрик) | `economy/save.ts` (deepMerge + sanitize) |
| `blocksurge_monetize` | Remove Ads, подписка, дневные капы, lifetime | `monetize/save.ts` |
| `blocksurge_softlaunch` | session-id, tune-правки, сценарий/CPI/IAP, iterate | `experiments/save.ts` (белый список ручек) |

Повреждённый JSON любого ключа не роняет игру: числа приводятся к конечным,
неизвестные сценарии/гео — к дефолтным, чужие tune-ключи отбрасываются.

## Самопроверка

```
npm run typecheck   # зелёный
npm test            # 127/127
npm run build       # dist/
npm run sim -- seed42 200   # сводка, идентичная node ../prototype/sim.js seed42 200
```
