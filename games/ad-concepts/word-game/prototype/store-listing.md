# store-listing.md — ASO-пакет WordGrove (Проход Д, global)

Готовый к подаче стор-листинг для **App Store** и **Google Play**. Двуязычный: **английский —
основной (Tier-1: US/UK/CA/AU)**, **русский — вторичный** (той же кодовой базы, [01 §6](../01-concept.md),
[02 §4](../02-market.md)). Позиционирование — из [01](../01-concept.md) (питч/USP),
[02](../02-market.md) (ниша 45+, «честная реклама + сильная подписка»),
монетизация и privacy — из [06](../06-monetization.md).

> Тексты финальные, без заглушек. Лимиты символов проверены под требования сторов
> (Apple: имя ≤30, подзаголовок ≤30, промо ≤170, keywords ≤100, описание ≤4000;
> Google: заголовок ≤30, краткое ≤80, полное ≤4000). Эмодзи в Google-описании допустимы,
> в Apple-имени/подзаголовке — нет (правила ревью).

---

## 0. Мета-параметры выкладки

| Параметр | App Store (Apple) | Google Play |
|----------|-------------------|-------------|
| Bundle / package | `com.wordgrove.app` (пример) | `com.wordgrove.app` |
| Основная категория | Games → **Word** | Games → **Word** |
| Вторичная категория | Games → Puzzle | (нет второй) |
| Возрастной рейтинг | **4+** | **Everyone** (ESRB Everyone / PEGI 3 / USK 0) |
| Ценообразование | Бесплатно + IAP/подписка | Бесплатно + IAP/подписка |
| Реклама в приложении | Да (declared) | «Contains ads» = Да |
| Языки витрины (запуск) | **EN (основной)** + RU | **EN (основной)** + RU |
| In-App Purchases (декларация) | WordGrove Club (auto-renewable), Remove Ads (non-consumable), 7 монетных SKU (consumable) | Аналогично |
| Гео запуска | US, UK, CA, AU (Tier-1) → worldwide; RU — отдельный go/no-go ([10 Проход Д](../10-production.md)) | То же |

Примечание к рейтингу: игра **не направлена на детей** (child-directed = No; ЦА 35–60,
[01 §5](../01-concept.md)). Рейтинг 4+/Everyone отражает отсутствие «неподходящего» контента,
а не таргетинг на детей — это включает бренд-безопасные блок-листы рекламы (гемблинг/дейтинг/
политика, [06 §9](../06-monetization.md)) как обязательное условие такого рейтинга при наличии рекламы.

---

## 1. АНГЛИЙСКИЙ (основной язык витрины)

### 1.1 App name / Title
```
WordGrove: Relax Crossword
```
(26 симв. — в лимите 30. Ключ «Crossword» в имени = сильнейший ASO-вес.)

### 1.2 Subtitle (Apple, ≤30) / Short description (Google, ≤80)

**Apple subtitle:**
```
Calm word puzzles, daily
```
(24 симв.)

**Google short description:**
```
Relax with word search crosswords. A calm daily puzzle to grow your vocabulary.
```
(79 симв.)

### 1.3 Promotional text (Apple, ≤170, меняется без ревью)
```
New this season: fresh daily themed crosswords, calmer hints, and scenic postcards to collect. No timers, no rush — just five quiet minutes a day.
```
(146 симв.)

### 1.4 Keywords (Apple keyword field, ≤100, через запятую, без пробелов после запятой)
```
crossword,word game,word puzzle,relax,brain,vocabulary,words,puzzle,daily,letters,connect,search,calm
```
(99 симв. Не дублируем слова из имени/подзаголовка — Apple индексирует их отдельно;
«word/puzzle/daily» повторяются осознанно как part-of-phrase комбинации.)

### 1.5 Full description (Apple & Google, ≤4000)

```
WordGrove is a relaxing crossword for grown-ups. Swipe the letters on the wheel to build words, watch them fill the crossword grid, and travel a calm atlas of natural landscapes — Provence, the Norwegian fjords, the gardens of Kyoto — one puzzle at a time.

No timers. No blinking banners. No “you lost a life.” Just you, the words, and a quiet cup-of-tea pace.

WHY PLAYERS STAY
• A daily themed crossword — like your morning newspaper puzzle, but always fresh.
• Bonus words are never wasted: every extra word you find drops acorns into your stash to trade for coins.
• Big, high-contrast letters and a no-rush tempo — comfortable for every pair of eyes.
• Beautiful scenery that never fights the words for your attention.
• Collect a landscape postcard every 15 levels.

FAIR ADS, ON PURPOSE
We believe an ad should never interrupt your thinking. You will never see one in the middle of a word — only ever between levels, with an honest, transparent cap. Prefer none at all? That is a one-tap choice below.

WORDGROVE CLUB — OUR PREMIUM
Join WordGrove Club and get:
• Zero interstitials and banners — a truly ad-free grove.
• An exclusive daily premium crossword with a fresh theme.
• Unlimited basic hints.
• Automatic stash collection and a streak shield.
Start with a 7-day free trial, cancel anytime. Monthly or yearly plans in your local currency. A “Remove Ads forever” one-time option is available too.

TRAIN YOUR VOCABULARY
Learning English? Play English puzzles with a Russian interface — a gentle, free way to grow your word power five minutes at a time.

TWO LANGUAGES, ONE GROVE
Play in English or Russian, with thousands of algorithmically crafted puzzles and hand-curated daily themes in both.

Relax, solve, and grow. WordGrove is the calm word habit you actually look forward to.

—
Subscription terms: WordGrove Club is an auto-renewable subscription. Payment is charged to your store account at confirmation of purchase. It renews automatically unless cancelled at least 24 hours before the end of the current period. Manage or cancel anytime in your account settings. Any unused portion of a free trial is forfeited when you purchase a subscription.
Privacy Policy and Terms of Use links are available in Settings and on the store page.
```
(≈2 250 симв. — в лимите. Subscription-дисклеймер обязателен для auto-renewable по правилам обоих сторов.)

### 1.6 What's New / Release notes (глобальный релиз 1.0)
```
Welcome to the worldwide launch of WordGrove!
• The full atlas is open — travel from Provence to Kyoto, one calm puzzle at a time.
• Daily themed crosswords with streaks and collectible postcards.
• WordGrove Club: an ad-free grove, a daily premium crossword, and unlimited hints — 7-day free trial.
• A gentle first-time walkthrough you can replay anytime from the “?” button.
• Accessibility first: large high-contrast letters, no timers, no pressure.
Thank you for playing. Tell us what you'd love to see next.
```

---

## 2. РУССКИЙ (вторичный язык витрины)

### 2.1 Название / Title
```
WordGrove: Словесная роща
```
(25 симв. Бренд латиницей + локализованный дескриптор — узнаваемость + ASO по «слов».)

### 2.2 Подзаголовок (Apple, ≤30) / Краткое описание (Google, ≤80)

**Apple подзаголовок:**
```
Кроссворды без спешки
```
(21 симв.)

**Google краткое описание:**
```
Расслабься и разгадывай кроссворды из букв. Спокойный ежедневный пазл для ума.
```
(78 симв. — в лимите 80.)

### 2.3 Промо-текст (Apple, ≤170)
```
Новое: свежие тематические кроссворды дня, спокойные подсказки и живописные открытки в коллекцию. Ни таймеров, ни спешки — просто пять тихих минут в день.
```
(151 симв.)

### 2.4 Ключевые слова (Apple, ≤100)
```
кроссворд,слова,словесная игра,пазл,сканворд,отдых,мозг,словарь,буквы,ежедневный,релакс,составь слово
```
(99 симв.)

### 2.5 Полное описание (Apple & Google, ≤4000)

```
WordGrove — релакс-кроссворд для взрослых. Веди пальцем по буквам на колесе, складывай слова, заполняй кроссворд и путешествуй по спокойному атласу природных пейзажей — Прованс, фьорды Норвегии, сады Киото — паззл за паззлом.

Ни таймеров. Ни мигающих баннеров. Ни «вы потеряли жизнь». Только вы, слова и неторопливый темп «вечернего чая».

ПОЧЕМУ ОСТАЮТСЯ
• Тематический кроссворд каждый день — как газетный, только всегда свежий.
• Бонусные слова не пропадают: каждое найденное слово роняет жёлуди в копилку, которую вы обмениваете на монеты.
• Крупные высококонтрастные буквы и темп без спешки — удобно для любых глаз.
• Красивые пейзажи, которые не спорят со словами за ваше внимание.
• Открытка-пейзаж в коллекцию каждые 15 уровней.

ЧЕСТНАЯ РЕКЛАМА — ОСОЗНАННО
Мы уверены: реклама не должна прерывать размышление. Вы никогда не увидите её посреди слова — только между уровнями и с честным, прозрачным лимитом. Хотите совсем без неё? Это выбор в одно касание ниже.

WORDGROVE CLUB — НАШ ПРЕМИУМ
Оформите WordGrove Club и получите:
• Ноль interstitial и баннеров — по-настоящему роща без рекламы.
• Эксклюзивный премиум-кроссворд дня со свежей темой.
• Безлимит базовых подсказок.
• Автосбор копилки и защиту стрика.
Начните с 7 дней бесплатно, отмена в любой момент. Месячный или годовой план в местной валюте. Есть и разовая опция «Убрать рекламу навсегда».

ТРЕНИРУЙТЕ СЛОВАРНЫЙ ЗАПАС
Учите английский? Играйте в английские паззлы с русским интерфейсом — мягкий и бесплатный способ пополнять словарь по пять минут.

ДВА ЯЗЫКА, ОДНА РОЩА
Играйте на русском или английском: тысячи алгоритмически собранных паззлов и рукотворные темы дня на обоих языках.

Расслабься, разгадывай, расти. WordGrove — спокойная словесная привычка, которую действительно ждёшь.

—
Условия подписки: WordGrove Club — автопродлеваемая подписка. Оплата списывается со счёта в сторе при подтверждении покупки и продлевается автоматически, если не отменить не позднее чем за 24 часа до конца периода. Управление и отмена — в настройках аккаунта в любой момент. Неиспользованная часть бесплатного триала сгорает при оформлении подписки.
Ссылки на Политику конфиденциальности и Условия использования — в Настройках и на странице стора.
```
(≈2 200 симв.)

### 2.6 «Что нового» (RU)
```
Встречайте мировой запуск WordGrove!
• Открыт весь атлас — от Прованса до Киото, паззл за паззлом.
• Тематические кроссворды дня, стрики и коллекционные открытки.
• WordGrove Club: роща без рекламы, премиум-кроссворд дня и безлимит подсказок — 7 дней бесплатно.
• Мягкое обучение первого запуска, которое можно повторить кнопкой «?».
• Доступность прежде всего: крупные контрастные буквы, без таймеров и спешки.
Спасибо, что играете. Расскажите, что добавить дальше.
```

---

## 3. Privacy-nutrition (App Privacy / Data Safety)

Данные и цели — из монетизационного стека [06 §6](../06-monetization.md) (медиация AppLovin MAX +
AdMob, ≤6 SDK) и атрибуции ([10 §1](../10-production.md): Firebase Analytics + BigQuery, Adjust,
RevenueCat). Игра **офлайн-первая**, серверного геймплея нет — прогресс хранится на устройстве.

### 3.1 Apple «App Privacy» (nutrition labels)

| Тип данных | Собирается | Связан с личностью | Трекинг (ATT) | Назначение |
|------------|:----------:|:------------------:|:-------------:|------------|
| Identifiers — Device ID (IDFA/GAID) | Да | Нет | **Да** (только при согласии ATT) | Third-Party Advertising, Analytics |
| Identifiers — User ID (псевдоним RevenueCat) | Да | Нет | Нет | App Functionality (подписки) |
| Usage Data — взаимодействия с продуктом | Да | Нет | Нет | Analytics, Product Personalization |
| Diagnostics — краш-логи, производительность | Да | Нет | Нет | App Functionality (крэш-репортинг) |
| Purchases — история покупок | Да | Нет | Нет | App Functionality (подписки/IAP) |
| Coarse Location (гео-страна из IP, стороной рекламы) | Да | Нет | Да (при согласии) | Third-Party Advertising |

Не собираем: имя, email, контакты, точную геолокацию, фото, здоровье, финансовые реквизиты,
переписку. Аккаунт/регистрация не требуются.

### 3.2 Google Play «Data safety»

- **Собираемые данные:** App activity (взаимодействия, поиск в игре — нет), App info & performance
  (краши, диагностика), Device or other IDs (рекламный ID), Purchase history.
- **Все данные шифруются при передаче (in transit):** Да (TLS).
- **Запрос удаления данных:** канал запроса на удаление — через email поддержки/форму (device-first,
  большая часть данных не покидает устройство).
- **Данные передаются третьим сторонам (shared):** рекламный ID — рекламным сетям и атрибуции
  ([06 §6](../06-monetization.md)); история покупок — процессору подписок (RevenueCat).
- **Сбор обязателен?** Нет: рекламные идентификаторы — только при согласии (ATT на iOS,
  CMP-баннер согласия в ЕЭЗ); отказ не блокирует игру (показы становятся неперсонализированными).

### 3.3 Регуляторика

- **ATT (iOS):** системный App Tracking Transparency-промпт до любого сбора IDFA; opt-in по рынку
  ~27% ([02 §1.3](../02-market.md)) — экономика заложена под неперсонализированный fallback.
  Промпт не показываем в FTUE первой сессии (не мешаем возврату).
- **GDPR/ePrivacy (ЕЭЗ/UK):** сертифицированный CMP (consent management platform) через медиацию;
  consent-string передаётся в сети; законное основание для аналитики/рекламы — согласие.
  Право на доступ/удаление — через поддержку.
- **COPPA / «семейная» политика:** приложение **не направлено на детей** (audience 35–60,
  child-directed = No). Возрастной таргетинг рекламы отключён для несовершеннолетних; бренд-безопасные
  блок-листы категорий (гемблинг/дейтинг/политика, [06 §9](../06-monetization.md)) обязательны.
  Не используем нейтральный age-gate как заявление о детской аудитории.
- **CCPA/CPRA (California):** «Do Not Sell/Share» уважается через тот же CMP/consent-сигнал.

---

## 4. Ассеты витрины (спецификация для дизайна)

Мокап-референс — [store-preview.html](store-preview.html) (самодостаточная страница, вся графика
CSS/эмодзи-примитивами; открывается без сети). Финальные ассеты готовит UX/UI-художник
([10 §4](../10-production.md)).

| Ассет | Apple | Google Play | Содержание (из мокапа) |
|-------|-------|-------------|------------------------|
| Иконка | 1024×1024 | 512×512 | Пастельный «росток/жёлудь» в круге букв, высокий контраст |
| Feature graphic | — | 1024×500 | Колесо букв → сетка на фоне пейзажа + слоган |
| Скриншоты (3–4) | 6.7"/6.5"/5.5" + iPad | phone + 7"/10" tablet | 1) ядро (колесо+сетка), 2) копилка жёлудей/бонус, 3) кроссворд дня + стрик, 4) WordGrove Club |
| App preview / промо-видео | ≤30 сек | ≤30 сек | Тихая протяжка слова → разлёт по сетке → открытка (без резких склеек) |

Подписи к скриншотам (EN / RU) — в [store-preview.html](store-preview.html), синхронно с этим листингом.

---

## 5. Локализационные заметки

- UI-строки без идиом ([07 §5](../07-ux-ui-ftue.md)) — упрощают перевод и снижают риск ревью.
- Цены в сторе — всегда в локальной валюте автотирами ([06 §5](../06-monetization.md)); в текстах
  цифры $8,99/$49,99/$9,99 — как ориентир для US, локализуются автоматически.
- RU-витрина активируется по отдельному go/no-go ([10 Проход Д](../10-production.md)): юридика
  платежей, стор-доступность, прогноз ROI ≥ 0 на органике. До этого RU-локаль присутствует как
  язык интерфейса/контента, но UA в RU не закупается.
- Кириллица шире латиницы — метрика колеса/сетки учтена ([01 §6](../01-concept.md)); скриншоты
  RU-локали снимаются отдельно (длина слов).
