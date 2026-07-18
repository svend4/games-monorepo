# Go-to-Market · Документ 05 — Сборка, подпись, публикация

**Статус:** рабочий план к исполнению. **Владелец:** соло-разработчик (основной сценарий — резидент Германии).
**Охват:** путь «код в репо → приложение можно скачать из стора» для Block Surge ([../block-puzzle/app/](../block-puzzle/app/)), Orchard Peaks ([../solitaire-meta/app/](../solitaire-meta/app/)), WordGrove ([../word-game/app/](../word-game/app/)). Первым идёт **Block Surge** ([../README.md](../README.md)); остальные две — повтором Этапов 2–9.
**Соседние документы пакета:** [01-legal-foundation.md](01-legal-foundation.md) (форма деятельности, Privacy Policy, очистка названий), [02-accounts-and-services.md](02-accounts-and-services.md) (Play Console, Apple Developer, AppLovin/AdMob, домены), [03-art-and-assets.md](03-art-and-assets.md) (иконки, скриншоты, музыка). [04-monetization-golive.md](04-monetization-golive.md) (интеграция реальных SDK взамен симуляций) — по порядку пакета идёт перед публикацией; технически первый релиз возможен и БЕЗ реальных рекламных SDK (см. Этапы 6.3/6.6), но монетизация тогда нулевая, а видимые точки входа в покупки должны быть скрыты флагом.

> **Дисклеймер.** Не юридическая и не налоговая консультация; шаги [ЮРИСТ] — только со специалистом. Все цены — порядки величин на середину 2026 г., перед оплатой **проверить на сайте сервиса**. Требования сторов (target API, число тестеров, сроки ревью) меняются каждый год — сверяться с официальной документацией в день выполнения шага.

**Легенда тегов:** `[НЕ-КОД]` — браузер/установка/бумаги; `[КОД]` — правки или команды в репозитории; `[ДЕНЬГИ]` — платный шаг; `[ЮРИСТ]` — нужен профильный специалист.

---

## Этап 0. Предпосылки: что должно быть готово ДО этого документа

0.1. **Из [01-legal-foundation.md](01-legal-foundation.md):** форма деятельности оформлена; Privacy Policy и Terms доступны по публичному URL (без этого не пройти ни одно ревью — см. [../block-puzzle/prototype/store-listing.md](../block-puzzle/prototype/store-listing.md) §11); финальная очистка названий у юриста сделана [ЮРИСТ] (Block Surge — дистанция от Block Blast!, Orchard Peaks — без «TriPeaks» в названии, домены playblocksurge.com / wordgrovegame.com).
0.2. **Из [02-accounts-and-services.md](02-accounts-and-services.md):** Google Play Console (~25 $ однократно) и Apple Developer (~99 $/год) активны и верифицированы; налоговые/банковские формы заполнены; менеджер паролей заведён — он понадобится для keystore (Этап 3).
0.3. **Из [03-art-and-assets.md](03-art-and-assets.md):** иконка 1024×1024, feature graphic 1024×500 (Play), скриншоты по кадр-планам (`store-listing.md` §10 у Block Surge, §4 у остальных). **Честно: с графикой-примитивами из репо в App Store идти нельзя** — высокий риск реджекта по Guideline 4.3/«placeholder content» (см. Этап 7.2). В Play Internal testing (Этап 5) можно идти и с примитивами.
0.4. **Из репо (готово):** прод-приложения на TypeScript+Vite+Capacitor, 516 автотестов суммарно; `capacitor.config.ts` с bundle ID `com.surgegames.blocksurge` / `.orchardpeaks` / `.wordgrove`; ASO-тексты в `prototype/store-listing.md` каждой игры; монетизация — симуляция за интерфейсами [../block-puzzle/app/src/ads/provider.ts](../block-puzzle/app/src/ads/provider.ts) (стаб под AppLovin MAX: [../block-puzzle/app/src/ads/maxProvider.stub.ts](../block-puzzle/app/src/ads/maxProvider.stub.ts)). Нативные проекты `android/`, `ios/` — НЕ сгенерированы, это Этап 2.

**Критический путь:** 1 (окружение) → 2 (нативные проекты) → 3 (Android-подпись) → 5.1 (Internal testing) → 6 (заполнение сторов) → 7 (ревью) → 8 (rollout). iOS-ветка (1.3/1.4 → 4 → 5.3) может идти параллельно или позже — Android первым дешевле и быстрее.

---

## Этап 1. Окружение сборки

### 1.1 Проверка веб-части на Windows — [КОД]

1. Node.js LTS (≥ 20) установлен: `node -v`, `npm -v`.
2. В каждой папке `app/`: `npm ci`, затем `npm test` (Vitest; суммарно по трём играм 516 тестов должны быть зелёными) и `npm run build` (tsc + vite build → `dist/`).
3. Смоук в браузере: `npm run dev` → пройти FTUE, переключить язык RU/EN, проверить звук.

**Время:** 30–60 мин на все три. **На выходе:** зелёные тесты, собирающийся `dist/`. **Грабли:** `npm install` вместо `npm ci` может уехать от lock-файла; Windows-антивирус замедляет `node_modules` — добавить папку в исключения.

### 1.2 Android Studio на Windows — [НЕ-КОД]

1. Скачать с developer.android.com/studio (бесплатно), установить с настройками по умолчанию (включая Android SDK и встроенный JDK/JBR — отдельную Java ставить не нужно).
2. Первый запуск → Setup Wizard → Standard → принять лицензии SDK.
3. SDK Manager (Settings → Languages & Frameworks → Android SDK): установить последнюю стабильную платформу (API уровня, актуального требованиям Play — в 2026 ориентир API 36, **проверить** на developer.android.com/google/play/requirements/target-sdk) + «Android SDK Build-Tools», «Android SDK Platform-Tools», «Android SDK Command-line Tools».
4. На телефоне включить «Параметры разработчика» → «Отладка по USB»; подключить кабелем, подтвердить отпечаток ключа. Эмулятор — опционален (для block-puzzle хватает реального устройства; эмулятору нужна виртуализация — включить в BIOS, на Windows 11 обычно работает из коробки).

**Стоимость:** 0 €; диск ~15–25 ГБ. **Время:** 1–2 ч (в основном скачивание). **На выходе:** `adb devices` видит телефон. **Грабли:** корпоративный VPN/прокси ломает скачивание SDK; не ставить Android Studio в путь с кириллицей/пробелами; версию Android Studio сверить с требованиями Capacitor (capacitorjs.com/docs/getting-started/environment-setup) — Capacitor 8 требует свежие Studio/Gradle/Java, **проверить в доке**.

### 1.3 Xcode — только Mac — [НЕ-КОД] [ДЕНЬГИ]

**Честно: без macOS собрать iOS-приложение нельзя. Никак.** Варианты:

1. **Свой Mac (рекомендация при серьёзных планах на iOS).** Достаточно Mac mini: б/у M1/M2 ~350–550 €, новый M4 ~от 600–700 € (**проверить**). Требование Apple: сабмит билдов — только актуальным/предыдущим Xcode, который требует свежую macOS; слишком старые Intel-Mac (до ~2018) не потянут — уточнить совместимость модели с текущей macOS перед покупкой.
2. Установка: App Store → Xcode (~12–15 ГБ, качается долго) → запустить → согласиться на «additional components» → `xcode-select --install` (Command Line Tools). CocoaPods: Capacitor ставит зависимости через SPM/Pods в зависимости от версии — следовать выводу `npx cap add ios`; если нужен CocoaPods: `sudo gem install cocoapods` или через Homebrew.
3. Xcode → Settings → Accounts → добавить Apple ID из [02-accounts-and-services.md](02-accounts-and-services.md).

**Время:** 2–4 ч. **Грабли:** нехватка диска (Xcode + симуляторы легко съедают 50+ ГБ); версия macOS старее, чем требует свежий Xcode → сначала обновить систему.

### 1.4 Альтернатива без Mac: облачные сборщики — [НЕ-КОД] [ДЕНЬГИ]

1. **Codemagic** (codemagic.io): CI/CD с macOS-машинами, есть готовый workflow для Capacitor. Бесплатный тир — ~500 mac-минут/мес, дальше pay-as-you-go порядка 0,04–0,10 $/мин в зависимости от машины (**проверить тарифы на сайте**). Умеет подпись iOS через загруженные сертификаты/App Store Connect API key и автопубликацию в TestFlight.
2. **GitHub Actions** (macos-runner): для приватного репо ~0,08 $/мин macOS сверх бесплатных минут (**проверить**); придётся самому написать workflow (fastlane match или ручная выгрузка сертификатов) — заметно больше возни, чем Codemagic.
3. **Ionic Appflow** — исторический «родной» вариант для Capacitor, но были анонсы о сворачивании сервиса; **проверить актуальный статус** перед выбором, новые проекты туда лучше не привязывать.
4. Аренда удалённого Mac (MacStadium, Scaleway M1 и т.п., ~от 50–100 €/мес) — вариант, если нужен именно интерактивный Xcode, а не CI.

**Рекомендация:** Android — локально на Windows; iOS для первой игры — Codemagic (дешевле входа в Mac), а при выходе всех трёх игр и регулярных апдейтах — купить б/у Mac mini: он окупается против облачных минут за несколько месяцев активной разработки. **Грабли:** отладить нативный краш iOS без Mac почти невозможно — облако собирает, но не отлаживает; закладывать это в риски.

---

## Этап 2. Генерация нативных проектов

### 2.1 Сборка веба и добавление платформ — [КОД]

Для каждой игры (пример — Block Surge; конфиг уже готов: [../block-puzzle/app/capacitor.config.ts](../block-puzzle/app/capacitor.config.ts)):

```bash
cd games/ad-concepts/block-puzzle/app
npm run build          # tsc --noEmit && vite build → dist/
npx cap add android    # один раз: генерирует android/
npx cap add ios        # один раз, ТОЛЬКО на macOS: генерирует ios/
npx cap sync           # копирует dist/ и плагины в нативные проекты (алиас: npm run cap:sync)
```

Дальше по жизни: после каждого изменения веб-кода — `npm run build && npx cap sync`. Быстрые алиасы уже в [../block-puzzle/app/package.json](../block-puzzle/app/package.json): `npm run cap:android` / `npm run cap:ios` (sync + открыть Android Studio/Xcode). То же — в `solitaire-meta/app` и `word-game/app`.

**Время:** 15–30 мин на игру. **На выходе:** папки `android/` и (на Mac) `ios/App/`. **Грабли:** запуск `cap add ios` на Windows упадёт — это нормально, платформа добавляется на Mac (или в облачном CI); `cap sync` без предварительного `npm run build` зальёт в приложение устаревший `dist/`.

### 2.2 Что коммитить в git — [КОД]

1. **Коммитить:** `android/` и `ios/` целиком (официальная рекомендация Capacitor — нативные проекты являются source-артефактами: туда лягут иконки, splash, правки Gradle/Info.plist).
2. **НЕ коммитить** (дополнить `app/.gitignore` — сейчас там только `node_modules/`, `dist/`, `*.log`):

```gitignore
# нативные артефакты и секреты
android/local.properties
android/.gradle/
android/app/build/
android/build/
*.jks
*.keystore
keystore.properties
ios/App/Pods/
ios/App/build/
ios/App/App.xcworkspace/xcuserdata/
```

3. **Никогда** не коммитить keystore и пароли — даже в приватный репозиторий (Этап 3.2).

### 2.3 Проверка нативного Android-проекта — [КОД]

1. `npm run cap:android` → в Android Studio дождаться Gradle Sync.
2. Проверить в `android/app/build.gradle`: `applicationId "com.surgegames.blocksurge"`, `versionCode 1`, `versionName "1.0.0"`; `minSdkVersion`/`targetSdkVersion` Capacitor выставляет сам — target должен удовлетворять текущему требованию Play (**проверить**).
3. Иконка и splash: Android Studio → правый клик на `res` → New → Image Asset (иконка из [03-art-and-assets.md](03-art-and-assets.md), adaptive icon: foreground + фон); имя приложения — `android/app/src/main/res/values/strings.xml` (`app_name` → «Block Surge»).
4. Run ▶ на подключённом устройстве: пройти FTUE, повернуть/свернуть приложение, убедиться, что сейвы переживают перезапуск (сейвы локальные — это ок для старта, см. [../block-puzzle/10-production.md](../block-puzzle/10-production.md)).

**Время:** 1–2 ч на первую игру. **Грабли:** вырезы/чёлки — приложение уже учитывает safe-area (см. [../block-puzzle/app/README.md](../block-puzzle/app/README.md)), но проверить на реальном устройстве; WebView на старых Android (WebView обновляется через Play — на тестовом телефоне обновить «Android System WebView»).

### 2.4 Проверка нативного iOS-проекта — [КОД] (Mac)

1. `npm run cap:ios` → открывается `ios/App/App.xcworkspace` (открывать workspace, не `.xcodeproj`).
2. Target App → General: Display Name «Block Surge», Bundle Identifier `com.surgegames.blocksurge`, Version `1.0.0`, Build `1`.
3. В `Info.plist` добавить ключ `ITSAppUsesNonExemptEncryption` = `NO` (мы используем только стандартный HTTPS) — иначе перед каждым TestFlight-билдом будет ручной вопрос про экспорт-криптографию.
4. Иконка: `Assets.xcassets` → AppIcon (1024×1024 из [03-art-and-assets.md](03-art-and-assets.md)). Запуск на своём iPhone: понадобится подпись — Этап 4.

---

## Этап 3. Android: ключ подписи и AAB

### 3.1 Генерация upload-keystore — [КОД] · КРИТИЧНЫЙ ШАГ

1. Сгенерировать ключ (keytool идёт в составе JDK Android Studio; на Windows он в `%LOCALAPPDATA%\Android\...`\ или использовать `jbr\bin\keytool.exe` из папки установки Studio):

```bash
keytool -genkeypair -v \
  -keystore surgegames-upload.jks \
  -alias upload \
  -keyalg RSA -keysize 2048 \
  -validity 10000
```

2. Ответить на вопросы (имя/организация — юридические данные из [01-legal-foundation.md](01-legal-foundation.md); страна DE). Пароль keystore и пароль ключа — сгенерировать менеджером паролей (см. [02-accounts-and-services.md](02-accounts-and-services.md), Этап 0), длинные, разные.
3. **Один keystore на студию — нормально; alias на игру** (upload-blocksurge, upload-orchardpeaks, upload-wordgrove) или три отдельных файла — на вкус; главное, задокументировать, что где.

### 3.2 Хранение ключа — [НЕ-КОД] · ПРОЧИТАТЬ ДВАЖДЫ

1. **Потеря keystore без Play App Signing = потеря приложения навсегда** (нельзя выпустить ни одно обновление; только новый листинг с нуля, с потерей всех установок и отзывов). С Play App Signing (3.3) потеря upload-ключа лечится процедурой сброса через поддержку (~несколько дней), но это стресс, которого легко избежать.
2. Минимум **три копии** `surgegames-upload.jks`: рабочая машина; оффлайн-носитель (флешка в ящике); зашифрованное облако (архив с паролем ИЛИ вложение в записи менеджера паролей). Пароли — только в менеджере паролей, в той же записи — путь к копиям и alias.
3. В git — никогда (см. 2.2). В мессенджеры/почту в открытом виде — никогда.

### 3.3 Play App Signing — [НЕ-КОД]

1. При создании релиза в Play Console (Этап 5.1) согласиться на **Play App Signing** (для новых приложений это по умолчанию и фактически обязательно): Google хранит «настоящий» ключ подписи, ваш `.jks` — только upload-ключ.
2. Зачем: защита от потери ключа + Google оптимизирует APK из вашего AAB под устройства.
3. Ничего дополнительно делать не нужно — просто не отказываться от дефолта.

### 3.4 Сборка release-AAB — [КОД]

Вариант А (GUI, для первого раза): Android Studio → Build → Generate Signed App Bundle / APK → **Android App Bundle** → выбрать `surgegames-upload.jks`, alias, пароли → build variant **release** → артефакт в `android/app/release/app-release.aab`.

Вариант Б (воспроизводимо, для дальнейших релизов): файл `android/keystore.properties` (в `.gitignore`!) с путём/паролями + стандартный блок `signingConfigs` в `android/app/build.gradle`; сборка: `cd android && .\gradlew bundleRelease` → `android/app/build/outputs/bundle/release/app-release.aab`.

**Время:** 30–60 мин. **На выходе:** подписанный `.aab`. **Грабли:** перед КАЖДОЙ загрузкой в Play увеличивать `versionCode` (Play не примет повтор); собрать release и прогнать его на устройстве (`Build → Generate...` → APK для локальной проверки или `gradlew installRelease`) — release-сборка иногда ведёт себя иначе, чем debug (минификация, WebView-политики).

---

## Этап 4. iOS: подпись и выгрузка

### 4.1 Требования — [НЕ-КОД] [ДЕНЬГИ]

Активный Apple Developer Program (~99 $/год, см. [02-accounts-and-services.md](02-accounts-and-services.md)), Mac с Xcode (1.3) или Codemagic (1.4), физический iPhone для теста (симулятор не покажет реальную производительность и звук).

### 4.2 Automatic signing в Xcode — [КОД] (Mac)

1. Xcode → target App → Signing & Capabilities → включить **Automatically manage signing** → Team = ваш аккаунт разработчика.
2. Xcode сам создаст App ID, сертификаты и provisioning-профили. Bundle ID должен совпадать с `capacitor.config.ts` (`com.surgegames.blocksurge`).
3. Параллельно в App Store Connect (appstoreconnect.apple.com) → My Apps → «+» → New App: платформа iOS, имя из [../block-puzzle/prototype/store-listing.md](../block-puzzle/prototype/store-listing.md) §1, bundle ID из списка, SKU — например `blocksurge-001`.
4. Первый запуск на своём iPhone: подключить кабелем → выбрать устройство → Run; на телефоне Settings → General → VPN & Device Management → доверять сертификату разработчика.

**Грабли:** имя приложения в App Store Connect может оказаться занятым, даже если тёзок в сторе не видно (имена резервируют) — тогда согласованный с юристом запасной вариант из §1 store-listing; automatic signing ломается при смене Team — лечится галочкой заново.

### 4.3 Archive и выгрузка — [КОД] (Mac)

1. В Xcode выбрать destination **Any iOS Device (arm64)** → Product → Archive.
2. Organizer → Distribute App → **App Store Connect** → Upload → далее по умолчанию (automatic signing).
3. Через 10–40 мин билд появится в App Store Connect → TestFlight (проходит автоматическую обработку; письмо, если найдены проблемы с Info.plist).

**Время:** 1–2 ч в первый раз. **Грабли:** Build number должен расти с каждой выгрузкой; при выгрузке из Codemagic то же самое делает CI-шаг с App Store Connect API-ключом (создать в Users and Access → Integrations, хранить в менеджере паролей).

---

## Этап 5. Внутреннее тестирование

### 5.1 Play Console: Internal testing — [НЕ-КОД]

1. play.google.com/console → Create app: имя «Block Surge», язык по умолчанию English (US), тип «Game», Free.
2. Testing → **Internal testing** → Create release → загрузить `.aab` из 3.4 → release notes из `store-listing.md` §7 → Save → Review → Start rollout.
3. Testers → создать email-список (до 100 адресов: свои устройства + знакомые) → скопировать **opt-in ссылку** и разослать. Установка доступна через считанные минуты, ревью для internal-трека нет.

### 5.2 Требование Google для новых личных аккаунтов — [НЕ-КОД] · ВАЖНО

Личные аккаунты, созданные после конца 2023 г., обязаны перед доступом к продакшену провести **закрытое тестирование: минимум ~12 тестеров, непрерывно 14 дней** (число и правила **проверить** в актуальной справке Play Console — требование уже меняли; см. также [02-accounts-and-services.md](02-accounts-and-services.md) этап 1.2). На аккаунты организаций требование не распространяется — ещё один аргумент регистрировать Play-аккаунт на Gewerbe/юрлицо (см. [02-accounts-and-services.md](02-accounts-and-services.md)). Если аккаунт личный: закладывать +3 недели календаря и заранее собирать 12+ живых тестеров (друзья, чаты разработчиков, r/AndroidClosedTesting и аналогичные площадки взаимного тестирования).

### 5.3 TestFlight — [НЕ-КОД]

1. App Store Connect → TestFlight: билд из 4.3 уже там.
2. **Internal Testing** (до 100 пользователей с ролями в вашей команде): без ревью, доступно сразу; добавить себя.
3. **External Testing** (до 10 000): создать группу, добавить email-адреса или включить публичную ссылку; первый билд группы проходит **Beta App Review** (~сутки). Тестерам нужно приложение TestFlight из App Store.
4. Билды TestFlight живут 90 дней.

### 5.4 Что проверяет тест-группа — [НЕ-КОД]

Чек-лист тестеру (разослать вместе со ссылкой): FTUE до конца без подсказок со стороны; переключение RU/EN; звук (вкл/выкл, сворачивание); сейв после убийства приложения; поведение оффлайн; час игры без перегрева/лагов на слабом устройстве; для WordGrove — экран подписки Club (пока симуляция: покупка не списывает денег — см. Этап 6.6). KPI-встройки уже в приложении (дашборд и кокпит — см. [../block-puzzle/09-analytics-kpi.md](../block-puzzle/09-analytics-kpi.md)); реальную телеметрию подключит [04-monetization-golive.md](04-monetization-golive.md).

**Время этапа:** 1–2 недели минимум (Apple beta review + сбор фидбека); для личного Play-аккаунта — не менее 14 дней закрытого теста (5.2).

---

## Этап 6. Заполнение карточек сторов

Тексты готовы — переносим из `prototype/store-listing.md` каждой игры: [../block-puzzle/prototype/store-listing.md](../block-puzzle/prototype/store-listing.md), [../solitaire-meta/prototype/store-listing.md](../solitaire-meta/prototype/store-listing.md), [../word-game/prototype/store-listing.md](../word-game/prototype/store-listing.md).

### 6.1 Google Play: Store listing — [НЕ-КОД]

Grow → Store presence → Main store listing. Соответствие полей (на примере Block Surge; у Orchard Peaks источники — §2 EN-Play / §3 RU, у WordGrove — §1 EN / §2 RU):

| Поле Play Console | Источник в store-listing.md |
|---|---|
| App name (≤30) | §1 |
| Short description (≤80) | §2 |
| Full description (≤4000) | §5 (EN); RU-перевод §6 — в локализацию листинга ru-RU |
| Иконка 512×512, Feature graphic 1024×500 | [03-art-and-assets.md](03-art-and-assets.md) |
| Скриншоты (мин. 2, лучше 6–8) | кадр-план §10 + ассеты из 03 |
| Категория | §8 (Puzzle / Card / Word) |
| Контакты: email, сайт | поддержка и домен из [01-legal-foundation.md](01-legal-foundation.md)/[02-accounts-and-services.md](02-accounts-and-services.md) |

Добавить второй язык листинга (ru-RU) через «Manage translations». **Грабли:** не вставлять имена конкурентов (Block Blast и т.п.) ни в описание, ни в теги — это прямое нарушение metadata-политики и юридический риск (см. [01-legal-foundation.md](01-legal-foundation.md)).

### 6.2 App Store Connect: карточка версии — [НЕ-КОД]

| Поле App Store Connect | Источник |
|---|---|
| Name (≤30) | §1 |
| Subtitle (≤30) | §2 |
| Promotional Text (≤170, меняется без ревью) | §3 |
| Keywords (≤100, запятые без пробелов) | §4 |
| Description (≤4000) | §5/§6 |
| What's New | §7 |
| Support URL / Marketing URL / Privacy Policy URL | §11 + [01-legal-foundation.md](01-legal-foundation.md) |
| Age Rating (анкета Apple) | §8; отвечать честно, ожидаемо 4+/9+ |
| Локализация RU | добавить язык в App Information → перенести §6/RU-разделы |

### 6.3 Play «Data safety» — [НЕ-КОД] · построчно

App content → Data safety. Источник — privacy-nutrition: у Block Surge §9.3, у WordGrove §3.2, у Orchard Peaks §5.1–5.5. **Два состояния:**

1. **Релиз БЕЗ реальных SDK** (текущий код: реклама/IAP — симуляция, аналитика локальная, сейвы локальные, сети нет): декларировать «данные не собираются и не передаются» («Does your app collect or share any of the required user data types?» → No). Это честно ровно до интеграции SDK.
2. **После [04-monetization-golive.md](04-monetization-golive.md) (MAX/AdMob/Firebase):** заполнить по таблице §9.1/§9.3 — типично: Device or other IDs (Advertising ID) — collected, shared (ad networks), для рекламы; App interactions/Diagnostics — collected, аналитика; ничего sensitive; данные не продаются; шифрование в транзите — да; удаление по запросу — контакт поддержки. Сверить фактический сбор с privacy-декларациями самих SDK (Google даёт официальные data-safety-подсказки для AdMob/Firebase).

**Грабли №1 всех реджектов:** декларация не совпадает с реальным трафиком приложения — Google сканирует. Обновлять форму **в том же релизе**, где появились SDK.

### 6.4 Apple «App Privacy» — [НЕ-КОД]

App Privacy → Get started. Источник — §9.2 (Block Surge) / §3.1 (WordGrove) / §5 (Orchard Peaks). Логика та же, что 6.3: без SDK — «Data Not Collected»; с SDK — Identifiers (Device ID), Usage Data, Diagnostics с целями Third-Party Advertising / Analytics, привязка к пользователю через Advertising ID → «Used for Tracking» = да → тогда обязателен ATT-промпт в приложении (это работа документа 04; **до интеграции SDK не заявлять tracking**). При сабмите версии также будет вопрос «использует ли приложение IDFA» — отвечать согласованно.

### 6.5 Анкета IARC (Play) — [НЕ-КОД]

App content → Content ratings → категория Game. Ответы для всех трёх игр: насилие/секс/наркотики/язык — нет; **реальные азартные игры — нет; симуляция азартных игр — нет** (TriPeaks — пасьянс, ставок нет); обмен контентом между пользователями — нет; сбор геолокации — нет; **содержит рекламу — да; цифровые покупки — да** (у Block Surge/Orchard Peaks — remove-ads/IAP по книге `06-monetization.md`, у WordGrove — подписка Club). Ожидаемый результат: PEGI 3 / ESRB Everyone. **Грабли:** занижение (скрыть рекламу) = снятие приложения при обнаружении.

### 6.6 Прочие обязательные декларации — [НЕ-КОД]

1. Play → Target audience: **13+ и старше**, НЕ выбирать «включая детей» — иначе попадаем под Families Policy (жёсткие требования к рекламным SDK и сертификации). Наши аудитории (25–55, 45–70) это честно позволяют.
2. Play → Ads: «Yes, my app contains ads».
3. Play → «Financial features», «Health», «Government apps» — везде No; News — No.
4. Apple → App Information → «Made for Kids» НЕ включать.
5. IAP-объекты: пока покупки — симуляция за `PurchaseProvider`, в сторах IAP-продукты **не создавать** и в декларациях покупок на первом релизе можно указать только рекламу… **Внимание:** если в UI видна витрина покупок/подписки, а купить нельзя — это реджект у Apple («features not functional»). Решение для релиза 1.0 без документа 04: скрыть точки входа в покупки фиче-флагом (у WordGrove — витрину Club) ИЛИ сразу делать [04-monetization-golive.md](04-monetization-golive.md) (реальные IAP через RevenueCat, см. [02-accounts-and-services.md](02-accounts-and-services.md), этап 9) до сабмита. Задекларированная реклама без реального SDK проблемой не является, но тогда в игре не должно быть видимых «рекламных» кнопок, которые ничего не показывают, — симуляционные плейсменты скрыть тем же флагом.

**Время этапа 6:** 4–8 ч на первую игру, 2–3 ч на последующие.

---

## Этап 7. Отправка на ревью

### 7.1 Google Play — [НЕ-КОД]

1. Когда все разделы App content зелёные и билд из закрытого теста стабилен: Production → Create release → тот же `.aab` (или новее) → Review → Start rollout (лучше сразу staged — Этап 8.1).
2. **Сроки:** от нескольких часов до 7 дней; для новых аккаунтов — ближе к верхней границе, закладывать неделю.

**Типичные реджекты игр с рекламой и профилактика:** несовпадение Data safety с трафиком (6.3); target API ниже требуемого (2.3); упоминание чужих брендов в метаданных (6.1); реклама, перекрывающая UI или без кнопки закрытия, реклама на «детскую» аудиторию при неверном target audience (6.6) — на релизе без SDK нерелевантно, при интеграции MAX — прогнать чек-лист ad-политик из книги [../block-puzzle/06-monetization.md](../block-puzzle/06-monetization.md); неработающий Privacy Policy URL (проверить с телефона в incognito).

### 7.2 App Store — [НЕ-КОД]

1. App Store Connect → версия 1.0 → выбрать билд из TestFlight → заполнить App Review Information: контакт, заметки для ревьюера («Casual block puzzle. No account needed. Ads/purchases are disabled in this build» — честно описать состояние), демо-аккаунт не нужен (логина нет).
2. Submit for Review. **Сроки:** большинство — 24–48 ч, но первая подача нового разработчика бывает дольше; реджект → исправление → повторная подача — ещё цикл, закладывать 1–2 недели календаря на «первый релиз с одной итерацией реджекта» — это норма, а не катастрофа.

**Типичные реджекты и профилактика:** **Guideline 4.3 (spam/шаблонность)** — главный риск для казуальных пазлов; лечится уникальным артом ([03-art-and-assets.md](03-art-and-assets.md)) и внятным описанием отличий (сезоны/сад/Club из книг `04-meta-progression.md`); **2.1 Performance** — краш на iPad (ревьюеры часто тестируют на iPad: прогнать билд на iPad или хотя бы в симуляторе, layout уже адаптивный); **2.3.7 Metadata** — чужие товарные знаки в keywords (§4 store-listing чистые — не «улучшать» их вручную); **5.1.1/5.1.2 Privacy** — App Privacy не совпадает с фактом (6.4), ATT-промпт обязателен при tracking (документ 04); нефункциональные видимые фичи (6.6).

### 7.3 Если реджект — [НЕ-КОД]

Не паниковать и не спорить в первом ответе: прочитать точный пункт guideline, исправить, приложить в Resolution Center короткое объяснение что изменено. Апелляция — только когда уверены, что ревьюер ошибся фактически. Каждый цикл — 1–3 дня.

---

## Этап 8. Поэтапный выпуск

### 8.1 Play: staged rollout — [НЕ-КОД]

1. Production release → Start rollout → задать процент: **5% → (48 ч без всплеска крашей/ANR в Android Vitals) → 10% → 20% → 50% → 100%**, между ступенями 1–3 дня.
2. Проценты повышаются кнопкой Update rollout; при проблеме — Halt rollout (остановит раздачу новым пользователям; уже получившие остаются на новой версии — откат возможен только новым релизом с новым `versionCode`).
3. Managed publishing (Publishing overview) — включить, чтобы одобренные ревью изменения выкатывались по кнопке, а не сразу.

### 8.2 App Store: phased release — [НЕ-КОД]

1. В настройках версии → App Store Version Release → «Phased Release for Automatic Updates»: Apple сама раздаёт обновление по кривой 7 дней (1%, 2%, 5%, 10%, 20%, 50%, 100% пользователей с автообновлением; новые скачивания получают новую версию сразу).
2. Можно паузить до 30 дней или досрочно Release to All. Для первой версии приложения phased нерелевантен (нет базы обновляющихся) — там выбрать «Manually release this version», чтобы нажать кнопку самому после одобрения.

### 8.3 Гейты решения — [КОД]/[НЕ-КОД]

Ступени rollout связать с гейтами go/iterate/kill из soft-launch кокпита (реализация: `app/src/experiments` + кокпит, критерии — [../block-puzzle/09-analytics-kpi.md](../block-puzzle/09-analytics-kpi.md) и `12-economy-sim.md` каждой игры): не повышать процент, пока crash-free < 99% (Android Vitals / Xcode Organizer) или D1 существенно ниже плана. Реальная воронка метрик появится после документа 04 (Firebase); до того ориентироваться на Vitals/краши сторов и отзывы.

---

## Этап 9. Чек-лист релиза (прогонять перед КАЖДЫМ сабмитом)

1. [КОД] `npm test` зелёный; `npm run build` без ошибок; `npx cap sync` выполнен ПОСЛЕ build.
2. [КОД] Версии синхронны: `versionName`/`versionCode` (android/app/build.gradle) и Version/Build (Xcode) подняты; правило: versionName одинаковый на обеих платформах, versionCode/Build монотонно растут и никогда не переиспользуются.
3. [КОД] Чейнджлог обновлён в обоих сторах (источник — §7 «What's New» store-listing.md; для апдейтов — писать новый, EN+RU).
4. [НЕ-КОД] Скриншоты и иконки залиты и соответствуют ТЕКУЩЕМУ билду (устаревший скриншот с несуществующим UI — метадата-реджект).
5. [НЕ-КОД] Privacy Policy URL и Support URL открываются с телефона; email поддержки читается ([01-legal-foundation.md](01-legal-foundation.md)).
6. [НЕ-КОД] Data safety / App Privacy соответствуют фактическому набору SDK этого билда (6.3/6.4); IARC-анкета актуальна (6.5).
7. [НЕ-КОД] app-ads.txt на домене актуален, когда подключена реклама ([02-accounts-and-services.md](02-accounts-and-services.md), этап 6.4).
8. [КОД] Скрытые фиче-флагом функции (покупки/реклама до документа 04) действительно скрыты в release-сборке — проверить руками на устройстве.
9. [НЕ-КОД] Бэкапы keystore на месте (3 копии, 3.2), пароли открываются из менеджера паролей — проверить раз в квартал и перед каждым мажорным релизом.
10. [КОД] Git: тег релиза (`blocksurge-v1.0.0-android`), собранный `.aab`/`.ipa` сохранён вне build-папок (архив релиз-артефактов).
11. [НЕ-КОД] План на неделю после сабмита свободен от отпусков: ревью-вопросы и реджекты требуют ответа в течение дней.

---

## Сводка: деньги и календарь (Block Surge, Android-первый)

| Статья | Порядок цен (проверить) |
|---|---|
| Android Studio, keytool, сборка | 0 € |
| Google Play Console | 25 $ однократно (из 02) |
| Apple Developer Program | 99 $/год (из 02) |
| Mac mini б/у ИЛИ Codemagic | ~350–550 € разово ИЛИ ~0–50 $/мес |
| Итого этот документ сверх 01–03 | от ~0 € (Android-only) до ~600 € (с iOS) |

**Календарь:** Android от «репо» до production-релиза — 2–4 недели (из них внутренний/закрытый тест ≥ 2 недели, особенно при личном Play-аккаунте, см. 5.2); iOS — +1–3 недели поверх (окружение, TestFlight beta review, первый App Review с вероятной итерацией). Orchard Peaks и WordGrove после обкатки пайплайна — по ~1 неделе чистого времени каждая, но WordGrove сабмитить только после решения по подписке Club (6.6: скрыть или реализовать через документ 04).
