# 08 — Оставшаяся кодовая работа (с псевдокодом)

Пакет Go-to-Market, документ 8 из 8. Соседи: [01-legal-foundation.md](01-legal-foundation.md), [02-accounts-and-services.md](02-accounts-and-services.md), [03-art-and-assets.md](03-art-and-assets.md), [04-monetization-golive.md](04-monetization-golive.md), [05-build-sign-release.md](05-build-sign-release.md), [06-softlaunch-and-ua.md](06-softlaunch-and-ua.md), [07-liveops-support-growth.md](07-liveops-support-growth.md).

**Легенда тегов:** `[НЕ-КОД]` — браузер/дашборды; `[КОД]` — правки в репозитории; `[ДЕНЬГИ]` — шаг стоит денег; `[ЮРИСТ]` — нужен профильный специалист.
**Все цены — порядки величин на середину 2026 г., перед действием проверять на сайте сервиса.** Автор — не юрист и не налоговый советник.

Здесь собраны ВСЕ кодовые задачи, которые остались между текущим состоянием (три прод-приложения на TypeScript + Phaser 3 + Vite + Capacitor, 516 автотестов, монетизация как симуляция за интерфейсами) и живым продуктом. Каждая задача: что делать, псевдокод, оценка сложности (S — до 2 дней, M — до недели, L — 1–3 недели), когда она нужна. Порядок этапов = рекомендуемый порядок выполнения для Block Surge (первый запуск); для двух остальных игр код переносится почти 1:1 — интерфейсы одинаковые во всех трёх `app/`.

Честно: этапы 1–4 нельзя полноценно проверить без реальных аккаунтов ([02-accounts-and-services.md](02-accounts-and-services.md)) и нативных сборок ([05-build-sign-release.md](05-build-sign-release.md)), а iOS-часть — без Mac. Пишите код заранее можно, тестировать — только на устройстве.

---

## Этап 1. MaxAdProvider — реальная реклама за существующим интерфейсом [КОД]

**Что:** реализовать `AdProvider` (контракт: `../block-puzzle/app/src/ads/provider.ts`) поверх Capacitor-плагина AppLovin MAX, заменив скелет `../block-puzzle/app/src/ads/maxProvider.stub.ts`. Вызывающий код не меняется — `MonetizeController` (`../block-puzzle/app/src/monetize/monetize.ts`) говорит только с интерфейсом, выбор реализации делает фабрика `../block-puzzle/app/src/ads/index.ts`.

**Зачем:** это единственное место, где симуляция превращается в деньги. Карта плейсментов и капы — в книге `../block-puzzle/06-monetization.md` (§2–3), выбор MAX как медиатора — там же §8.

- **Сложность:** M (3–5 дней на первую игру, включая тесты на устройствах; на 2-ю и 3-ю — по дню).
- **Стоимость:** 0 € за код; AppLovin бесплатен (берёт долю с аукциона). Тестовые устройства: минимум один Android-телефон; для iOS — Mac + устройство (см. [05-build-sign-release.md](05-build-sign-release.md)).
- **Вход:** аккаунт AppLovin + SDK key + ad unit id (rewarded/interstitial/banner × iOS/Android) — шаги в [02-accounts-and-services.md](02-accounts-and-services.md); нативные проекты (`npx cap add android/ios`).
- **Выход:** прод-сборка показывает реальную рекламу; `onImpression` отдаёт impression-level выручку в аналитику (глава `../block-puzzle/09-analytics-kpi.md` §5).
- **Грабли:** (а) MAX-плагин для Capacitor — по сути Cordova-плагин, проверяйте совместимость версий; fallback — AdMob Mediation (план Б из книги 06 §8); (б) вызов `init()` ДО consent-флоу (этап 3) режет eCPM и нарушает GDPR; (в) rewarded «closed without reward» надо отличать от «no-fill» — иначе игроки будут терять награды; (г) в WebView баннер может перекрывать safe-area — тестировать на устройстве с «чёлкой».

### 1.1 Псевдокод класса

```
class MaxAdProvider implements AdProvider:
    onImpression: (AdImpression -> void) | null
    rewardedRetry = 0; interRetry = 0          # экспоненциальный backoff
    RETRY_CAP_S = 64
    SHOW_TIMEOUT_MS = 120000                    # страховка от зависшего колбэка;
                                                # ролик идёт 30–60 c — тот же таймаут в 04 §3.2

    async init():
        # Вызывается ТОЛЬКО после consent-флоу (этап 3)!
        await AppLovinMAX.initialize(SDK_KEY)   # ключ из env сборки, не из кода
        AppLovinMAX.setHasUserConsent(consent.gdprGranted)
        AppLovinMAX.setDoNotSell(consent.ccpaOptOut)     # для US-стейтов
        subscribe('OnAdRevenuePaid', ev ->
            this.onImpression?({ format: mapFormat(ev), placement: currentPlacement,
                                 revenueUsd: ev.revenue, ecpmUsd: ev.revenue * 1000 }))
        subscribe('OnRewardedAdLoadFailed',  -> scheduleRetry('rw'))
        subscribe('OnInterstitialLoadFailed', -> scheduleRetry('int'))
        loadRewarded(); loadInterstitial()      # прелоад сразу после init

    scheduleRetry(kind):
        retry[kind] += 1
        delay = min(2 ^ retry[kind], RETRY_CAP_S)
        setTimeout(-> load(kind), delay * 1000)

    isRewardedReady(placement): return AppLovinMAX.isRewardedAdReady(RW_UNIT_ID)

    async showRewarded(placement): RewardedResult
        if not isRewardedReady(placement): return { completed: false, revenueUsd: 0 }
        currentPlacement = placement
        return await withTimeout(SHOW_TIMEOUT_MS, new Promise(resolve ->
            gotReward = false; revenue = 0
            once('OnRewardedAdReceivedReward', -> gotReward = true)
            once('OnAdRevenuePaid',           ev -> revenue = ev.revenue)
            once('OnRewardedAdHidden', ->      # закрыт: досмотрен или нет
                loadRewarded()                  # сразу прелоад следующего
                resolve({ completed: gotReward, revenueUsd: revenue }))
            once('OnRewardedAdFailedToDisplay', ->
                resolve({ completed: false, revenueUsd: 0 }))
            AppLovinMAX.showRewardedAd(RW_UNIT_ID, placement)))
        # таймаут -> { completed: false, revenueUsd: 0 } + лог в аналитику

    async showInterstitial(placement): InterstitialResult   # симметрично rewarded
    showBanner(): AppLovinMAX.createBanner(BAN_UNIT_ID, 'bottom_center'); showBanner()
    hideBanner(): AppLovinMAX.hideBanner(BAN_UNIT_ID)
```

### 1.2 Подшаги

1. **[КОД]** Установить плагин, прописать ad unit id в `.env` сборки; в фабрике `src/ads/index.ts` заменить импорт скелета на реальный класс — выбор реализации уже сделан по env-флагу `VITE_AD_PROVIDER` (`max` → MaxAdProvider, иначе SimAdProvider; прод-сборка: `VITE_AD_PROVIDER=max`, см. [04-monetization-golive.md](04-monetization-golive.md) этап 3.3). Симулятор остаётся для веба и тестов — не удалять.
2. **[КОД]** Реализовать класс по псевдокоду 1.1; юнит-тесты на обёртку (эмуляция колбэков), таймаут и backoff — Vitest, без SDK.
3. **[КОД][ДЕНЬГИ]** На устройстве включить Mediation Debugger MAX (`AppLovinMAX.showMediationDebugger()`), проверить fill всех сетей v1 (AppLovin Exchange, AdMob, Mintegral, Unity, Liftoff). Полдня на прокликивание. Тест-режим сетей включается в дашборде MAX — «проверить на сайте», интерфейс меняется.

---

## Этап 2. RevenueCatPurchaseProvider — покупки и подписка [КОД]

**Что:** реализовать `PurchaseProvider` (контракт: `../block-puzzle/app/src/monetize/purchase.ts`; в WordGrove тот же файл в `../word-game/app/src/monetize/purchase.ts` плюс подписка Club из книги `../word-game/06-monetization.md`) поверх RevenueCat (`@revenuecat/purchases-capacitor`).

**Зачем:** RevenueCat закрывает серверную валидацию чеков (в контракте прямо написано: чек валидируется сервером до выдачи товара), restore, подписочный статус и вебхуки — без своего бэкенда. Для соло-разработчика это дешевле собственного сервера валидации.

- **Сложность:** M (2–4 дня; подписка WordGrove — самая сложная часть).
- **Стоимость:** RevenueCat бесплатен примерно до $2.5k MTR/мес, дальше ~1% с выручки — проверить актуальный прайсинг на сайте. Комиссии сторов (15–30%) — см. [04-monetization-golive.md](04-monetization-golive.md).
- **Вход:** продукты, заведённые в App Store Connect / Play Console (SKU-полка из `../block-puzzle/app/src/monetize/config.ts` и книги 06 §5), проект RevenueCat с API-ключами ([02-accounts-and-services.md](02-accounts-and-services.md)).
- **Выход:** рабочие покупки в сборках, подписочный статус Club для WordGrove, восстановление покупок (требование Apple — без кнопки Restore ревью не пройти).
- **Грабли:** (а) SKU id в коде, RevenueCat и сторах должны совпадать до символа; (б) sandbox-тестеры Apple живут отдельной жизнью (подписки ускорены), не путать с продом; (в) выдача товара — ТОЛЬКО по `customerInfo`, не по «Promise без ошибки»; (г) `ok:false`, а не `reject` при отмене — контракт `purchase.ts` этого требует, иначе UI покажет ошибку на обычную отмену.

### 2.1 Псевдокод

```
class RevenueCatPurchaseProvider implements PurchaseProvider:
    async init():
        Purchases.configure({ apiKey: platformKey(), appUserID: null })  # анонимный id
        info = await Purchases.getCustomerInfo()      # тихий restore на старте
        applyEntitlements(info)                       # noAds, club и т.п.

    async buy(skuId): PurchaseResult
        sku = findSku(skuId); if not sku: return { ok:false, skuId, priceUsd:0 }
        try:
            offerings = await Purchases.getOfferings()
            pkg = offerings.current.availablePackages.find(p -> p.identifier == skuId)
            if not pkg: return { ok:false, skuId, priceUsd:0 }
            { customerInfo } = await Purchases.purchasePackage(pkg)
            granted = customerInfo.entitlements.active  # источник истины
            return { ok: entitlementFor(skuId) in granted or isConsumable(skuId),
                     skuId, priceUsd: pkg.product.price }
        catch e:
            if e.userCancelled: return { ok:false, skuId, priceUsd:0 }   # не ошибка
            log('purchase_error', e); return { ok:false, skuId, priceUsd:0 }

    async restore(): applyEntitlements(await Purchases.restorePurchases())
        # НОВЫЙ метод: в контракте purchase.ts его пока нет — добавить в PurchaseProvider
        # (+no-op в SimPurchaseProvider), кнопка в ShopUi; см. 04 §5.3

    # WordGrove Club: подписочный статус + акции
    isClubActive(info): return 'club' in info.entitlements.active
    async showWinbackOffer():                          # промо-цена для отвалившихся
        offerings = await Purchases.getOfferings()
        return offerings.all['club_winback']?.availablePackages[0]  # оффер из дашборда RC
```

### 2.2 Подшаги

1. **[КОД]** Реализация + фабрика по env-флагу `VITE_PURCHASE_PROVIDER` — зеркально рекламной фабрике `src/ads/index.ts` (см. [04-monetization-golive.md](04-monetization-golive.md) этап 5.3); `SimPurchaseProvider` остаётся для веба/тестов.
2. **[КОД]** Кнопка «Восстановить покупки» в `../block-puzzle/app/src/ui/ShopUi.ts` (и в аналогичных ShopUi двух других игр) — вызывает `restore()`; требование ревью Apple.
3. **[КОД]** WordGrove: слушатель `Purchases.addCustomerInfoUpdateListener` → пересчёт статуса Club при продлении/отмене; win-back-оффер по главе `../word-game/08-liveops.md`.
4. **[НЕ-КОД][ДЕНЬГИ]** Sandbox-прогон: покупка, отмена, restore, возврат средств — на обеих платформах. День минимум, без спешки.

---

## Этап 3. Boot-последовательность консентов: UMP → ATT → SDK init [КОД][ЮРИСТ]

**Что:** код старта приложения, который в правильном порядке собирает согласия и только потом инициализирует SDK. Порядок жёсткий: сначала GDPR-консент (Google UMP через `@capacitor-community/admob` или UMP внутри MAX SDK), затем ATT-диалог iOS, затем `MaxAdProvider.init()` → `RevenueCatPurchaseProvider.init()` → Firebase.

**Зачем:** юридическое требование GDPR/DSGVO (вы, вероятно, в Германии — это ваш основной регулятор, см. [01-legal-foundation.md](01-legal-foundation.md)) и требование Apple (ATT). Неправильный порядок = либо нарушение, либо срезанный eCPM (сети без консента отдают неперсонализированную рекламу).

- **Сложность:** S–M (2–3 дня с тестами на устройствах).
- **Стоимость:** 0 €. Но текст privacy-диалогов должен согласовываться с Privacy Policy — это [ЮРИСТ], см. [01-legal-foundation.md](01-legal-foundation.md); формулировки не выдумывать самому.
- **Вход:** Privacy Policy URL (юр-пакет), настроенный UMP-message в консоли AdMob/MAX («проверить на сайте» — интерфейсы консент-консолей меняются часто).
- **Выход:** детерминированный boot-флоу, одинаковый для всех трёх игр (вынести в общий модуль `src/boot/consent.ts` в каждом `app/`).
- **Грабли:** (а) ATT-диалог показывается системой ОДИН раз за установку — если вызвать его в неудачный момент, второго шанса нет (тайминг из [04-monetization-golive.md](04-monetization-golive.md) §4.2 по книге `../block-puzzle/07-ux-ui-ftue.md`: после первой победы FTUE, сразу после UMP-формы, с пре-промптом); (б) UMP-форму надо уметь показывать повторно из настроек («Отозвать согласие» — требование GDPR); (в) не блокировать игру, если консент-сервер недоступен: играть можно, реклама — нет.

```
async function bootSequence():
    await game.mountUi()                       # FTUE шаг 1: игра доступна сразу, диалогов на старте нет

    # 1. Гейт: первая победа (ftue_step >= 4) ИЛИ уже сохранённое согласие — тайминг 04 §4.2
    await firstOf(store.hasConsentDecision, ftue.step4Reached)

    # 2. GDPR / UMP (только регионы, где требуется — UMP сам решает)
    ump = await UMP.requestConsentInfoUpdate()
    if ump.formAvailable and ump.status == REQUIRED:
        await UMP.showConsentForm()            # блокирующий диалог
    consent.gdprGranted = ump.canRequestAds()

    # 3. ATT (только iOS 14.5+) — сразу после UMP-формы, ДО init MAX
    if platform == iOS and attStatus() == notDetermined:
        showPrePrompt()                        # свой экран «зачем нам это»
        consent.attGranted = (await requestATT()) == authorized

    # 4. SDK строго после консентов
    await adProvider.init()                    # этап 1
    await purchaseProvider.init()              # этап 2
    await analytics.init(consent)              # этап 4 (Firebase уважает consent mode)

    # 5. Настройки: пункт «Конфиденциальность» -> UMP.showPrivacyOptionsForm()
```

---

## Этап 4. FirebaseAnalyticsAdapter — маппинг событий [КОД]

**Что:** адаптер, транслирующий наши внутренние события (класс `Analytics` в `../block-puzzle/app/src/economy/analytics.ts`, аналоги в двух других играх; схема событий — глава `../block-puzzle/09-analytics-kpi.md` §2) в Firebase Analytics через `@capacitor-firebase/analytics`.

**Зачем:** дашборд KPI в приложении считает всё локально; для когорт, воронок и аудиторий пушей (этап 9) нужна серверная аналитика. Firebase — бесплатный базовый слой; AppsFlyer добавляется позже для атрибуции UA ([06-softlaunch-and-ua.md](06-softlaunch-and-ua.md)).

- **Сложность:** S (1–2 дня): интерфейс шины событий уже есть, пишется один класс-подписчик.
- **Стоимость:** Firebase Spark — 0 €; лимиты (500 типов событий, 25 параметров) хватает с запасом.
- **Вход:** Firebase-проект + `google-services.json` / `GoogleService-Info.plist` ([02-accounts-and-services.md](02-accounts-and-services.md)).
- **Выход:** события `level_complete`, `ad_impression`, `iap_completed`, `session_start`… (имена дерева 09 §2) видны в DebugView в течение часа.
- **Грабли:** (а) имена: только `[a-z0-9_]`, до 40 символов — наше дерево 09 §2 уже snake_case, но параметры вроде `ecpmUsd` привести к `ecpm_usd`; (б) выручку слать как `value` + `currency:'USD'`, иначе не попадёт в revenue-отчёты; (в) не дублировать стандартное `in_app_purchase` — Firebase сам его собирает, наши `iap_initiated`/`iap_completed`/`iap_failed` (09 §2.3) оставить своими именами, а источник IAP-выручки выбрать один — RevenueCat-интеграция ([04-monetization-golive.md](04-monetization-golive.md) этап 6.2); (г) DebugView требует `adb shell setprop debug.firebase.analytics.app <pkg>` — забывают все.

```
# Сток поверх существующего трекера (class Analytics, track(event, params)) —
# та же схема, что FirebaseAnalyticsSink в 04 §6.2; дерево 09 §2 не меняется.
class FirebaseAnalyticsAdapter extends Analytics:
    async init(consent):
        await FirebaseAnalytics.setEnabled({ enabled: consent.analyticsGranted })
        await FirebaseAnalytics.setUserProperty({ key:'ab_bucket', value: experiments.bucket })

    override track(event, params):
        super.track(event, params)              # in-memory тэлли для KPI-дашборда живёт
        p = sanitize(params)                    # camelCase->snake_case, обрезка строк до 100
        if p.revenue_usd: p += { value: p.revenue_usd, currency: 'USD' }
        FirebaseAnalytics.logEvent({ name: clamp40(event), params: p })  # fire-and-forget, без await в кадре
```

---

## Этап 5. Контент-масштабирование [КОД]

Нужно ДО soft launch выбранной игры: контента должно хватать на D30-игрока (глава `10-production.md` каждой книги).

### 5.1 WordGrove: 200+ уровней EN/RU с курацией

**Что:** batch-прогон генератора уровней (кроссворд-раскладка: `../word-game/app/src/core/grid.ts`, валидация: `../word-game/app/src/core/validate.ts`, текущие уровни: `../word-game/app/src/core/levels.ts` / `levelsEn.ts`) на 200+ уровней на язык + ручная курация. Алгоритмы — книга `../word-game/11-algorithms.md`.

- **Сложность:** M–L (генерация — 2–3 дня кода; курация — реально 3–7 дней глазами: словари содержат мусор и обсценную лексику, авто-фильтр ловит не всё).
- **Вход:** частотные словари EN/RU (открытые списки; лицензию словаря проверить — [ЮРИСТ] по касательной). **Выход:** `levels.ts`/`levelsEn.ts` по 200+ записей + отчёт кривой сложности.
- **Грабли:** кривая сложности не может быть монотонной по длине слов — нужна метрика (частотность худшего слова уровня); RU-словоформы (генератор не должен давать «КОТ/КОТА» в одном уровне — фильтр лемм).

```
pipeline generateBatch(locale, count=250):
    dict = loadFrequencyDict(locale).filter(w -> 3 <= len(w) <= 8)
                                    .filter(not profanity).filter(not properNoun)
    levels = []
    for difficulty in curve(count):             # целевая сложность на индекс уровня
        for attempt in 1..MAX_TRIES:
            base = pickBaseWords(dict, difficulty)   # 4-7 слов из общего пула букв
            grid = layoutCrossword(base)             # core/grid.ts
            if not grid: continue
            if not validate(grid, dict): continue    # core/validate.ts: все пересечения — слова
            score = qualityScore(grid)               # бонусные слова, редкость, компактность
            if score >= threshold(difficulty): levels.push(toLevelData(grid)); break
    emitReport(levels)                               # csv: №, слова, метрики -> ручная курация
    # Курация: пометки keep/drop/edit в csv -> скрипт собирает финальный levels.ts
```

### 5.2 Orchard Peaks: зоны сада 5–12

**Что:** данные зон декларативны — `ZONES` в `../solitaire-meta/app/src/meta/config.ts` (интерфейс `ZoneDef`: `id/name/emoji/scene/orders[]`, `startIndex/endIndex` считаются автоматически). Добавление зоны = добавление объекта в массив, код меты (`meta.ts`) не трогается.

- **Сложность:** S–M (2–3 дня): код тривиален, время уходит на балансировку `costH/costC/rc` по экономике `../solitaire-meta/12-economy-sim.md` и главе `05-economy.md`.
- **Выход:** 8 новых зон (~32 заказа), прогон детерминированного симулятора (`../solitaire-meta/app/src/sim/`) подтверждает: D30-игрок не упирается в стену и не проскакивает сад.
- **Грабли:** `zoneCompleteBonus(zoneIdx) = 1000 + 500*zoneIdx` — при 12 зонах поздние бонусы раздувают экономику, пересчитать формулу в симуляторе ДО ввода данных.

```
ZONES.push({ id:'greenhouse', name:'Теплица', emoji:'🌿',
    scene:'Стеклянная теплица за домом',
    orders: [ { title:'Вставить стёкла', costH: 2400, costC: 800, rc: 3200, decor:'🪟' },
              ... ],                     # costH растёт ~×1.35 к зоне (проверить симом!)
    startIndex: 0, endIndex: 0 })        # пересчитаются в buildFlatOrders()
```

### 5.3 Block Surge: «Фигурные поля» в прод

**Что:** режим с масками поля (в `../block-puzzle/app/src/core/board.ts` прямо помечено: «маски 9×9 — вне Прохода А»). Форма поля генерируется детерминированно по дате — та же схема, что daily-контент в `../solitaire-meta/app/src/meta/dates.ts`.

- **Сложность:** M (3–4 дня): board уже абстрагирован, но solver (`core/solver.ts`) и генератор фигур (`core/bag.ts`) должны уважать маску, иначе daily будет непроходимым.
- **Выход:** режим в меню + вкладка в календаре, тесты на проходимость (solver прогоняет N симуляций на каждую сгенерированную маску).

```
function shapedFieldFor(dateISO): Mask9x9
    rng = seededRng(hash('shaped:' + dateISO))       # core/rng.ts — уже детерминированный
    template = TEMPLATES[rng.int(TEMPLATES.length)]  # крест/ромб/рамка/песочные часы...
    mask = applySymmetricNoise(template, rng, cells=rng.int(0..6))  # зеркально, чтобы красиво
    for attempt in 1..20:
        if solverWinRate(mask, sims=200) in [0.25 .. 0.85]: return mask  # играбельно
        mask = relax(mask, rng)                       # открыть 1-2 клетки
    return template                                   # fallback: чистый шаблон
```

---

## Этап 6. Ивент-режимы (опционально, ПОСЛЕ global) [КОД]

Оба режима — из глав `08-liveops.md` соответствующих книг. Не делать до global-запуска: сначала подтвердить retention базового цикла.

### 6.1 WordGrove: «Буквопад» (TetriCross)

Падающие фигуры из букв; приземлившиеся буквы образуют слова по горизонтали/вертикали — слова сгорают, начисляются очки. Сложность: **L** (1–2 недели: новый игровой цикл + баланс).

```
loop tick(dt):
    piece.y += fallSpeed(level) * dt
    if collides(piece, well): lockPiece()
        words = scanWords(well, dict)             # переиспользовать core/validate.ts + словарь 5.1
        for w in words: burn(w); score += value(w); coins += coinValue(w)   # экономика: econ.ts
        collapseColumns(well)
        if wellOverflow(): endRun()
        piece = nextPiece(bag)                    # мешок букв, взвешенный частотностью языка
    input: left/right/rotate/softDrop
# Награды: конверсия очков ивента в валюту меты через ту же формулу, что levelEnd
# (economy/econ.ts) — отдельной валюты НЕ вводить, иначе развалится симулятор 12-economy-sim.md
```

### 6.2 Block Surge: «Лабиринт удачи»

Ежедневный лабиринт: путь из комнат-наград, генерируется DFS по дате. Сложность: **M** (3–5 дней).

```
function mazeFor(dateISO): Maze
    rng = seededRng(hash('maze:' + dateISO))
    grid = emptyGrid(5, 7); stack = [start]
    while stack:                                   # классический DFS-карвер
        cur = stack.top(); next = randomUnvisitedNeighbor(cur, rng)
        if next: removeWall(cur, next); stack.push(next) else stack.pop()
    rooms = pickRewardRooms(grid, rng, count=8)    # награды по таблице 08-liveops §ивенты
    placeKeys(grid, rng, keysPerDay=3)             # ключи = за уровни; доп.ключ = rewarded RW-4
    return maze
# Расписание: активен пт-вс, ротация наград по неделе года — по образцу meta/dates.ts
```

---

## Этап 7. Cloud saves — когда и зачем [КОД][ДЕНЬГИ]

**Когда:** НЕ до soft launch. Локальные сейвы (`../block-puzzle/app/src/monetize/save.ts` и `core/save.ts` в других играх) для старта достаточны. Делать, когда появится причина: подписка Club в WordGrove (платящий игрок, потерявший прогресс при смене телефона, — это refund и единица в отзывах) или заметная доля D30+.

**Вариант А — Play Games Saved Games + iCloud/GameCenter:** 0 € инфраструктуры, ~M (неделя на обе платформы через Capacitor-плагины). Минусы: нет кросс-платформенного переноса Android↔iOS, у iCloud key-value лимиты (1 МБ), отладка мучительная.

**Вариант Б — свой бэкенд (Firebase Firestore или VPS):** кросс-платформенно, но появляется аккаунт-система (= консент, удаление данных по GDPR — снова [ЮРИСТ], [01-legal-foundation.md](01-legal-foundation.md)) и постоянные расходы: Firestore при ваших объёмах ~0–25 $/мес, VPS ~5–10 €/мес + ваше время на поддержку. Трезво: для соло-разработчика — вариант А сейчас, вариант Б только вместе с подписочной аудиторией WordGrove.

```
# Общий слой поверх обоих вариантов:
interface CloudSaveProvider { load(): Save|null; store(s: Save): void }
onConflict(local, remote):
    winner = max_by(progressScore)               # НЕ по timestamp: часы врут
    if ties: prefer(remote if remote.iapCount > local.iapCount else local)
    showDialogIfClose(local, remote)             # игрок решает при спорных случаях
```

---

## Этап 8. Code splitting: Phaser в отдельный чанк [КОД]

**Что:** Phaser 3 (~1.1 МБ min) сейчас едет в общем бандле. Вынести в отдельный чанк через `manualChunks` в `vite.config.ts` каждой игры (`../block-puzzle/app/vite.config.ts` и аналоги).

**Зачем:** быстрее первый кадр в WebView (сплэш → меню), кэш чанка переживает патчи геймкода при OTA-обновлениях веб-слоя. Сложность: **S** (0.5–1 день на все три игры + проверка, что Vitest и `npm run build` не сломались).

```
// vite.config.ts
build: { rollupOptions: { output: { manualChunks: (id) =>
    id.includes('node_modules/phaser') ? 'phaser'
  : id.includes('/src/core/') || id.includes('/src/sim/') ? 'engine'   # чистое ядро отдельно
  : undefined } } }
// Проверка: dist/assets/phaser-*.js существует; index-чанк < 300 KB
```

**Грабли:** динамический `import('phaser')` (ленивая загрузка) в Capacitor почти не даёт выигрыша — файлы локальные; `manualChunks` достаточно, не усложнять.

---

## Этап 9. Push-уведомления — FCM/APNs через Capacitor [КОД]

**Что:** `@capacitor/push-notifications` (удалённые, FCM/APNs) + `@capacitor/local-notifications` (локальные — их хватит для 80% сценариев из глав `08-liveops.md`: «жизни восстановились», «daily ждёт», «стрик сгорает»).

**Зачем:** ретеншен-канал D1/D7. Что и когда слать — таблицы пушей в `08-liveops.md` каждой книги; частота — не больше 1/день, иначе отписки.

- **Сложность:** S–M (2–4 дня: локальные — день, FCM/APNs-обвязка и ключи — остальное).
- **Стоимость:** FCM бесплатен; APNs входит в Apple Developer Program (99 $/год — уже учтён в [02-accounts-and-services.md](02-accounts-and-services.md)). APNs-ключ (.p8) загружается в Firebase — только с Mac ключ не нужен, но сборка iOS — нужен.
- **Грабли:** (а) Android 13+ — runtime-разрешение на пуши, запрашивать в контексте («включить напоминание о стрике?»), не на первом запуске; (б) iOS-разрешение — одноразовое, как ATT: пре-промпт обязателен; (в) локальные пуши надо ПЕРЕпланировать при каждом сворачивании — состояние жизней меняется.

```
async initPush():
    if await LocalNotifications.checkPermissions() != granted:
        deferUntil('meaningful_moment', requestWithPrePrompt)
    PushNotifications.addListener('registration', t -> analytics.setUserProperty('fcm', t.value))
    PushNotifications.register()                  # токен -> Firebase, аудитории — из этапа 4

onAppPause():                                     # локальные пуши по состоянию игры
    LocalNotifications.cancelAll()
    if lives < MAX: schedule(at = liveRefillTime(), text = t('push.lives'))       # i18n-ключи!
    if dailyNotDone: schedule(at = today(19, 00, localTz), text = t('push.daily'))
    if streak > 2:  schedule(at = tomorrow(20, 00), text = t('push.streak', streak))
```

---

## Этап 10. Сводная таблица приоритетов

| # | Задача | Когда нужна | Сложность | Блокеры вне кода |
|---|--------|-------------|-----------|------------------|
| 1 | MaxAdProvider (этап 1) | до soft launch | M | аккаунт AppLovin, устройство, для iOS — Mac |
| 2 | Boot-консенты UMP→ATT (этап 3) | до soft launch (вместе с 1) | S–M | Privacy Policy [ЮРИСТ] |
| 3 | FirebaseAnalyticsAdapter (этап 4) | до soft launch | S | Firebase-проект |
| 4 | RevenueCatPurchaseProvider (этап 2) | до soft launch (WordGrove — обязательно; Block Surge может стартовать ads-only) | M | продукты в сторах, RevenueCat |
| 5 | Контент: зоны 5–12 Orchard (5.2) | до soft launch Orchard Peaks | S–M | — |
| 6 | Контент: 200+ уровней WordGrove (5.1) | до soft launch WordGrove | M–L | словари, дни курации |
| 7 | Фигурные поля Block Surge (5.3) | до global Block Surge (soft launch — без них) | M | — |
| 8 | Code splitting Phaser (этап 8) | до soft launch (дёшево, делайте сразу) | S | — |
| 9 | Push-уведомления (этап 9) | до global (soft launch меряет базовый retention без костылей) | S–M | APNs-ключ |
| 10 | Cloud saves (этап 7) | после global; для WordGrove Club — раньше | M–L | GDPR-решения [ЮРИСТ] при варианте Б |
| 11 | «Лабиринт удачи» (6.2) | после global | M | — |
| 12 | «Буквопад» (6.1) | после global | L | — |

Итого критический путь по коду до soft launch Block Surge: этапы 1 + 3 + 4 + 8 ≈ 1.5–2.5 недели чистой работы одного разработчика — ПОСЛЕ того, как закрыты аккаунты ([02-accounts-and-services.md](02-accounts-and-services.md)), юр-минимум ([01-legal-foundation.md](01-legal-foundation.md)) и первая нативная сборка ([05-build-sign-release.md](05-build-sign-release.md)). Оценки — на устройстве без сюрпризов; закладывайте ×1.5 на первую интеграцию каждого SDK: сюрпризы будут.
