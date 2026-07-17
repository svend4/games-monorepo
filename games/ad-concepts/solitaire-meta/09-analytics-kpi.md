# 09. Аналитика, KPI и юнит-экономика

**Проект:** Orchard Peaks. Назад: [08-liveops.md](08-liveops.md) · Далее: [10-production.md](10-production.md)

Стек: собственный event-pipeline (Capacitor → BigQuery) + AppsFlyer (атрибуция) + дашборды Metabase. Всё дерево событий живёт в клиенте с Проходов А–В ([10-production.md](10-production.md)) — soft launch без полной телеметрии не начинается.

---

## 9.1. Дерево событий трекинга

Общие параметры каждого события: `user_id, session_id, ts, level_reached, coins_balance, harvest_balance, days_since_install, payer_flag, subscriber_flag, ab_groups[], platform, geo_tier, app_version`.

### Сессии и FTUE

| Событие | Параметры | Зачем |
|---|---|---|
| `session_start` | `source (organic/push/icon), prev_session_gap_h` | DAU, сессии/DAU, эффект пушей |
| `session_end` | `duration_s, levels_played, screens_visited[]` | Длина сессии, вовлечённость |
| `ftue_step` | `step_id (1..12), duration_s, skipped` | Воронка FTUE, гейт ≥ 85% до уровня 3 ([07-ux-ui-ftue.md](07-ux-ui-ftue.md)) |
| `att_prompt` | `pre_prompt_shown, result` | Opt-in ≥ 30% |
| `push_opt_in` | `result, context` | База push-канала |

### Core

| Событие | Параметры | Зачем |
|---|---|---|
| `level_start` | `level_id, entry_cost, boosters[], attempt_no, is_stone` | Экономика входов, попытки |
| `level_finish` | `result (win/lose/quit), duration_s, moves, undo_used, cards_left, stock_left, max_streak, harvest_earned, coins_won, rescue_offers_shown, rescue_taken (rw/coins/none)` | Калибровка WR против кривой [03-core-gameplay.md](03-core-gameplay.md) п. 3.5; тюнинг генератора |
| `booster_use` | `booster_id, context (pre/in), paid_with (coins/inventory)` | Ценность бустеров ([05-economy.md](05-economy.md) п. 5.6) |
| `difficulty_assist` | `type (soft_buff/easy_hand), level_id, losses_before` | Контроль анти-чёрн механики |

### Экономика и мета

| Событие | Параметры | Зачем |
|---|---|---|
| `economy_balance` (снапшот 1/сессию) | `coins, harvest, boosters{}, tokens` | Дашборд sink/source, медианный баланс ([05-economy.md](05-economy.md) п. 5.8) |
| `coins_delta` | `amount, direction, source_id (win/mission/streak/rw6/iap/entry/booster/rescue...)` | Полный аудит валюты — главная таблица баланса |
| `order_complete` | `order_id, zone_id, harvest_spent, decor_choice` | Заказов/DAU ≥ 1,2 ([04-meta-progression.md](04-meta-progression.md) п. 4.9) |
| `zone_complete` | `zone_id, days_since_zone_start` | Темп меты (2–3 дня/зона) |
| `cutscene` | `scene_id, completed, duration_s` | Досмотр ≥ 70% |
| `collection_update` | `set_id, card_id, source, is_duplicate` | Гербарий: источники и дубли |
| `league_result` | `league_week, rank, harvest_score` | Соцслой |
| `event_action` | `event_id, action (join/token_earn/stall_buy/expire)` | Ярмарка: сгорание жетонов, вовлечённость |

### Монетизация

| Событие | Параметры | Зачем |
|---|---|---|
| `ad_opportunity` | `placement_id (RW1..RW6, INT1), eligible (bool), block_reason` | Числитель/знаменатель show rate; аудит правил 6.3 |
| `ad_offer_shown` | `placement_id` | Видимость офферов |
| `ad_started` / `ad_completed` / `ad_failed` | `placement_id, network, ecpm_usd (из MAX ILRD), duration_s` | Ad-ARPDAU по плейсментам — сверка с картой [06-monetization.md](06-monetization.md) п. 6.2 |
| `shop_open` | `source (button/wallet/pre_level/offer)` | Входы в полку |
| `iap_initiated` / `iap_success` / `iap_failed` | `sku, price_usd, is_first_purchase, offer_context` | Конверсия, ARPPU, окна офферов |
| `sub_state` | `state (start/renew/cancel/pause), month_no` | Подписка: цель 5% выручки |
| `remove_ads_purchased` | — | Сегмент INT-исключений |

### Ретеншен

| Событие | Параметры | Зачем |
|---|---|---|
| `push_received` / `push_opened` | `push_id, trigger` | CTR по триггерам, автоотключение < 2% ([08-liveops.md](08-liveops.md) п. 8.4) |
| `streak_update` | `day_no, frozen (bool)` | Стрик-механика |
| `churn_return` | `days_away, incentive_id` | Эффективность win-back ([08-liveops.md](08-liveops.md) п. 8.6) |

## 9.2. Воронки

1. **FTUE:** install → `ftue_step 1..12` → уровень 4. Гейты: шаг «уровень 1 победа» ≥ 97%, «уровень 3» ≥ 85%, «первый rewarded-оффер показан» ≥ 80%.
2. **Реклама:** `ad_opportunity(eligible)` → `ad_offer_shown` → `ad_started` → `ad_completed`. Норма completion 80–90% (бенчмарк rewarded); разрыв opportunity→shown > 15% = баг UI.
3. **IAP:** `shop_open` → `iap_initiated` → `iap_success`. Разрыв initiated→success > 10% = проблемы биллинга/цен.
4. **Мета:** победа → `order_complete` → `cutscene` → следующий `level_start` в той же сессии (замыкание петли ≥ 60%).

## 9.3. KPI-цели и бенчмарки

| KPI | Пессимист | **База** | Оптимист | Обоснование от бенчмарков |
|---|---|---|---|---|
| D1 retention | 35% | **42%** | 48% | Казуальный солитер с FTUE «победа за 60 секунд»; Vita-класс UX для 40+ держит верх диапазона жанра |
| D7 retention | 12% | **18%** | 23% | Мета + стрик; критично: 89% ad-LTV в первых 7 днях |
| D30 retention | 5.5% | **9%** | 13% | Мета-хвост (у ad-only солитеров D30 ~3–5%) |
| Сессий/DAU | 2.2 | **2.6** | 3.0 | Паттерн ЦА — «длинные ежедневные сессии» |
| Мин/DAU | 26 | **34** | 44 | 12–15 мин/сессию ([03-core-gameplay.md](03-core-gameplay.md) п. 3.8) |
| Rewarded показов/DAU | 2.5 | **4.0** | 5.0 | 6 плейсментов; 3+ плейсмента = 2,4x ARPDAU |
| Interstitial/DAU | 2.0 | **2.5** | 3.0 | Капы п. 6.3 |
| eCPM rewarded (blended) | $11 | **$16** | $18.5 | США iOS $19.63 / Android $16.49; микс гео 6.7 |
| eCPM interstitial (blended) | $8.5 | **$12** | $14 | США ~$14 |
| Ad ARPDAU | $0.05 | **$0.10** | $0.13 | = RW·eCPM/1000 + INT·eCPM/1000 |
| Конверсия в плательщика (D30 lifetime) | 2.2% | **3.8%** | 5.0% | Гибрид с полкой Grand Harvest-типа; смотрящие rewarded → IAP до 4,5x лучше |
| IAP ARPDAU | $0.07 | **$0.12** | $0.19 | ARPPU/мес $9–14 ([06-monetization.md](06-monetization.md) п. 6.9) |
| **ARPDAU blended** | $0.12 | **$0.22** | $0.32 | Hybrid-casual бенчмарк $0.15–0.50; puzzle-среднее $0.08 — мы выше за счёт Tier-1 фокуса |
| IAA ARPU 90 дней | $0.40 | **$0.85** | $1.20 | Casual-бенчмарк $0.55; наш микс Tier-1 + 6 плейсментов |
| CPI (US-blended, женщины 40+) | $2.60 | **$2.30** | $2.00 | Карточный casual в Tier-1; playable ads снижают |

## 9.4. Юнит-экономика: формулы

**Модель ретеншена** (степенная): `r(d) = a · d^(−b)`, `a = D1`, `b` калибруется по D7: `b = ln(D1/D7) / ln 7`.

**Активные дни за горизонт T:**

```
A(T) = 1 + Σ_{d=1..T} r(d) ≈ 1 + a/(1−b) · (T^(1−b) − 1)
```

**LTV:** `LTV(T) = A(T) × ARPDAU` (ARPDAU считаем стационарным: занижение раннего ad-пика ≈ компенсирует завышение позднего IAP-хвоста; на живых данных переходим на когортные кривые ARPDAU(d)).

**Окупаемость UA:** payback day = min t: `LTV(t) ≥ CPI`; ROAS(t) = `LTV(t) / CPI`.

## 9.5. Три сценария (горизонт 180 дней)

| Параметр | Пессимист | **База** | Оптимист |
|---|---|---|---|
| D1 / D7 / D30 | 35% / 12% / 5.5% | **42% / 18% / 9%** | 48% / 23% / 13% |
| b (степень кривой) | 0.55 | **0.435** | 0.378 |
| A(30), активных дней | 3.8 | **5.3** | 6.6 |
| A(90) | 6.1 | **9.7** | 12.9 |
| A(180) | 8.3 | **14.2** | 19.7 |
| ARPDAU | $0.12 | **$0.22** | $0.32 |
| LTV(30) | $0.46 | **$1.17** | $2.11 |
| LTV(90) | $0.73 | **$2.13** | $4.13 |
| **LTV(180)** | **$0.99** | **$3.12** | **$6.30** |
| CPI | $2.60 | **$2.30** | $2.00 |
| ROAS D7 | 10% | **24%** | 45% |
| ROAS D30 | 18% | **51%** | 106% |
| ROAS D180 = LTV/CPI | 0.38 | **1.36** | 3.16 |
| Payback day | нет (стоп UA) | **~D100–110** | ~D28 |

**Главная строка: база — LTV(180) $3.12 при CPI $2.30 → LTV/CPI = 1.36, окупаемость UA ~D100–110.**

Решающие правила soft launch (гейты Прохода Г, [10-production.md](10-production.md)):

- **Go global:** D1 ≥ 40%, D7 ≥ 16%, ARPDAU ≥ $0.17, ROAS D30 ≥ 45% → масштабируем UA.
- **Iterate:** D7 12–16% или ARPDAU $0.12–0.17 → 2–3 балансных цикла, ре-тест.
- **Kill/pivot:** D7 < 12% при ARPDAU < $0.12 после 3 циклов → пессимистический сценарий подтверждён, проект не масштабируется (потери ограничены бюджетом Прохода Г).

Чувствительность базы: ±2 п.п. D7 → LTV(180) ≈ ±$0.6 (D7 16% → $2.55; D7 20% → $3.78); ±$1 eCPM rewarded → ad ARPDAU ±$0.004 (±$0.06 LTV); ±0.5 п.п. конверсии в плательщика → IAP ARPDAU ±$0.016 (±$0.23 LTV); CPI +30% ($2.30 → $3.00, риск из [02-market.md](02-market.md) п. 2.4) при базовых LTV → LTV/CPI 1.04, payback ~D165–170 — UA сужается до лучших кампаний, но модель не ломается. Ретеншен — самый тяжёлый рычаг: приоритет A/B — удержание, потом монетизация.

## 9.6. План A/B-тестов на первые 6 месяцев

Мощность: при 3 000 новых установок/день в soft launch когорта теста ~10 тыс./арм за 2 недели — достаточно для детекции ±1,5 п.п. D7. Не более 3 параллельных непересекающихся тестов.

| # | Мес | Тест | Армы | Первичная метрика | Гардрейл |
|---|---|---|---|---|---|
| 1 | 1 | Старт interstitial | уровень 12+день 2 / уровень 8+день 1 / уровень 16+день 3 | Ad ARPDAU D14 | D1, D7 ≥ −1 п.п. |
| 2 | 1 | Длина FTUE | 3 обучающих уровня / 5 | FTUE-completion, D1 | время до 1-го RW |
| 3 | 1 | Пре-промпт ATT | сразу после ур.5 / день 2 / без пре-промпта | opt-in rate | D1 |
| 4 | 2 | Наклон взноса E(n) | 1.010 / **1.012** / 1.015 | ARPDAU D30 | D14 retention |
| 5 | 2 | Грант Кошелька RW6 | 0.6·E / **0.8·E** / 1.0·E | RW6-показы/DAU, IAP-конверсия | sink/source ≤ 1.2 |
| 6 | 2 | Starter pack цена | $1.99 / **$2.99** / $4.99 | Выручка на установку D21 | конверсия в 1-й платёж |
| 7 | 3 | INT-капы | 6/день / **8**/день / 10/день | Ad ARPDAU D30 | D7, отток D14 |
| 8 | 3 | Кривая WR плато | 0.52 / **0.55** / 0.58 | D14, уровней/DAU | RW1-показы (не обвалить) |
| 9 | 3 | Сценки: длина | 15–20 с / 8–10 с | Досмотр, D7-uplift ([04-meta-progression.md](04-meta-progression.md) п. 4.9) | — |
| 10 | 4 | Второй спин колеса | rewarded / бесплатно | утренние RW-показы, D7 | — |
| 11 | 4 | Цена подписки | $5.99 / **$7.99** / $9.99 | LTV подписчика D60 | конверсия в триал |
| 12 | 5 | Порог «камней» | каждый 10-й / каждый 8-й | IAP+RW на камнях | чёрн на камнях |
| 13 | 5 | Пуш-тексты (мир vs система) | «Лаванда расцвела» / «Вернись за наградой» | CTR, D7 повторный | opt-out rate |
| 14 | 6 | Медиация | MAX / AdMob-медиация (10% Android) | Ad ARPDAU | latency, ANR |
| 15 | 6 | Win-back грант | 3·E / 5·E / без гранта | возврат D7+, LTV вернувшихся | инфляция |

Дисциплина: тест ≥ 14 дней, решение по первичной метрике при p < 0.05, гардрейлы блокируют выкатку при деградации. Реестр тестов и решений — обязательный артефакт (см. DoD Прохода Г в [10-production.md](10-production.md)).

## 9.7. Дашборды (минимальный набор к soft launch)

1. **Ежедневный борд:** DAU, установки, D1/D7/D30 по когортам, ARPDAU (ad/IAP/blended), показы по плейсментам, eCPM по сетям (ILRD).
2. **Экономика:** sink/source по `coins_delta.source_id`, медианный баланс во взносах, доля уровней с бустером ([05-economy.md](05-economy.md) п. 5.8).
3. **Баланс сложности:** фактический WR по уровням против целевой кривой, топ-20 уровней по чёрну (последний сыгранный перед уходом).
4. **Воронки:** FTUE, реклама, IAP (п. 9.2) с недельными срезами.
5. **LiveOps:** вовлечённость ивентов, CTR пушей по триггерам, стрик-распределение.
