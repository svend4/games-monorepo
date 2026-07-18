/**
 * Русский словарь UI (Проход Ж.1). ЭТАЛОН НАБОРА КЛЮЧЕЙ: тип TranslationKey
 * выводится из этого объекта, а словарь en.ts обязан покрыть его целиком
 * (satisfies Record<TranslationKey, string> — компилятор ловит и пропуски,
 * и лишние ключи). Плейсхолдеры вида {name} подставляет t() из index.ts.
 *
 * Терминология — из prototype/store-listing.md: «Прилив» (Surge),
 * кристальная бомба (Crystal Block), карта «Путешествия» (Journey Map),
 * бустеры Отмена/Обмен/Молот (Undo/Swap/Hammer).
 */

export const ru = {
  /* ============================ HUD партии ============================ */
  'hud.scoreLabel': 'ОЧКИ',
  'hud.best': 'Рекорд {best}',
  'hud.restart': '↻ Заново',
  'hud.comboNone': 'Комбо —',
  'hud.comboStarted': 'Серия начата…',
  'hud.comboActive': 'Комбо ×{mult} · серия {chain}',
  'hud.surge': 'Прилив {pct}%',

  /* ====================== Партия: флоаты и тосты ====================== */
  'game.float.combo': 'Комбо ×{mult}',
  'game.float.cleanBoard': 'Чистое поле +{bonus}',
  'game.toast.surgeReady': '💎 Прилив! Кристальная бомба в доке',

  /* ============================ Док фигур ============================= */
  'dock.bombLabel': 'бомба 3×3',
  'dock.bombHint1': 'заполни',
  'dock.bombHint2': '«Прилив»',

  /* ========================= Экран результата ======================== */
  'over.title': 'Партия окончена',
  'over.newRecord': '🏆 Новый рекорд!',
  'over.scoreLabel': 'Очки',
  'over.bestLabel': 'Рекорд',
  'over.starsLabel': 'Звёзды партии',
  'over.coinsLabel': 'Монеты за партию',
  'over.coinsValue': '+{coins} 🪙',
  'over.coinsValueDoubled': '+{coins} 🪙 (×2)',
  'over.revive': '💚 Второй шанс (реклама)',
  'over.doubleCoins': '💰 ×2 монеты за партию (реклама)',
  'over.again': 'Играть снова',
  'over.toMeta': '🗺️ Карта и награды',

  /* ===================== Покупка бустеров (тосты) ===================== */
  'toast.boosterBought': 'Куплен «{name}»',
  'toast.boosterBoughtPrice': 'Куплен «{name}» за {price}🪙',
  'toast.notEnoughCoins': 'Недостаточно монет ({price}🪙)',

  /* ==================== Бустеры: имена и подсказки ==================== */
  'booster.undo.name': 'Отмена',
  'booster.undo.hint': 'Отменить последний ход',
  'booster.swap.name': 'Обмен',
  'booster.swap.hint': 'Новая тройка фигур',
  'booster.hammer.name': 'Молот',
  'booster.hammer.hint': 'Убрать одну клетку поля',

  /* ===================== Бустеры: тосты применения ==================== */
  'booster.toast.gameOver': 'Партия окончена',
  'booster.toast.nothingToUndo': 'Отменять нечего',
  'booster.toast.undone': 'Ход отменён',
  'booster.toast.swapped': 'Фигуры заменены',
  'booster.toast.hammerArmed': 'Молот: коснись клетки поля',
  'booster.toast.hammerCancelled': 'Молот отменён',
  'booster.toast.emptyCell': 'Пустая клетка',
  'booster.toast.cellRemoved': 'Клетка убрана',

  /* ============================== Топбар ============================== */
  'topbar.meta': '🗺️ Мета',
  'topbar.shopTitle': 'Магазин (СИМУЛЯЦИЯ)',
  'topbar.dashTitle': 'Дашборд монетизации',
  'topbar.cockpitTitle': 'Soft-launch кокпит',

  /* ============================ Мета-экран ============================ */
  'meta.close': '← В игру',
  'meta.map.title': '🗺️ Карта «Путешествия»',
  'meta.map.note': 'Копи ★ за партии (по очкам) — открывай узлы и забирай награды.',
  'meta.map.node': 'Узел {id}',
  'meta.map.boss': ' · Босс',
  'meta.map.claim': 'Забрать',
  'meta.map.claimed': '✓ получено',
  'meta.map.locked': '🔒 нужно {stars}★',
  'meta.shop.title': '🛒 Магазин бустеров',
  'meta.shop.note': 'Трать монеты на инструменты спасения. Их же можно докупать прямо в партии.',
  'meta.shop.owned': 'в наличии: {n}',
  'meta.missions.title': '🎯 Ежедневные миссии',
  'meta.missions.note': '3 миссии в день с ротацией. Прогресс считается по ходам партии.',
  'meta.missions.done': '✓ выполнено',
  'meta.missions.bonus': 'Все 3 миссии → бонус-сундук +{bonus}🪙',
  'meta.streak.title': '🔥 Серия дней',
  'meta.streak.count': 'Серия: {n} дн.',
  'meta.streak.day': 'Д{n}',
  'meta.streak.claim': 'Получить награду дня',
  'meta.streak.claimed': 'Награда дня получена',
  'meta.streak.simDay': '⏭ Новый день (тест)',
  'meta.ads.title': '📺 Реклама (СИМУЛЯЦИЯ)',
  'meta.ads.rw3': '🔨 Бустер за рекламу (RW-3)',
  'meta.ads.rw4': '🔥 ×2 награда дня (RW-4)',

  /* ============================ Настройки ============================= */
  'settings.title': '⚙️ Настройки',
  'settings.language': 'Язык',
  'settings.reloadNote': 'Смена языка перезагружает игру — прогресс не теряется.',
  'settings.brightness': 'Яркость фона',
  'settings.brightnessDark': 'Тёмный',
  'settings.brightnessLight': 'Светлее',
  'settings.sound': 'Звук',
  'settings.soundOn': '🔊 Вкл',
  'settings.soundOff': '🔇 Выкл',
  'settings.replayFtue': '🎓 Пройти обучение снова',

  /* ========================= Тосты меты =============================== */
  'meta.toast.missionDone': 'Миссия выполнена: +{reward}🪙',
  'meta.toast.allMissions': 'Все миссии дня! Бонус-сундук +{bonus}🪙',
  'meta.toast.nodeClaimed': 'Узел {id}: {parts}',
  'meta.toast.streakClaimed': 'Серия, день {day}: {parts}',
  'meta.toast.newDay': 'Наступил новый день (тест). День +1',

  /* ========================== Миссии дня ============================== */
  'mission.lines20': 'Очисти 20 линий',
  'mission.lines35': 'Очисти 35 линий',
  'mission.combo3': 'Собери комбо ×3',
  'mission.games2': 'Сыграй 2 партии',
  'mission.score25': 'Набери 2500 очков за партию',
  'mission.clean1': 'Собери «чистое поле»',

  /* ========================== Магазин IAP ============================= */
  'shop.title': '🛒 Магазин (СИМУЛЯЦИЯ)',
  'shop.note':
    '«Покупка» — мгновенная выдача без денег и платёжных провайдеров. ' +
    'В проде здесь StoreKit / Google Play Billing (06 §5, 10 §2).',
  'shop.active': '✓ активно',
  'shop.status.sim': 'СИМУЛЯЦИЯ',
  'shop.status.adsRemoved': '🚫 Реклама убрана',
  'shop.status.adsOn': '📺 Реклама включена',
  'shop.status.subActive': '⭐ Подписка активна',
  'shop.status.subNone': 'Без подписки',
  'shop.status.skins': '🎨 скинов: {n}',

  /* ==================== Полка IAP (11 SKU, 06 §5) ===================== */
  'iap.starter.title': 'Стартовый набор',
  'iap.starter.desc': '600 монет + Молот · окно D3–D10, одноразовый',
  'iap.starter.badge': 'ЛУЧШИЙ СТАРТ',
  'iap.coins_s.title': 'Пак монет S',
  'iap.coins_s.desc': '1 200 монет · импульсная докупка',
  'iap.piggy.title': 'Копилка',
  'iap.piggy.desc': 'до 3 000 монет · «свои жалко»',
  'iap.remove_ads.title': 'Remove Ads',
  'iap.remove_ads.desc': 'Навсегда убирает interstitial + баннер (rewarded остаётся)',
  'iap.remove_ads.badge': 'ГЛАВНЫЙ SKU',
  'iap.season_pass.title': 'Season Pass',
  'iap.season_pass.desc': 'Платная ветка трека + 1 000 монет + 3 бустера',
  'iap.coins_m.title': 'Пак M',
  'iap.coins_m.desc': '3 500 монет + 2 бустера',
  'iap.coins_l.title': 'Пак L',
  'iap.coins_l.desc': '8 000 монет + 5 бустеров',
  'iap.coins_xl.title': 'Пак XL',
  'iap.coins_xl.desc': '18 000 монет + 12 бустеров + эксклюзивный скин',
  'iap.coins_xxl.title': 'Пак XXL',
  'iap.coins_xxl.desc': '50 000 монет + 30 бустеров · хвост китов',
  'iap.mega.title': 'Мега-сундук сезона',
  'iap.mega.desc': '110 000 монет + все скины сезона + рамка профиля',
  'iap.mega.badge': 'ЯКОРЬ',
  'iap.sub.title': 'Подписка Surge Premium',
  'iap.sub.desc': 'No ads + 200 монет/день + эксклюзивная тема (в мес)',
  'iap.sub.badge': 'ПОДПИСКА',

  /* ===================== Тосты/статусы монетизации ==================== */
  'mon.toast.intCounted': 'Interstitial засчитан · +${rev}',
  'mon.toast.gameRunning': 'Партия ещё идёт',
  'mon.toast.reviveUsed': '«Второй шанс» уже использован в этой партии',
  'mon.toast.revived': '💚 Поле освобождено — играй дальше!',
  'mon.toast.rw2Limit': 'Лимит «×2 монеты» на сегодня исчерпан',
  'mon.toast.rw2Done': '💰 +{bonus}🪙 (×2 монеты за партию)',
  'mon.toast.rw3Limit': 'Лимит бесплатных бустеров на сегодня',
  'mon.toast.rw3Done': '🔨 +1 Молот (бесплатно за rewarded)',
  'mon.toast.rw4Limit': 'Лимит «×2 награда» на сегодня',
  'mon.toast.rw4Done': '🔥 +{bonus}🪙 (×2 награда дня)',
  'mon.toast.purchased': 'СИМУЛЯЦИЯ: куплено «{title}» · ${price}',
  'mon.status.rewarded': 'Сегодня rewarded: RW-3 {rw3}/{rw3cap} · RW-4 {rw4}/{rw4cap}',
  'mon.status.noAds': ' · 🚫 INT+BAN убраны',

  /* =================== Оверлей показа рекламы (сим) =================== */
  'adsim.badge': 'СИМУЛЯЦИЯ — реальной рекламы нет',
  'adsim.sec': 'сек',
  'adsim.skip': 'Пропустить ✕',
  'adsim.close': 'Закрыть ✕',
  'adsim.claim': 'Забрать награду 🎁',
  'adsim.title.int2': 'Interstitial · INT-2 (между партиями)',
  'adsim.title.rw1': 'Rewarded · RW-1 «Второй шанс»',
  'adsim.title.rw2': 'Rewarded · RW-2 «×2 монеты за партию»',
  'adsim.title.rw3': 'Rewarded · RW-3 «Бесплатный бустер»',
  'adsim.title.rw4': 'Rewarded · RW-4 «×2 награда дня»',
  'adsim.titlePrefix.int': 'Interstitial · ',
  'adsim.titlePrefix.rw': 'Rewarded · ',
  'adsim.pitch.rw1': 'Досмотри — освободим место на поле и продолжим партию.',
  'adsim.pitch.rw2': 'Досмотри — удвоим монеты, заработанные в этой партии.',
  'adsim.pitch.rw3': 'Досмотри — получи бустер Молот бесплатно.',
  'adsim.pitch.rw4': 'Досмотри — удвой бонус дня / спаси серию (100 монет).',
  'adsim.pitch.default': 'В проде здесь крутится реальная сеть: AppLovin MAX / AdMob (06 §8).',
  'adsim.ecpm': 'eCPM ({geo}): ${value} / 1000',

  /* ======================= Баннер BAN-1 (сим) ========================= */
  'banner.sim': 'СИМУЛЯЦИЯ',
  'banner.label': 'Рекламный баннер · BAN-1',
  'banner.ecpm': 'eCPM ${value} · {geo}',

  /* ==================== Гео-корзины симуляции ========================= */
  'geo.tier1': 'Tier-1 (US/JP/DE/UK)',
  'geo.blend': 'Бленд 60/40',
  'geo.tier23': 'Tier-2/3',

  /* ==================== FTUE-онбординг (07 §3) ======================== */
  'ftue.tag': 'Обучение · первые 5 минут (07 §3)',
  'ftue.stepMeta': 'Шаг {n} из {total} · {meta}',
  'ftue.skip': 'Пропустить',
  'ftue.back': '← Назад',
  'ftue.next': 'Далее →',
  'ftue.done': 'Готово · играть ▶',
  'ftue.step.shapes.meta': '07 §3 · шаги 1–2 · 0:00–0:05',
  'ftue.step.shapes.title': 'Клади фигуры на поле',
  'ftue.step.shapes.text':
    'Внизу — твоя рука из фигур. Перетащи любую на сетку 8×8. Зелёная подсветка — ' +
    'сюда можно, красная — нельзя. Ни регистраций, ни таймеров: играем сразу и без спешки.',
  'ftue.step.line.meta': '07 §3 · шаги 3–4 · 0:20–0:45',
  'ftue.step.line.title': 'Собирай ряды и столбцы',
  'ftue.step.line.text':
    'Заполни ряд или столбец целиком — он очистится и освободит место под новые фигуры. ' +
    'Это весь цикл: собрал линию → получил очки и монеты. Ошибиться не страшно, поле прощает.',
  'ftue.step.surge.meta': '07 §3 · шаги 5–6 · 2:30',
  'ftue.step.surge.title': 'Комбо заряжает «Прилив»',
  'ftue.step.surge.text':
    'Очистки в ходах подряд дают комбо ×2 · ×3 · ×5 и заполняют шкалу «Прилив» вот здесь, ' +
    'сверху. Планировать цепочки очисток — главный навык Block Surge.',
  'ftue.step.crystal.meta': '07 §3 · шаг 7 · 3:00–4:30',
  'ftue.step.crystal.title': 'Полный «Прилив» → кристалл',
  'ftue.step.crystal.text':
    'Когда шкала заполнится, в четвёртое гнездо дока придёт кристальная бомба. Перетащи её ' +
    'на поле — она взорвёт область 3×3 и добавит очков. Это кульминация партии.',
  'ftue.step.coins.meta': '07 §3 · шаг 8 · 4:30',
  'ftue.step.coins.title': 'Монеты и награды',
  'ftue.step.coins.text':
    'За очистки, комбо и партии капают монеты — счётчик слева вверху. На них берут ' +
    'бустеры-спасатели, а карта «Путешествия», серия дней и ежедневные миссии ждут в меню «Мета».',
  'ftue.step.ads.meta': '06 §3 · 07 §3 (минуты 5–10)',
  'ftue.step.ads.title': 'Реклама — по желанию и позже',
  'ftue.step.ads.text':
    'Ролики за награду («Второй шанс», «×2 монеты», бесплатный бустер) — всегда добровольны ' +
    'и всегда выгодны. Первый такой ролик появится, только когда ты освоишь правила; реклама ' +
    'между партиями — не раньше 6-го уровня и 8-й минуты. Никаких фейковых крестиков.'
} as const;

/** Общий тип ключей обеих локалей (эталон — русский словарь). */
export type TranslationKey = keyof typeof ru;
