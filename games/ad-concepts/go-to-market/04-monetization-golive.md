# Go-to-Market · 04 — Включение реальной монетизации

От симуляции к живым деньгам: замена SimAdProvider/SimPurchaseProvider на AppLovin MAX и RevenueCat,
подключение Firebase и AppsFlyer, тест-контур и первые выплаты. Первая игра — **Block Surge** (`../block-puzzle/`),
затем тот же плейбук повторяется для Orchard Peaks (`../solitaire-meta/`) и WordGrove (`../word-game/`).

**Пререквизиты (без них не начинать):**
- [01-legal-foundation.md](01-legal-foundation.md) — форма деятельности, налоговые данные, Privacy Policy URL. Без Privacy Policy нельзя включать ни CMP, ни сторы.
- [02-accounts-and-services.md](02-accounts-and-services.md) — аккаунты Apple/Google/AppLovin/AdMob/Firebase/RevenueCat/AppsFlyer, домены (playblocksurge.com и др.), банк и налоговые формы в сторах.
- [03-art-and-assets.md](03-art-and-assets.md) — арт и стор-ассеты (идут параллельно; кодовые этапы ниже их не ждут, но к сабмиту карточек они обязательны).
- Нативные iOS/Android-проекты сгенерированы, приложение собирается и ставится на устройство — процедура в [05-build-sign-release.md](05-build-sign-release.md) (этапы 1–2; полный релизный проход 05 — сабмит, ревью, rollout — выполняется после этого документа). **Для iOS-части нужен Mac** — без него этапы 2–8 выполняются только для Android.

**Что уже готово в репо (этот документ опирается на это):**
- Контракт рекламы: [../block-puzzle/app/src/ads/provider.ts](../block-puzzle/app/src/ads/provider.ts) (AdProvider, RewardedResult, AdImpression), скелет прод-провайдера: [../block-puzzle/app/src/ads/maxProvider.stub.ts](../block-puzzle/app/src/ads/maxProvider.stub.ts), фабрика по флагу `VITE_AD_PROVIDER`: [../block-puzzle/app/src/ads/index.ts](../block-puzzle/app/src/ads/index.ts). Аналогично в `../solitaire-meta/app/` и `../word-game/app/`.
- Контракт покупок: [../block-puzzle/app/src/monetize/purchase.ts](../block-puzzle/app/src/monetize/purchase.ts) (PurchaseProvider, SimPurchaseProvider), полки SKU: `app/src/monetize/config.ts` каждой игры.
- Дерево событий аналитики: [../block-puzzle/09-analytics-kpi.md](../block-puzzle/09-analytics-kpi.md) §2, in-app трекер: [../block-puzzle/app/src/economy/analytics.ts](../block-puzzle/app/src/economy/analytics.ts).
- Bundle ID: `com.surgegames.blocksurge` / `com.surgegames.orchardpeaks` / `com.surgegames.wordgrove` (`app/capacitor.config.ts`).
- Схемы монетизации: `06-monetization.md` каждой книги (Block Surge: полка §5, медиация §8); FTUE-тайминги: `07-ux-ui-ftue.md` §3.

**Легенда тегов:** `[НЕ-КОД]` — браузер/дашборды; `[КОД]` — правки в репозитории; `[ДЕНЬГИ]` — шаг стоит денег; `[ЮРИСТ]` — нужен профильный специалист.
**Все цены — порядки величин на середину 2026 г., перед действием проверять на сайте сервиса.** Автор — не юрист и не налоговый советник.

---

## Этап 1. Порядок включения: сначала песочница, потом прод

### 1.1 Железное правило последовательности — [НЕ-КОД]

**Что сделать.** Включать деньги строго в этом порядке, не перепрыгивая:

```
1. Тестовая реклама (MAX Test Mode, тест-устройства)      ← этапы 2–4
2. IAP-песочница (Sandbox Apple / License testers Google) ← этап 5
3. Аналитика видит тестовые события (DebugView Firebase)  ← этапы 6–7
4. Полный тест-чеклист зелёный                            ← этап 8
5. Внутренний трек стора (TestFlight / Internal testing)
6. Прод: релиз в soft-launch гео → включение живой рекламы и IAP
```

**Зачем.** Живые объявления в дев-сборке = бан аккаунта AppLovin/AdMob за self-click/невалидный трафик; живые покупки без песочницы = возвраты и грязная аналитика. Восстановить забаненный рекламный аккаунт почти невозможно — это конец монетизации на этом юрлице.

**Грабли.**
- Никогда не кликать по живым объявлениям в своём приложении, даже «проверить один раз». Тест-устройства регистрируются в дашбордах (шаг 2.3) — только так.
- Google: новые личные аккаунты разработчика обязаны прогнать закрытое тестирование (порядка 12 тестеров ≥14 дней) до продакшена — **проверить актуальные правила в Play Console**; закладывать это в календарь, деньги включатся не раньше.
- Порядок игр: весь документ выполняется целиком для Block Surge; Orchard Peaks и WordGrove — только после того, как кокпит Block Surge (`../block-puzzle/app/` soft-launch дашборд) покажет решение go по гейтам `09-analytics-kpi.md` §5.4.

**Время:** правило — 0 минут, дисциплина — бесценна. **Выход:** согласованный порядок работ.

---

## Этап 2. AppLovin MAX: ad units, тест-режим, медиация

Аккаунт AppLovin уже создан ([02-accounts-and-services.md](02-accounts-and-services.md), этап 5). Обоснование выбора MAX — `../block-puzzle/06-monetization.md` §8.

### 2.1 Создать приложения и ad units — [НЕ-КОД]

1. Зайти на applovin.com → дашборд → **MAX → Mediation → Manage → Ad Units → Create Ad Unit** (навигация меняется, искать «Create Ad Unit»).
2. Добавить приложение по bundle id (`com.surgegames.blocksurge`); пока приложения нет в сторе — выбрать вариант «app not live / добавить вручную» с платформой и package name.
3. Создать **по одному ad unit на формат на платформу**. Для Block Surge — 6 штук:

| Ad unit (имя у себя) | Формат | Платформа | Плейсменты из 06 §2 |
|---|---|---|---|
| bs_ios_rewarded | Rewarded | iOS | RW-1…RW-4 |
| bs_ios_inter | Interstitial | iOS | INT-1, INT-2 |
| bs_ios_banner | Banner (adaptive) | iOS | BAN-1 |
| bs_and_rewarded / bs_and_inter / bs_and_banner | — | Android | те же |

   Плейсмент ≠ ad unit: плейсменты (`RW-1`, `INT-2`…) передаются строкой в `showRewarded(placement)` и попадают в отчёты — новые ad units под каждый плейсмент НЕ создавать.
4. Скопировать 6 ad unit id + **SDK Key** (Account → Keys) в конфиг сборки (шаг 3.2), не в код.

**Зачем.** Ad unit — единица аукциона и отчётности; разделение по формату и платформе — минимально необходимое для управления eCPM.
**Стоимость:** 0 €. **Время:** 1–2 часа. **Вход:** аккаунт AppLovin, bundle id. **Выход:** 6 ad unit id + SDK key на игру.
**Грабли:** не плодить ad units «на всякий случай» — дробление трафика снижает bid density и eCPM; имена задавать по схеме `<игра>_<платформа>_<формат>` сразу, переименовывать больно.

### 2.2 Тест-режим и тест-устройства — [НЕ-КОД]

1. MAX → **Test Devices** (Mediation → Manage): добавить своё устройство по **GAID** (Android: Настройки → Google → Реклама) и **IDFA** (iOS; если ATT не разрешён, IDFA нулевой — сначала дать согласие ATT в тест-сборке).
2. Включить устройству **Test Mode** — объявления пойдут тестовые, клики безопасны.
3. В приложение временно вывести **Mediation Debugger** (`showMediationDebugger()` из плагина, за dev-флагом): он показывает, какие адаптеры сетей подхватились, какие ключи невалидны.

**Зачем.** Единственный безопасный способ увидеть рекламу у себя (см. 1.1).
**Время:** 30 минут. **Выход:** устройства в тест-листе, Mediation Debugger доступен в dev-сборке.
**Грабли:** тест-показы не платят и не попадают в выручку — не пугаться нулей в отчётах; iOS-симулятор автоматически test device, но баннерную вёрстку проверять на живом устройстве.

### 2.3 Сети медиации на старте: bidding-минимум — [НЕ-КОД] [ДЕНЬГИ]

Стартовый список — как в плане интеграции скелета ([maxProvider.stub.ts](../block-puzzle/app/src/ads/maxProvider.stub.ts)) и 06 §8:

| Сеть | Режим | Что нужно сделать |
|---|---|---|
| AppLovin Exchange | bidding | Включён по умолчанию, ничего |
| Google AdMob (bidding) | bidding | Аккаунт AdMob (см. 02, этап 6); создать в AdMob приложение + ad units, привязать в MAX → Networks → Google bidding |
| Mintegral | bidding | Регистрация на сети, ключи App Key/Placement → MAX Networks |
| Unity Ads | bidding | То же, Game ID |
| Liftoff Monetize | bidding | То же |

1. MAX → **Mediation → Networks**: для каждой сети нажать Connect, вставить ключи из её дашборда.
2. Установить адаптеры сетей в нативный проект (шаг 3.1) — без адаптера сеть в аукцион не выйдет.
3. Обновить **app-ads.txt**: MAX генерирует сводный файл (Mediation → app-ads.txt) — выложить на `https://playblocksurge.com/app-ads.txt` (домен из 02, этап 0) и указать этот сайт как developer website в карточках сторов ([../block-puzzle/prototype/store-listing.md](../block-puzzle/prototype/store-listing.md)).
4. Waterfall-сети и CPM-floor'ы на старте **не** настраивать: чистый bidding, оптимизация — после 2–4 недель данных (02, этап 7).

**Зачем.** AppLovin+AdMob дают ~65% рекламной выручки игр (06 §8); bidding избавляет от ручных waterfall.
**Стоимость:** 0 € (но у каждой сети своя выплата и свой налоговый профиль — см. этап 9). **Время:** 3–5 часов + до недели на аппрувы сетей. **Выход:** 5 сетей в аукционе, app-ads.txt опубликован.
**Грабли:** app-ads.txt подхватывается сетями до 24–48 часов, без него часть спроса молчит; в каждой сети заполнить платёжку и налоговые формы (W-8BEN — см. [01-legal-foundation.md](01-legal-foundation.md)) сразу, иначе первая выплата зависнет.

---

## Этап 3. [КОД] MaxAdProvider поверх Capacitor-плагина

### 3.1 Установить плагин и адаптеры — [КОД]

1. В `../block-puzzle/app/`: поставить официальный AppLovin MAX плагин для Capacitor/Cordova (`npm i` + `npx cap sync`); точное имя пакета — по документации AppLovin (меняется; fallback-план при критических багах в WebView — AdMob Mediation, зафиксирован в 06 §8).
2. Добавить адаптеры сетей из 2.3 (iOS — CocoaPods на Mac, Android — gradle-зависимости) — по матрице версий AppLovin.
3. iOS `Info.plist`: `NSUserTrackingUsageDescription` (текст для ATT, этап 4) + массив `SKAdNetworkItems` всех сетей (генератор — на сайте AppLovin).

**Время:** 0.5–1 день (+неизбежная возня с версиями gradle/pods). **Грабли:** конфликты версий адаптеров — обновлять их только комплектом; после каждого `npx cap sync` проверять, что Info.plist-правки не затёрты.

### 3.2 Реализовать MaxAdProvider — [КОД]

Файл `maxProvider.stub.ts` уже фиксирует контракт — реализация ложится в готовые методы, вызывающий код (`MonetizeController`) не меняется. Псевдокод:

```ts
// src/ads/maxProvider.ts — псевдокод, API плагина сверять с документацией
export class MaxAdProvider implements AdProvider {
  onImpression: ((imp: AdImpression) => void) | null = null;
  private rwReady = false; private lastPlacement = '';

  async init(): Promise<void> {
    await consentGate();                       // ЭТАП 4: UMP + ATT ДО инициализации
    await AppLovinMAX.initialize(SDK_KEY);     // ключи — из import.meta.env, не из кода
    // Impression-revenue → аналитика (LTV-модель 09 §5):
    AppLovinMAX.addEventListener('OnAdRevenuePaid', (e) => {
      this.onImpression?.({
        format: mapFormat(e.adFormat),         // 'rw' | 'int' | 'banner'
        placement: e.placement ?? this.lastPlacement,
        revenueUsd: e.revenue,
        ecpmUsd: e.revenue * 1000
      });
    });
    AppLovinMAX.addEventListener('OnRewardedAdLoaded',      () => { this.rwReady = true; });
    AppLovinMAX.addEventListener('OnRewardedAdLoadFailed',  () => {
      this.rwReady = false;
      retryWithBackoff(() => AppLovinMAX.loadRewardedAd(RW_UNIT)); // 2^n сек, cap 64
    });
    AppLovinMAX.loadRewardedAd(RW_UNIT);       // прелоад сразу после init
    AppLovinMAX.loadInterstitial(INT_UNIT);
  }

  isRewardedReady(placement: string): boolean { return this.rwReady; } // сигнатура контракта; UI глушит оффер при false

  showRewarded(placement: string): Promise<RewardedResult> {
    return new Promise((resolve) => {
      if (!this.rwReady) return resolve({ completed: false, revenueUsd: 0 }); // no-fill ≠ reject
      this.lastPlacement = placement;
      let gotReward = false; let revenue = 0;
      const off = listenOnce({
        OnRewardedAdReceivedReward: () => { gotReward = true; },
        OnAdRevenuePaid:            (e) => { revenue = e.revenue; },
        OnRewardedAdHidden: () => {        // резолв ТОЛЬКО после закрытия ролика
          off(); this.rwReady = false; AppLovinMAX.loadRewardedAd(RW_UNIT);
          resolve({ completed: gotReward, revenueUsd: revenue });
        },
        OnRewardedAdFailedToDisplay: () => { off(); resolve({ completed: false, revenueUsd: 0 }); }
      });
      withTimeout(120_000, () => { off(); resolve({ completed: false, revenueUsd: 0 }); }); // страховка от зависшего промиса
      AppLovinMAX.showRewardedAd(RW_UNIT, placement);
    });
  }
  // showInterstitial — симметрично (isReady → показ → резолв на Hidden, no-fill → shown:false);
  // showBanner/hideBanner → createBanner(BAN_UNIT,'bottom_center')/showBanner/hideBanner.
}
```

Ключевые правила (наследуются из контракта [provider.ts](../block-puzzle/app/src/ads/provider.ts)):
1. Promise **никогда не reject по бизнес-причинам**: no-fill, недосмотр, таймаут = `completed:false` — экономика игры уже это обрабатывает.
2. `revenueUsd` берётся из impression-level события того же показа — это единственный источник ad-выручки для LTV (09 §5).
3. Награду выдаёт вызывающий слой по `completed:true` — провайдер наград не трогает.

### 3.3 Переключение фабрикой — [КОД]

1. В [../block-puzzle/app/src/ads/index.ts](../block-puzzle/app/src/ads/index.ts) заменить импорт скелета на реальный `maxProvider.ts`; логика выбора уже готова: `VITE_AD_PROVIDER=max` → MaxAdProvider, иначе SimAdProvider.
2. Прод-сборка: `VITE_AD_PROVIDER=max npm run build && npx cap sync`. Веб-демо и 516 автотестов продолжают жить на симуляторе — **не трогать** дефолт.
3. Повторить 3.1–3.3 в `../solitaire-meta/app/` и `../word-game/app/` (их очередь — после go-гейта Block Surge).

**Время этапа 3:** 2–4 дня на игру (первая дольше). **Выход:** сборка с живым MAX за флагом; веб-симуляция не сломана (`npm test` зелёный).

---

## Этап 4. Согласия ПЕРЕД SDK: UMP (GDPR) и ATT (iOS)

### 4.1 Настроить Google UMP — [НЕ-КОД] [ЮРИСТ]

1. AdMob → **Privacy & messaging** → создать GDPR-сообщение (EEA/UK) для приложения; добавить список рекламных партнёров (сети из 2.3). UMP — сертифицированная Google CMP (TCF), с 2024 обязательна для показа рекламы AdMob/Google bidding в EEA/UK.
2. Опционально там же — сообщение ATT/IDFA для iOS (объясняющий экран перед системным промптом).
3. Текст и состав партнёров показать юристу вместе с Privacy Policy ([01-legal-foundation.md](01-legal-foundation.md), этап 3) — согласие и политика должны совпадать по смыслу. `[ЮРИСТ]`

**Стоимость:** 0 €. **Время:** 2–3 часа + ревью юриста. **Грабли:** consent-строка UMP автоматически читается AdMob-SDK, но **MAX и остальные сети** видят её через TCF-строку — проверить в Mediation Debugger, что consent доехал; отказ пользователя = неперсонализированная реклама (eCPM ниже), это норма, не пытаться «дожимать».

### 4.2 Когда показывать: привязка к нашему FTUE — [КОД]

FTUE Block Surge (`../block-puzzle/07-ux-ui-ftue.md` §3): шаг 1 — «холодный старт → сразу игровое поле, без регистраций и разрешений»; первый rewarded-оффер — уровень 5, первый interstitial — уровень 6 / ≥8-я минута. Отсюда правило:

1. **Первый запуск:** никаких диалогов на старте. Consent-гейт срабатывает после `ftue_step 4` (первая победа, ~0:45) — естественная пауза, реклама ещё не нужна.
2. **Повторные запуски:** согласие уже сохранено → вся цепочка проходит молча на буте.
3. ATT-промпт (iOS) — сразу после UMP-формы, до init MAX: MAX должен инициализироваться, уже зная IDFA-статус.

```ts
// псевдокод буты приложения (main.ts каждой игры)
async function boot() {
  await game.mountUi();                        // FTUE шаг 1: игра доступна мгновенно
  await consentGate();                         // ждёт ftue_step>=4 ИЛИ сохранённого согласия
  await ads.init();                            // MAX (этап 3) — consent уже виден SDK
  await firebase.init();                       // этап 6 — после согласий (Consent Mode)
  await appsflyer.start();                     // этап 7 — умеет ждать ATT сам
}
async function consentGate() {
  await firstOf(store.hasConsentDecision, ftue.step4Reached);
  const info = await UMP.requestConsentInfoUpdate();
  if (info.formRequired) await UMP.showForm(); // вне EEA/UK формы не будет — ок
  if (isIOS && attStatus() === 'notDetermined') {
    await showPrePrompt();                     // наш экран «зачем» (текст из 4.1.2)
    await ATT.requestTrackingAuthorization();  // системный промпт, ОДИН раз за жизнь установки
  }
}
```

**Грабли:** ATT-промпт системно показывается один раз — если пользователь отказал, вернуть нельзя, поэтому пре-промпт со внятной выгодой обязателен; отказ ATT **не должен ломать игру** (проверка — этап 8); Firebase включать только после consent-гейта и с Consent Mode (analytics_storage по умолчанию denied для EEA — уточнить конфигурацию у юриста вместе с 4.1). `[ЮРИСТ]`

**Время этапа 4:** 1–2 дня. **Выход:** consent-флоу в сборке, согласия видны всем SDK.

---

## Этап 5. IAP: товары в сторах и RevenueCat

### 5.1 Завести товары в Play Console и App Store Connect — [НЕ-КОД]

Идентификаторы в сторах — по схеме `<bundleId>.<sku из config.ts>` (например `com.surgegames.blocksurge.remove_ads`); короткие id из кода остаются внутренними, маппинг делает RevenueCat (5.2). Полки уже зафиксированы в коде и главах 06 §5 — переносить 1:1:

**Block Surge — 11 SKU ([../block-puzzle/app/src/monetize/config.ts](../block-puzzle/app/src/monetize/config.ts), `../block-puzzle/06-monetization.md` §5):**

| SKU (код) | Цена US | Тип в сторе |
|---|---|---|
| starter | $0.99 | consumable (одноразовость гейтит игра) |
| coins_s | $1.99 | consumable |
| piggy | $2.99 | consumable |
| remove_ads | $4.99 | **non-consumable** |
| season_pass | $4.99 | consumable (новая покупка каждый сезон) |
| coins_m / coins_l / coins_xl / coins_xxl / mega | $4.99 / $9.99 / $19.99 / $49.99 / $99.99 | consumable |
| sub (Surge Premium) | $7.99/мес | auto-renewable subscription |

**Orchard Peaks — 12 SKU ([../solitaire-meta/app/src/monetize/config.ts](../solitaire-meta/app/src/monetize/config.ts)):** coins_s $0.99, starter_pack $2.99, piggy_greenhouse $3.99, coins_m $4.99, remove_ads $6.99 (non-consumable), club_month $7.99/мес (подписка), almanac_premium $7.99, coins_l $9.99, event_bundle $12.99, coins_xl $19.99, coins_xxl $49.99, coins_max $99.99.

**WordGrove — 7 монетных + 3 ([../word-game/app/src/monetize/config.ts](../word-game/app/src/monetize/config.ts)):** coins_handful $0.99, coins_starter $2.99, coins_pouch $4.99, coins_chest $9.99, coins_chest_t $19.99, coins_region $49.99, coins_master $99.99 — consumable; **sub_month $8.99/мес и sub_year $49.99/год** (одна subscription group «WordGrove Club», триал 7 дней на обеих); remove_ads $9.99 non-consumable.

Порядок действий (на примере Block Surge):
1. **Play Console** → приложение → Monetize → Products → In-app products: создать 10 товаров (id, название, описание, цена — Google сам разложит по локальным tier'ам); Subscriptions → создать подписку + base plan monthly.
2. **App Store Connect** → приложение → Features → In-App Purchases: то же; подписку — в Subscription Group; у каждого IAP заполнить Review Screenshot (обязателен для ревью) и локализации EN/RU (тексты — из `store-listing.md` и i18n-словарей `app/src/i18n/`).
3. Цены ставить по таблицам выше как US-tier; локализация цен — сторами автоматически (правило полки 06 §5: «все цены — локализованные tier-цены сторов»).

**Стоимость:** 0 € (комиссия стора 15–30% удерживается с продаж; при регистрации в программах Small Business/Reduced Fee — 15% до $1M, **проверить условия**). **Время:** 0.5–1 день на игру. **Вход:** подписанные платёжные/налоговые соглашения в обоих сторах (02, этап 3) — без них товары не активируются. **Выход:** SKU в статусе Ready to Submit / Active.
**Грабли:** id товара в сторе нельзя изменить и почти нигде нельзя переиспользовать после удаления — проверять трижды до создания; подписочный триал 7 дней (WordGrove) настраивается как Intro Offer — не забыть на обеих платформах.

### 5.2 Настроить RevenueCat — [НЕ-КОД] [ДЕНЬГИ]

1. app.revenuecat.com → Project на игру → добавить два App (App Store: In-App Purchase Key из App Store Connect; Play Store: service-account JSON из Google Cloud — мастер RevenueCat ведёт по шагам).
2. **Entitlements:** `no_ads` (remove_ads, подписки), `premium` (Surge Premium) / `club` (Orchard, WordGrove Club). Игровой код спрашивает entitlement, не SKU.
3. **Products** → привязать все store-id из 5.1; **Offerings** → default-полка в порядке `IAP_SHELF`.
4. Включить webhooks/интеграцию в аналитку — позже, после этапа 6.

**Зачем (что RevenueCat делает за нас):** серверная валидация чеков Apple/Google (наш контракт в [purchase.ts](../block-puzzle/app/src/monetize/purchase.ts) прямо требует «чек валидируется сервером до выдачи товара»), состояние подписок (renew/cancel/grace/billing retry), кросс-платформенное восстановление, отписка от необходимости писать свой бэкенд — сейвы остаются локальными, сервер не нужен.
**Стоимость:** бесплатно до ~$2.5k tracked revenue/мес, дальше от ~1% выручки (**проверить тарифы на revenuecat.com**). **Время:** 2–4 часа. **Выход:** SDK-ключи RevenueCat (по одному на платформу).

### 5.3 [КОД] RevenueCatPurchaseProvider

Поверх готового интерфейса `PurchaseProvider` (init/buy). Псевдокод:

```ts
// src/monetize/revenueCatProvider.ts — псевдокод
export class RevenueCatPurchaseProvider implements PurchaseProvider {
  async init(): Promise<void> {
    await Purchases.configure({ apiKey: RC_KEY });      // анонимный app user id — ок, аккаунтов нет
    const info = await Purchases.getCustomerInfo();     // авто-restore при переустановке
    this.applyEntitlements(info);                       // no_ads → adProvider.hideBanner() и т.д.
    Purchases.addCustomerInfoUpdateListener(this.applyEntitlements); // renew/cancel подписки на лету
  }
  async buy(skuId: string): Promise<PurchaseResult> {
    const sku = findSku(skuId);
    if (!sku) return { ok: false, skuId, priceUsd: 0 }; // контракт: неизвестный SKU ≠ reject
    try {
      const { customerInfo } = await Purchases.purchaseStoreProduct(storeId(skuId));
      this.applyEntitlements(customerInfo);
      return { ok: true, skuId, priceUsd: sku.price };  // выдачу товара делает MonetizeController
    } catch (e) {
      if (e.userCancelled) return { ok: false, skuId, priceUsd: 0 };
      analytics.track('iap_failed', { sku: skuId, code: e.code });   // 09 §2.3
      return { ok: false, skuId, priceUsd: 0 };
    }
  }
  async restore(): Promise<void> {                      // НОВЫЙ метод — добавить в интерфейс
    this.applyEntitlements(await Purchases.restorePurchases());
  }
}
```

Доработки контракта `[КОД]`:
1. Добавить `restore()` в `PurchaseProvider` (+no-op в SimPurchaseProvider) и **кнопку «Восстановить покупки» в магазин** (`src/monetize/store.ts` / `src/ui/ShopUi.ts`) — Apple требует её наличия на ревью.
2. Фабрика по env-флагу `VITE_PURCHASE_PROVIDER` — зеркально рекламной фабрике [index.ts](../block-puzzle/app/src/ads/index.ts).
3. Consumable-выдача уже идемпотентна на стороне MonetizeController; проверить сценарий «покупка прошла, приложение убито до выдачи» — RevenueCat вернёт незавершённую транзакцию при следующем init.

**Время:** 2–3 дня с тестами. **Выход:** покупки за флагом, симуляция и автотесты не тронуты.

### 5.4 Песочница покупок — [НЕ-КОД]

1. **iOS:** App Store Connect → Users and Access → Sandbox Testers → создать тестовый Apple ID; на устройстве войти им в Settings → App Store → Sandbox Account. Покупки и подписки бесплатны, подписочный месяц сжат до минут.
2. **Android:** Play Console → Settings → License testing → добавить свои Gmail; залить сборку во Internal testing (товары работают только из трека, не из apk напрямую); тестовые карты «test card, always approves».

**Грабли:** iOS-песочница печально нестабильна (зависшие промпты — лечится пересозданием тестера); Android-товары появляются в API через несколько часов после создания и только после публикации сборки в трек.

---

## Этап 6. Firebase: Analytics + Crashlytics

### 6.1 Включить сервисы — [НЕ-КОД]

1. Проекты Firebase уже созданы (02, этап 4). Добавить iOS/Android-приложения по bundle id, скачать `GoogleService-Info.plist` / `google-services.json` в нативные проекты.
2. Analytics включён по умолчанию; Crashlytics — включить в консоли + подключить плагин в сборку.
3. BigQuery-экспорт (09 §0) — включить сразу (bесплатный sandbox-тариф), когортный BI понадобится в soft launch.

**Стоимость:** 0 € на нашем масштабе (Spark/Blaze с нулевым потреблением; **проверить лимиты**). **Время:** 2–3 часа на игру.

### 6.2 [КОД] Адаптер Analytics → Firebase

Дерево событий уже спроектировано (09 §2) и уже эмитится классом [Analytics](../block-puzzle/app/src/economy/analytics.ts) (`track(event, params)`). Прод-адаптер — тонкий сток:

```ts
// псевдокод: сток поверх существующего трекера, дерево 09 §2 не меняется
export class FirebaseAnalyticsSink extends Analytics {
  override track(event: string, params?: AnalyticsParams): void {
    super.track(event, params);                        // in-memory тэлли для KPI-дашборда живёт
    FirebaseAnalytics.logEvent({ name: clamp40(event), params: clampParams(params) });
    if (event === 'ad_impression' && params) {         // стандартное событие → tROAS/LTV в GA4
      FirebaseAnalytics.logEvent({ name: 'ad_impression', params: {
        ad_platform: 'AppLovin', ad_format: params.format, ad_unit_name: params.placement,
        value: params.revenue_usd, currency: 'USD' } });
    }
  }
}
```

Правила маппинга: имена ≤40 символов, ≤25 параметров, snake_case — наше дерево 09 §2 уже удовлетворяет; общие параметры (`lifetime_day`, `ab_groups`, `geo_tier`…) — через `setUserProperty`, не в каждом событии; `iap_*` дублировать не нужно — покупки в GA4 приедут из RevenueCat-интеграции (5.2.4), выбрать **один** источник выручки, иначе задвоение.

**Время:** 1 день. **Выход:** события видны в Firebase DebugView с тест-устройства; краши падают в Crashlytics (проверить принудительным тест-крашем).

---

## Этап 7. AppsFlyer: атрибуция и ad revenue

**Когда:** можно отложить до старта закупки трафика (02, этап 8) — органический soft launch жив и без MMP; но SKAN-окно не восстановить задним числом, поэтому лучше поставить SDK до релиза.

1. `[НЕ-КОД]` Создать приложения в AppsFlyer, получить Dev Key; тариф — есть бесплатный уровень до N конверсий (**проверить актуальный на appsflyer.com**), дальше ~$0.05–0.07/конверсия.
2. `[КОД]` SDK через Capacitor-плагин; старт — после consent-гейта (этап 4), на iOS включить ожидание ATT (`waitForATTUserAuthorization(60)`), чтобы атрибуция получила IDFA при согласии.
3. `[КОД]` Связка с MAX: включить **Ad Revenue** (impression-level из MAX API → `logAdRevenue` при каждом `onImpression` из нашего провайдера) — это замыкает LTV-модель 09 §5: ad-выручка попадает в когорты по источникам трафика.
4. `[НЕ-КОД]` SKAdNetwork: включить SKAN-мод в дашборде, задать conversion values по нашим гейтам (первые сутки: `ftue_step`, `level_complete`, `iap_initiated` — см. воронки 09 §3).

**Время:** 1–2 дня. **Грабли:** AppsFlyer и Firebase считают installs по-разному — не сверять лоб в лоб; без выплаченного тарифа raw-data экспорт закрыт; ATT-отказники атрибутируются вероятностно/SKAN — это нормально.

---

## Этап 8. Тест-чеклист перед прод-включением

Прогнать целиком на iOS и Android (`[НЕ-КОД]`, на устройствах, сборка с `VITE_AD_PROVIDER=max` + RevenueCat):

1. **Реклама (тест-режим):** тестовый rewarded показывается на RW-1…RW-4 и награда выдаётся ровно при досмотре; закрытие на середине → награды нет, игра не зависла; interstitial приходит по капам (`monetize/interstitial.ts`), no-fill не ломает UI (оффер спрятан по `isRewardedReady()=false`); баннер живёт и рефрешится; `onImpression` шлёт `ad_impression` в Firebase DebugView.
2. **Покупки (песочница):** каждый SKU из 5.1 покупается; consumable начисляет валюту 1 раз; remove_ads мгновенно прячет INT+BAN (rewarded остаётся — 06 §3.8); переустановка → «Восстановить покупки» возвращает remove_ads и подписку без повторной оплаты; отмена платежа → `ok:false`, магазин жив; подписка в песочнице проходит renew и cancel, entitlement гаснет.
3. **Consent-флоу:** свежая установка + EEA (VPN) → UMP-форма после первой победы, не на холодном старте; отказ от персонализации → реклама всё равно показывается; вне EEA формы нет.
4. **ATT:** согласие → IDFA доступен; **отказ → игра работает полностью**, реклама показывается (неперсонализированная), краши отсутствуют; промпт не появляется второй раз.
5. **Аналитика:** DebugView показывает дерево 09 §2 (session_start, ftue_step, level_complete, ad_impression, iap_completed); Crashlytics ловит тест-краш; AppsFlyer видит тест-девайс.
6. **Регресс:** `npm test` во всех трёх `app/` зелёный (516 тестов); веб-сборка без флагов по-прежнему на симуляторах.

Любой красный пункт — стоп; в прод не идти. **Время:** 1–2 дня честного прогона. **Выход:** протокол чеклиста в досье (структура досье — [01-legal-foundation.md](01-legal-foundation.md), этап 6).

---

## Этап 9. Выплаты: пороги, сроки, куда приходят деньги

Все значения — порядки величин, **проверять в дашборде каждого сервиса**; налоговую сторону (USt/reverse charge, учёт в EÜR) — со Steuerberater ([01-legal-foundation.md](01-legal-foundation.md)). `[ЮРИСТ]` `[ДЕНЬГИ]`

| Источник | Минимальный порог | Срок выплаты | Примечания |
|---|---|---|---|
| Apple App Store (IAP) | ~$10 | ~30–45 дней после конца фискального месяца Apple | Комиссия 15/30% уже удержана; фискальный календарь Apple ≠ календарный месяц |
| Google Play (IAP) | ~$1 | ~15-е число следующего месяца | Комиссия 15/30%; выплата на merchant-профиль из 02 этап 3 |
| AppLovin (Exchange + MAX) | ~$20 | ~net-15/30 после конца месяца | Платит только за спрос AppLovin — остальные сети платят сами |
| Google AdMob (bidding) | ~$100 | ~21-е число следующего месяца | Отдельный порог! До $100 деньги копятся |
| Mintegral / Unity Ads / Liftoff | ~$50–100 у каждой | net-30…60 | У каждой свой кабинет, платёжка, W-8BEN и порог |
| RevenueCat | — не платит — | — | Это расход (см. 5.2), а не источник |

Практические следствия:
1. Первые месяцы деньги приходят «лесенкой»: Play быстрее всех, AdMob может копить до $100 квартал — это не баг.
2. Выплаты в USD на немецкий счёт — уточнить у банка комиссию за входящий SWIFT/конвертацию; часть сетей умеет EUR/SEPA — включить, где можно.
3. Каждая выплата — запись в EÜR; сети шлют self-billing-инвойсы — складывать в досье (01, этап 6).
4. Сверка выручки: истина для ad-LTV — impression-revenue из MAX (наш `onImpression` → 09 §5), истина для банка — отчёты выплат. Расхождение 5–10% — норма (невалидный трафик, курсы).

---

## Готово/не готово: критерий завершения документа

Документ считается выполненным для Block Surge, когда: чеклист этапа 8 зелёный, приложение в закрытом/внутреннем треке показывает тестовую рекламу и проводит песочные покупки, consent-флоу подтверждён на EEA-профиле, а KPI-дашборд приложения получает живые `ad_impression` с непустым `revenueUsd`. Следующий шаг — soft-launch релиз по плану `../block-puzzle/10-production.md` §3 и гейты go/iterate/kill (`../block-puzzle/09-analytics-kpi.md` §5.4); Orchard Peaks и WordGrove повторяют этапы 2–8 только после решения go.

**Честные ограничения:** без Mac нет iOS-части (сборка, ATT, песочница StoreKit); тексты согласий и связка Privacy Policy ↔ UMP — только через юриста; налоговые формы сетей и учёт выплат — со Steuerberater; иконки/скриншоты для карточек сторов (документ 03 пакета) к этому моменту должны быть готовы — примитивная графика прототипов ревью сторов не пройдёт.
