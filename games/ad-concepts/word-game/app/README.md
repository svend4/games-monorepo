# WordGrove — прод-порт (TypeScript + Phaser 3 + Vite + Capacitor)

Прод-приложение по проверенному прототипу `../prototype` (Проходы А–Д) и книге
GDD `../` (главы 01–12). Архитектура повторяет завершённый порт Block Surge
(`../../block-puzzle/app`). Вся реклама и покупки — **СИМУЛЯЦИЯ** (никаких
реальных SDK, сетей и денег).

## Статус линейки Е

| Проход | Объём | Статус |
| --- | --- | --- |
| **Е.1** | Vite + TS strict + Phaser 3: ядро (`src/core`), экономика/мета (`src/economy`, `src/meta`), рендер колеса (WheelScene) + DOM-сетка/HUD/мета (`src/ui`) | ✅ |
| **Е.2** | Слой рекламы за интерфейсом (`src/ads`), монетизация с капами на Clock (`src/monetize`), магазин 🛒 с апселлом подписки, дашборд 📊 | ✅ |
| **Е.3** | Симулятор экономики (`src/sim`, порт Прохода Г, CLI `npm run sim` — бит-в-бит с прототипом), A/B+тюнинг+гейты (`src/experiments`), кокпит 🚀, safe-area, Capacitor | ✅ |

## Архитектура слоёв

```
src/
  core/        ЧИСТАЯ логика ядра: types, levels, grid, validate, game
               (CoreGame: ввод слова 11 §4.1, Лампа через инжектированный RNG,
               revealFreeLetter — хук RV-1/клуба), save, rng, storage
  economy/     econ (числа 05 1:1), Economy (жёлуди/копилка: кап 200,
               конвертация 1:1), Analytics (трекер-заглушка 09)
  meta/        config, dates, Meta (дневной по сид-дате + стрик с вехами,
               миссии, регионы)
  ads/         Проход Е.2 — рекламный слой за интерфейсом:
               provider.ts (контракт AdProvider: rewarded/interstitial/banner,
               impression-колбэк как OnAdRevenuePaid из MAX),
               ecpm.ts (матрица 06 §8.1 1:1: RW 17.8/13/6 · INT 14/10/4 ·
               BAN 0.55/0.40/0.15, джиттер ±25%, гео-корзины),
               simProvider.ts (СИМУЛЯЦИЯ: оверлей с отсчётом, баннер с
               авто-рефрешем 45 c), maxProvider.stub.ts (скелет прод-MAX),
               index.ts (фабрика по флагу VITE_AD_PROVIDER)
  monetize/    Проход Е.2 — слой монетизации (порт monetize.js 1:1):
               clock.ts (инжектируемые часы — капы тестируются без времени),
               config.ts (WGMON 1:1: INT-капы 06 §4, RV-капы 06 §3.1,
               подписка WordGrove Club 06 §5.1, Remove Ads, полка 7 SKU),
               interstitial.ts (правила I-1: no-ads/daily/ftue_level/
               session_cap 12/интервал 45 c/30 c после RW — порядок 1:1),
               purchase.ts (PurchaseProvider + симулятор покупок),
               save.ts + store.ts (сейв wordgrove.monetize.v1, схема
               прототипа 1:1 + санитайзинг), monetize.ts (MonetizeController:
               RV-1/RV-2/RV-5/RV-6, подписка с триалом и конверсией по
               календарю, замок adInFlight против гонки check-then-act)
  sim/         Проход Е.3 — симулятор экономики (порт sim.js 1:1):
               sim.ts (REF/MC/COHORT, сегменты 12 §2, лестница подсказок,
               детерминизм INV-S2 — порядок вызовов RNG сохранён 1:1),
               cli.ts (headless-вход: npm run sim)
  experiments/ Проход Е.3 — soft-launch кокпит (порт experiments.js):
               experiments.ts (A/B-пул 1:1: цена Лампы / длина триала /
               INT-кап; ручки тюнинга; гейты 09 §4.3 с подписочной моделью
               06 §8.3 и чувствительностью LTV), save.ts (ключ
               wordgrove_softlaunch, схема прототипа + белый список ручек)
  scenes/      WheelScene (Phaser) — колесо букв
  ui/          GridUi (+хуки Е.2: RV-2 в оверлее победы, interstitial перед
               «Дальше», клубный безлимит Лампы), MetaUi (+гейт RV-5 копилки),
               ShopUi (🛒 подписка-герой, Remove Ads, RV-6, полка 7 SKU),
               DashboardUi (📊 KPI сессии + сплит 65/22/13 + A/B-группы),
               CockpitUi (🚀 A/B + тюнинг + прогон + гейты)
  main.ts      композиция: сервисы → мосты → UI → монетизация → кокпит → Phaser
```

Правила зависимостей: `core` ни от чего не зависит; `monetize` говорит с ядром
через мост `MonetizeBridge` и с рекламой/платежами — только через интерфейсы
`AdProvider`/`PurchaseProvider`; время — через инжектируемый `Clock`; UI-классы
только рендерят и слушают. Контейнеры и стили — `index.html` (safe-area:
`viewport-fit=cover` + `env(safe-area-inset-*)` на HUD, баннере и оверлеях).

## Монетизация (Проход Е.2, всё — СИМУЛЯЦИЯ)

- **Rewarded (06 §3.1)**: RV-1 «Бесплатная Лампа» (1/уровень, ≤4/день),
  RV-2 «×2 монеты за уровень» на оверлее победы, RV-5 «Открыть копилку»
  (гейт копилки меты), RV-6 «Заморозка стрика» в магазине.
- **Interstitial I-1 (06 §4)**: между уровнями; не раньше 3-го уровня, ≥45 c
  между показами, ≥30 c после rewarded, ≤12/день, не на дневном. Недопоказы —
  событие `ad_capped` с причиной.
- **Banner B-1 (06 §3.3)**: полоса снизу с авто-рефрешем 45 c; прячется при
  подписке/Remove Ads, на дневном и под оверлеями.
- **Подписка WordGrove Club (06 §5.1) — главный продукт**: триал 7 дней,
  $8.99/мес · $49.99/год; перки: no-ads, безлимит Ламп, автооткрытие копилки,
  +20% монет, авто-заморозка стрика. Конверсия триала — по календарю
  (инжектируемые часы), net-выручка амортизируется за день.
- **Remove Ads $9.99** и **полка 7 SKU** ($0.99–$99.99, стартовый набор
  одноразовый).
- Замок `adInFlight`: капы проверяются до `await` показа — двойной тап по
  офферу не удваивает награду (урок Block Surge, покрыто тестом гонки).

## Soft-launch кокпит (Проход Е.3)

Кнопка 🚀 в HUD. Офлайн-инструмент прод-команды, в игру не вмешивается:
A/B-назначение по fnv1a32-хешу персистентного session-id, панель тюнинга
поведенческих ручек (номиналы 05/06 не тюнятся — INV-S1), прогон REF/MC/COHORT
(N 100–400, <1 c), гейты go/iterate/kill 09 §4.3 (D1, blended ARPDAU,
ROAS(365)/ROAS(7), подписочная доля) + виджет чувствительности LTV к обвалу
триал-конверсии. Лимит iterate-циклов — 2.

## Скрипты

| Скрипт | Что делает |
| --- | --- |
| `npm run dev` | dev-сервер Vite (порт 5176) |
| `npm run typecheck` | `tsc --noEmit` (strict, без any) |
| `npm test` | Vitest: 114 тестов (ядро, мета, капы монетизации, подписка, гонка reward-once, детерминизм симулятора, гейты, санитайзинг сейвов) |
| `npm run build` | typecheck + прод-сборка в `dist/` (base `./`) |
| `npm run sim -- [runId] [N]` | headless-симулятор экономики; вывод БИТ-В-БИТ с `node ../prototype/sim.js [runId] [N]` (кроме npm-баннера), дефолты `cli`/300 |
| `npm run cap:*` | Capacitor: sync / Android Studio / Xcode |

Проверка эквивалентности порта:

```
npm run sim -- seed42 200            # приложение
node ../prototype/sim.js seed42 200  # прототип — тот же текст бит-в-бит
```

## Сейв-совместимость с прототипом

Ключи и схемы localStorage 1:1 с `../prototype` — прогресс подхватывается
без миграции (проверено тестами с фикстурами):

| Ключ | Слой | Санитайзинг |
| --- | --- | --- |
| `wordgrove.save.v1` | ядро: level, coins, revealed (1\|2), foundBonus, usedHint, rewardGiven | `core/save.ts` |
| `wordgrove.economy.v1` | жёлуди: acorns (кап 200), acornsLifetime, piggyOpens, burned | `economy/economy.ts` |
| `wordgrove.meta.v1` | daily+стрик, миссии, регионы, статистика | `meta/meta.ts` |
| `wordgrove.monetize.v1` | монетизация: removeAds, subscription (plan/trial/since), geoTier, freezeTokens, дневные капы, lifetime-выручка | `monetize/save.ts` |
| `wordgrove_softlaunch` | кокпит: session-id (A/B-бакет), tune-ручки, сценарий/CPI/триал-рейт, iterate-счётчик | `experiments/save.ts` |

Повреждённый JSON любого ключа не роняет игру: числа приводятся к конечным
неотрицательным, неизвестное гео — к бленду, чужие tune-ключи отбрасываются
по белому списку (номиналы 05/06 через сейв не подменить).

## Capacitor (Е.3)

`capacitor.config.ts` (appId `com.surgegames.wordgrove`, webDir `dist`).
Нативные проекты в репо не хранятся — генерируются локально:

```
npm run build
npx cap add android   # или ios
npm run cap:android   # sync + Android Studio
```

Safe-area: `viewport-fit=cover` во viewport; `#app`, баннер B-1 и оверлеи
магазина/дашборда/кокпита отступают от `env(safe-area-inset-top/bottom)` —
вырезы и «чёлки» не перекрывают HUD и полосу баннера.

## Самопроверка

```
npm run typecheck            # зелёный
npm test                     # 114/114
npm run build                # dist/
npm run sim -- seed42 200    # сводка REF+MC+COHORT, бит-в-бит с прототипом
npm run dev                  # играбельно: ядро+мета Е.1, RV-1/RV-2/RV-5/RV-6,
                             # interstitial между уровнями, баннер, магазин 🛒,
                             # дашборд 📊, кокпит 🚀
```
