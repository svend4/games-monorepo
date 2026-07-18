/**
 * Русский словарь Orchard Peaks (Проход Ж.1) — КАНОНИЧЕСКИЙ список ключей.
 *
 * TranslationKey выводится из этого объекта (keyof typeof ru): русская локаль
 * полна по построению, английская (en.ts) проверяется КОМПИЛЯТОРОМ через
 * `satisfies Record<TranslationKey, string>` (недостающий или лишний ключ —
 * ошибка tsc) плюс рантайм-тестом tests/i18n.test.ts.
 *
 * Плейсхолдеры вида {name} подставляются в t()/tDyn() (см. index.ts).
 *
 * Ключи zone.* / order.* / mission.* / booster.* / placement.* / iap.* /
 * plan.* — переводы строк из конфигов (econ.ts, meta/config.ts,
 * monetize/config.ts): конфиги остаются каноном чисел и русских строк
 * (их читают тесты и дев-инструменты), UI берёт перевод через tDyn()
 * с фолбэком на конфиг. Полноту покрытия конфигов проверяет тест.
 */
export const ru = {
  /* ==================== Приложение / статический каркас ==================== */
  'app.title': 'Orchard Peaks: уютный солитер',

  'hud.coins.tip': 'Баланс монет (сохраняется)',
  'hud.harvestBank.tip': 'Урожай для заказов сада (сохраняется)',
  'hud.level.tip': 'Текущий уровень n (растит взнос E(n) и множитель W(n))',
  'hud.level.label': 'Ур.',
  'hud.score.tip': 'Очки за уровень',
  'hud.score.label': 'Очки:',
  'hud.chain.tip': 'Серия подряд убранных карт',
  'hud.chain.label': 'Серия:',
  'hud.tableHarvest.tip': 'Урожай, собранный в этой раздаче',
  'hud.tableHarvest.label': '🍎 стол:',
  'hud.btn.garden': '🌳 Сад',
  'hud.btn.store': '💎 Магазин',
  'hud.btn.dash': '📊 KPI',
  'hud.btn.soft': '🚀 Soft',
  'hud.btn.soft.tip':
    'Soft-launch кокпит: симулятор экономики, A/B, тюнинг, гейты go/no-go (внутренний инструмент)',
  'hud.btn.restart': 'Новый расклад',
  'hud.progress.tip': 'Прогресс очистки стола',

  'boosterBar.aria': 'Бустеры',
  'booster.undo.tip': 'Отменить последний ход',
  'booster.undo.free': '↩ Отмена ({n})',
  'booster.undo.paid': '↩ Отмена (💰{price})',
  'booster.joker.tip': 'Джокер: убрать любую открытую карту',
  'booster.joker.count': '🃏 Джокер ({n})',
  'booster.basket.tip': 'Золотое лукошко: ×2 урожай за раздачу',
  'booster.basket.count': '🧺 Лукошко ({n})',
  'booster.basket.active': '🧺 ×2 активно',
  'booster.wallet.tip':
    'Кошелёк садовода (rewarded): пополнить монеты за просмотр рекламы — СИМУЛЯЦИЯ',
  'booster.wallet.label': '💰 Кошелёк',

  'table.stock.aria': 'Колода добора: открыть следующую карту',
  'table.stock.label': 'Колода',
  'table.waste.aria': 'Открытая карта сброса',
  'table.waste.label': 'Сброс',
  'table.hint.html':
    'Убирайте открытые карты на&nbsp;1 выше или ниже карты сброса.<br>' +
    'Туз и&nbsp;Король — соседи. Карты с&nbsp;🍎 дают урожай для сада.',

  'card.open.aria': 'Карта {card}',
  'card.closed.aria': 'Закрытая карта',
  /* Номиналы карт с буквой (2–10 — цифры в обеих локалях; ядро остаётся Т/В/Д/К). */
  'card.rank.1': 'Т',
  'card.rank.11': 'В',
  'card.rank.12': 'Д',
  'card.rank.13': 'К',

  /* ==================== Мета-экран: каркас ==================== */
  'meta.screen.aria': 'Сад и задания',
  'meta.back': '← Играть',
  'meta.coins.tip': 'Монеты',
  'meta.harvest.tip': 'Урожай для заказов',
  'meta.tab.garden': '🌳 Сад',
  'meta.tab.tasks': '🎯 Задания',
  'meta.tab.shop': '🛒 Лавка',
  'meta.tab.settings': '⚙️ Настройки',

  /* ==================== Игровые тосты (стол) ==================== */
  'game.toast.jokerOpenOnly': 'Джокер работает только по открытой карте',
  'game.toast.jokerUsed': '🃏 Джокер применён',
  'game.toast.jokerChoose': '🃏 Выберите любую открытую карту',
  'game.toast.nothingToUndo': 'Отменять нечего',
  'game.toast.noCoinsUndo': 'Нет монет на отмену (нужно {price})',
  'game.toast.undoFree': 'Ход отменён (бесплатно)',
  'game.toast.undoPaid': 'Ход отменён (−{price} 💰)',
  'game.toast.basketAlready': 'Лукошко уже включено',
  'game.toast.basketOn': '🧺 Урожай этой раздачи ×{mult}',
  'game.toast.secondChance': 'Второй шанс! Колода пополнена (+5 карт).',
  'game.toast.streakClaimed': 'Стрик засчитан!',

  /* ==================== Экран победы ==================== */
  'win.title': 'Стол чист!',
  'win.subtitle': 'Сад благодарит вас. Уровень {n} пройден.',
  'win.row.entry': 'Взнос за раздачу',
  'win.entry.free': 'бесплатно',
  'win.row.reward': 'Выигрыш W({n})',
  'win.row.stockBonus': 'Бонус колоды: {n} карт',
  'win.row.rw2': '📺 ×2 за рекламу (RW2)',
  'win.row.total': 'Итог монет за уровень',
  'win.row.harvest': 'Урожай: {n} 🍎{x2}',
  'win.row.balance': 'Баланс',
  'win.row.harvestBank': 'Урожай в саду',
  'win.metaCta': 'Урожай растёт — загляните в сад, чтобы продвинуть заказ.',

  'ad.simTag': 'СИМУЛЯЦИЯ',
  'ad.rw2.cta': '📺 ×2 награда за рекламу',
  'ad.rw2.done': '✓ Награда удвоена рекламой (RW2)',
  'ad.rw5.cta': '📺 ×2 жетоны ярмарки',
  'ad.rw1.cta': '📺 Второй шанс: +5 карт в колоду',

  'btn.toGarden': '🌳 В сад',
  'btn.playAgain': 'Играть ещё',
  'btn.tryAgain': 'Ещё раз',
  'btn.later': 'Позже',
  'btn.claim': 'Забрать',

  /* ==================== Экран поражения ==================== */
  'lose.title': 'Почти получилось!',
  'lose.subtitle': 'Стол был чист на {pct}%. Бисквит уверен: в следующий раз выйдет.',
  'lose.harvestKept': 'Урожай сохранён: +{n} 🍎 (уже в саду)',
  'lose.harvestNone': 'Урожай не сгорает — соберите 🍎 в новой раздаче.',
  'lose.balance': 'Баланс: 💰 {coins} · 🍎 {harvest}',

  /* ==================== Стрик-модалка на входе ==================== */
  'streak.title': 'Утренняя лейка',
  'streak.subtitle': 'День {d} подряд. Забирайте награду и продолжайте стрик.',
  'streak.reward': 'Награда: 💰 {coins}{extra}',
  'streak.extra.undo': ' +1 ундо',
  'streak.extra.joker': ' +джокер 🃏',
  'streak.extra.basket': ' +лукошко 🧺',

  /* ==================== Мета: тосты ==================== */
  'meta.toast.zoneDone': '🎉 Зона «{name}» готова! +💰 {bonus}',
  'meta.toast.orderDone': 'Заказ выполнен! Сад подрос.',
  'meta.toast.bought': 'Куплено: {name}',
  'meta.toast.missionClaimed': 'Награда за миссию получена!',
  'meta.toast.streakClaimed': 'Стрик засчитан! Лейка полна.',
  'meta.toast.newDay': 'Наступил новый день (тест).',

  /* ==================== Мета: вкладка «Сад» ==================== */
  'garden.allDone.title': '🎉 Весь сад расцвёл!',
  'garden.allDone.sub': 'Вы прошли все зоны прототипа. В полной игре — 12 зон и 240 уровней.',
  'garden.intro':
    'Заказы тратят 🍎 урожай (и иногда 💰 монеты), продвигают зону и открывают новую цель. ' +
    'Не хватает урожая — сыграйте ещё раздачу.',
  'garden.locked.teaser': 'Откроется, когда закончите «{name}»',
  'garden.order.need': 'Нужно:',
  'garden.order.rewardArrow': '→ награда',
  'garden.order.do': 'Выполнить заказ',
  'garden.order.noCoins': 'Не хватает монет',
  'garden.order.noHarvest': 'Не хватает урожая',
  'garden.zone.done': '✓ Зона готова — сад благодарит вас!',

  /* ==================== Мета: вкладка «Задания» ==================== */
  'tasks.streak.title': '🌅 Утренняя лейка — стрик',
  'tasks.streak.claim': 'Забрать день {d}: 💰 {coins}{extra}',
  'tasks.streak.extra.undo': ' +↩',
  'tasks.streak.extra.joker': ' +🃏',
  'tasks.streak.extra.basket': ' +🧺',
  'tasks.streak.claimed': 'Награда дня забрана. Возвращайтесь завтра — стрик продолжится.',
  'tasks.missions.daily': 'Дневные миссии',
  'tasks.missions.weekly': 'Миссия недели',
  'tasks.mission.claimed': '✓ Забрано (💰 {coins})',
  'tasks.mission.claim': 'Забрать 💰 {coins}',
  'tasks.mission.card': ' + карточка',
  'tasks.mission.reward': 'Награда: 💰 {coins}',
  'tasks.test.title': '🧪 Проверка петли',
  'tasks.test.note': 'Сдвиньте «сегодня» на день вперёд, чтобы увидеть стрик и сброс миссий.',
  'tasks.test.newDay': 'Новый день (тест)',

  /* ==================== Мета: вкладка «Лавка» ==================== */
  'lavka.intro': 'Бустеры покупаются за монеты и помогают в раскладах (05 §5.6).',
  'lavka.max': 'Максимум',
  'lavka.undo.name': 'Отмена хода',
  'lavka.undo.hint': 'Бесплатных: {n}. Далее — 💰 {price} за отмену прямо в раздаче.',

  'plan.title': '📊 Экономика: где вы на кривой',
  'plan.now':
    'Уровень <b>{n}</b> · взнос <b>💰 {e}</b> · выигрыш <b>💰 {w}</b> · множитель <b>×{m}</b>',
  'plan.note1':
    'Спроектированный путь баланса медианного игрока (05 §5.4): дни 1–4 — профицит ' +
    '(«медовый месяц»), день 5+ — плановое сползание в дефицит, день 12–16 — точка ' +
    'первого денежного решения.',
  'plan.th.day': 'День',
  'plan.th.level': 'Ур.',
  'plan.th.saldo': 'Сальдо/день',
  'plan.th.balance': 'Баланс',
  'plan.note2': '▲ строка ближе всего к вашему уровню ({note}).',
  'plan.d1.note': 'Медовый месяц: профицит по дизайну',
  'plan.d2.note': 'Игрок «богат», пробует бустеры',
  'plan.d3.note': 'Пик баланса близко',
  'plan.d4.note': 'Кривая выравнивается',
  'plan.d5.note': 'Первый дефицитный день',
  'plan.d7.note': 'Стрик-бонус дня 7 смягчает',
  'plan.d10.note': 'Баланс тает — спрос зреет',
  'plan.d14.note': 'Точка «Кошелька»: запас < 1 взноса',
  'plan.d21.note': 'Rewarded-кошелёк вошёл в рутину',
  'plan.d30.note': 'Стабильная «карусель» микродефицита',

  /* ==================== Мета: вкладка «Настройки» ==================== */
  'settings.lang.title': '🌐 Язык · Language',
  'settings.lang.note': 'Смена языка перезагружает страницу — прогресс и сейвы сохраняются.',
  'settings.lang.ru': 'Русский',
  'settings.lang.en': 'English',
  'settings.ftue.title': '❓ Обучение',
  'settings.ftue.note': 'Коуч-марки первого запуска можно пройти заново в любой момент.',
  'settings.ftue.replay': 'Пройти обучение снова',

  /* ==================== Магазин 💎 ==================== */
  'store.title': '💎 Магазин',
  'store.back': '← Играть',
  'store.simBanner':
    '⚠ СИМУЛЯЦИЯ: рекламные сети и биллинг НЕ подключены. Покупки не списывают денег, ' +
    '«показ рекламы» — экранная заглушка. В проде — AppLovin MAX / AdMob и сторы.',
  'store.h.rewarded': '🎁 Бесплатно за рекламу (rewarded)',
  'store.sub.rewarded':
    'Rewarded — доминанта модели (цель 65–70% рекламной выручки, 06 §6.1). ' +
    'Это бонусы по желанию: подписка и remove-ads их НЕ убирают.',
  'store.capLeft': 'осталось сегодня: {left}/{cap}',
  'store.capNone': 'без дневного лимита',
  'store.limit': 'Лимит',
  'store.cta.watch': 'Смотреть',
  'store.cta.spin': 'Крутить',
  'store.h.noads': '🚫 Без рекламы и подписка',
  'store.owned': 'Куплено ✓',
  'store.sub.month': 'мес {n}',
  'store.cancel': 'Отменить',
  'store.perMonth': '/мес',
  'store.h.piggy': '🐷 Копилка',
  'store.piggy.break': 'Вскрыть 💰',
  'store.piggy.from': 'от {n}',
  'store.h.coins': '🪙 Монеты и наборы',
  'store.sub.coins':
    'Персонализация номиналов — по E(n) игрока (06 §6.4). Цены США; в проде ' +
    'локализуются по матрице сторов.',
  'store.once': 'разово',
  'store.contents.cards': '{n} карт.',
  'store.foot': 'СИМУЛЯЦИЯ · выручка каждого показа/покупки уходит в дашборд «📊 KPI».',

  /* ==================== Тосты монетизации ==================== */
  'mon.toast.rwCap': 'Лимит этой награды на сегодня исчерпан',
  'mon.toast.wallet': 'Кошелёк садовода: +{n} 💰',
  'mon.toast.booster': 'Бустер за рекламу: +1 {emoji} {name}',
  'mon.toast.wheel': '🎡 Колесо ярмарки: +{n} 💰',
  'mon.toast.event': '×2 жетоны ярмарки: +{n} 💰',
  'mon.toast.onceOwned': 'Набор уже куплен (разовый)',
  'mon.toast.adsOwned': 'Реклама уже убрана',
  'mon.toast.piggyOwned': 'Копилка уже активна',
  'mon.toast.buy': 'СИМУЛЯЦИЯ покупки: {label} (${price})',
  'mon.toast.subCancel': 'Подписка отменена (декор сохранён)',
  'mon.toast.piggyBreak': 'Копилка вскрыта: +{n} 💰',

  /* ==================== Оверлей показа рекламы (симуляция) ==================== */
  'adov.simTag.rewarded': 'СИМУЛЯЦИЯ · REWARDED',
  'adov.simTag.interstitial': 'СИМУЛЯЦИЯ · INTERSTITIAL',
  'adov.note.prod': 'в проде здесь показ AppLovin MAX / AdMob',
  'adov.note.fail': 'Реклама не загрузилась (fill < 100%) — награды нет',
  'adov.btn.loading': 'Реклама…',
  'adov.btn.wait': 'Реклама… {s} c',
  'adov.btn.claim': 'Забрать награду ✓',
  'adov.btn.close': 'Закрыть ✕',
  'adov.btn.closePlain': 'Закрыть',

  /* ==================== Конфиги: бустеры (econ.ts) ==================== */
  'booster.joker.name': 'Джокер',
  'booster.joker.hint': 'Убрать любую открытую карту — «страховка» серии',
  'booster.basket.name': 'Золотое лукошко',
  'booster.basket.hint': '×2 урожай за раздачу — растит сад быстрее',

  /* ==================== Конфиги: миссии (econ.ts) ==================== */
  'mission.d_harvest.text': 'Соберите 25 🍎 урожая',
  'mission.d_chain.text': 'Соберите серию из 5 карт',
  'mission.d_order.text': 'Выполните заказ в саду',
  'mission.w_wins.text': 'Выиграйте 12 уровней за неделю',

  /* ==================== Конфиги: зоны и заказы (meta/config.ts) ==================== */
  'zone.porch.name': 'Крыльцо',
  'zone.porch.scene': 'Дощатое крыльцо тётиного дома',
  'zone.beds.name': 'Клумбы',
  'zone.beds.scene': 'Полоса клумб вдоль забора',
  'zone.garden.name': 'Огород',
  'zone.garden.scene': 'Огород за домом',
  'zone.greenhouse.name': 'Теплица',
  'zone.greenhouse.scene': 'Стеклянная теплица у пруда',

  'order.porch.0.title': 'Расчистить дорожку',
  'order.porch.1.title': 'Повесить фонарик',
  'order.porch.2.title': 'Починить скамейку',
  'order.porch.3.title': 'Посадить герань у входа',
  'order.beds.0.title': 'Вскопать клумбу',
  'order.beds.1.title': 'Посадить лаванду',
  'order.beds.2.title': 'Высадить тюльпаны',
  'order.beds.3.title': 'Поставить бордюр',
  'order.garden.0.title': 'Разметить грядки',
  'order.garden.1.title': 'Посадить морковь',
  'order.garden.2.title': 'Посадить томаты',
  'order.garden.3.title': 'Собрать первый урожай',
  'order.greenhouse.0.title': 'Собрать каркас',
  'order.greenhouse.1.title': 'Вставить стёкла',
  'order.greenhouse.2.title': 'Высадить рассаду',
  'order.greenhouse.3.title': 'Запустить полив',

  /* ==================== Конфиги: плейсменты (monetize/config.ts) ==================== */
  'placement.RW1.name': 'Второй шанс',
  'placement.RW1.desc': 'Продолжить уровень из тупика (стол ≥ 60% чист)',
  'placement.RW2.name': 'Удвоить награду',
  'placement.RW2.desc': '×2 монеты за пройденный уровень',
  'placement.RW3.name': 'Бустер до уровня',
  'placement.RW3.desc': 'Бесплатный бустер в раздачу',
  'placement.RW4.name': 'Колесо ярмарки',
  'placement.RW4.desc': 'Крутить колесо за бонус монет',
  'placement.RW5.name': '×2 жетоны ярмарки',
  'placement.RW5.desc': 'Удвоить жетоны ивента (пт–вс)',
  'placement.RW6.name': 'Кошелёк садовода',
  'placement.RW6.desc': 'Пополнить монеты, когда баланс мал',
  'placement.INT1.name': 'Межуровневый',
  'placement.INT1.desc': 'Возврат на карту сада после победы',

  /* ==================== Конфиги: полка IAP (monetize/config.ts) ==================== */
  /* Ключи note создаются только для непустых note конфига. */
  'iap.coins_s.label': 'Горсть монет',
  'iap.coins_s.note': 'Порог входа, импульс',
  'iap.starter_pack.label': 'Стартовый набор',
  'iap.starter_pack.note': 'Разово, окно D3–D21 · главный конвертер 1-го платежа',
  'iap.piggy_greenhouse.label': 'Теплица-копилка',
  'iap.piggy_greenhouse.note': 'Копит 5% выигрышей · вскрытие от 4000 · cap 15000',
  'iap.coins_m.label': 'Кошель монет',
  'iap.coins_m.note': 'Рабочая лошадка',
  'iap.remove_ads.label': 'Убрать рекламу',
  'iap.remove_ads.note': 'Навсегда · убирает interstitial (rewarded остаются) +500💰',
  'iap.club_month.label': 'Клуб садовода',
  'iap.club_month.note': 'Подписка/мес · без INT · +50% урожая · 500💰/день',
  'iap.coins_l.label': 'Сундук монет',
  'iap.coins_l.note': 'Основной объём выручки',
  'iap.almanac_premium.label': 'Premium-альманах',
  'iap.almanac_premium.note': 'Сезонный трек альманаха',
  'iap.coins_xl.label': 'Кит-лайт',
  'iap.event_bundle.label': 'Ивентовый набор',
  'iap.event_bundle.note': 'Ротация номиналов по E(n)',
  'iap.coins_xxl.label': 'Кит',
  'iap.coins_max.label': 'Топ-кит «Фонтан Марты»',
  'iap.coins_max.note': 'Статус в лиге',

  /* ==================== FTUE-онбординг ==================== */
  'onb.aria': 'Обучение Orchard Peaks',
  'onb.stepLabel': 'Шаг {cur} из {total}',
  'onb.next': 'Далее',
  'onb.back': '← Назад',
  'onb.skip': 'Пропустить обучение',
  'onb.s1.title': 'Добро пожаловать в сад',
  'onb.s1.body':
    'Вам достался в наследство запущенный сад тёти Марты — с теплицей, прудом и ' +
    'пасекой. Каждая партия в солитере — это день работы в саду. Пёс Бисквит уже ' +
    'ждёт. Давайте разложим первую партию.',
  'onb.s1.cta': 'Показать, как играть',
  'onb.s2.title': 'Главное правило: на 1 выше или ниже',
  'onb.s2.body':
    'Внизу лежит карта сброса. Убирайте со стола любую открытую карту, чей номинал ' +
    'на 1 больше или на 1 меньше её. Туз и Король — соседи, круг замыкается. ' +
    'Ошиблись — кнопка «↩ Отмена» простит.',
  'onb.s3.title': 'Нет хода — берите из колоды',
  'onb.s3.body':
    'Если подходящей карты на столе нет, откройте новую из колоды слева. Спешить ' +
    'некуда: здесь нет таймеров и штрафов за паузу. Играйте в своём темпе, хоть ' +
    'с чашкой кофе.',
  'onb.s4.title': 'Серия и множитель',
  'onb.s4.body':
    'Убирайте карты подряд, не заглядывая в колоду — растёт серия, а с ней ' +
    'множитель наград. Чем длиннее цепочка, тем больше монет за партию. Мягкое ' +
    'золотое свечение подскажет, что серия пошла.',
  'onb.s5.title': 'Карты урожая — зачем нужен сад',
  'onb.s5.body':
    'Карты со значком 🍎 приносят урожай. Урожай — не очки: это то, чем вы ' +
    'оживляете сад. Он копится в корзине наверху и сохраняется, даже если партия ' +
    'не сложилась.',
  'onb.s6.title': 'Первый заказ сада',
  'onb.s6.body':
    'Откройте «🌳 Сад» и выполните первый заказ — «расчистить крыльцо». Урожай ' +
    'уходит в заказ, крыльцо преображается на глазах, а следом открывается новая ' +
    'клумба. Так растёт вся история сада.',
  'onb.s7.title': 'Готово — сад ваш',
  'onb.s7.body':
    'Вот и всё, что нужно для начала. Играйте спокойно, в удобном ритме. Захотите ' +
    'освежить правила — откройте «🌳 Сад» → «⚙️ Настройки» и нажмите «Пройти ' +
    'обучение снова». Доброго урожая!',
  'onb.s7.cta': 'Начать играть'
} as const;

/** Канонический тип ключа перевода — выводится из русского словаря. */
export type TranslationKey = keyof typeof ru;
