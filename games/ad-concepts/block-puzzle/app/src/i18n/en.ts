/**
 * English UI dictionary (Проход Ж.1). Покрытие ключей гарантирует компилятор:
 * `satisfies Record<TranslationKey, string>` — пропуск ключа или лишний ключ
 * не соберутся. Терминология — из prototype/store-listing.md (EN-листинг):
 * Surge, Crystal Block, Journey Map, boosters Undo/Swap/Hammer, clean board.
 */
import type { TranslationKey } from './ru';

export const en = {
  /* ============================ HUD партии ============================ */
  'hud.scoreLabel': 'SCORE',
  'hud.best': 'Best {best}',
  'hud.restart': '↻ Restart',
  'hud.comboNone': 'Combo —',
  'hud.comboStarted': 'Chain started…',
  'hud.comboActive': 'Combo ×{mult} · chain {chain}',
  'hud.surge': 'Surge {pct}%',

  /* ====================== Партия: флоаты и тосты ====================== */
  'game.float.combo': 'Combo ×{mult}',
  'game.float.cleanBoard': 'Clean board +{bonus}',
  'game.toast.surgeReady': '💎 Surge! Crystal Block is in the dock',

  /* ============================ Док фигур ============================= */
  'dock.bombLabel': '3×3 blast',
  'dock.bombHint1': 'fill the',
  'dock.bombHint2': 'Surge bar',

  /* ========================= Экран результата ======================== */
  'over.title': 'Game over',
  'over.newRecord': '🏆 New best score!',
  'over.scoreLabel': 'Score',
  'over.bestLabel': 'Best',
  'over.starsLabel': 'Stars this run',
  'over.coinsLabel': 'Coins this run',
  'over.coinsValue': '+{coins} 🪙',
  'over.coinsValueDoubled': '+{coins} 🪙 (×2)',
  'over.revive': '💚 Second Chance (ad)',
  'over.doubleCoins': '💰 ×2 coins for this run (ad)',
  'over.again': 'Play again',
  'over.toMeta': '🗺️ Map & rewards',

  /* ===================== Покупка бустеров (тосты) ===================== */
  'toast.boosterBought': '{name} purchased',
  'toast.boosterBoughtPrice': '{name} purchased for {price}🪙',
  'toast.notEnoughCoins': 'Not enough coins ({price}🪙)',

  /* ==================== Бустеры: имена и подсказки ==================== */
  'booster.undo.name': 'Undo',
  'booster.undo.hint': 'Undo your last move',
  'booster.swap.name': 'Swap',
  'booster.swap.hint': 'Get a fresh set of pieces',
  'booster.hammer.name': 'Hammer',
  'booster.hammer.hint': 'Remove one cell from the board',

  /* ===================== Бустеры: тосты применения ==================== */
  'booster.toast.gameOver': 'The run is over',
  'booster.toast.nothingToUndo': 'Nothing to undo',
  'booster.toast.undone': 'Move undone',
  'booster.toast.swapped': 'Pieces swapped',
  'booster.toast.hammerArmed': 'Hammer: tap a cell on the board',
  'booster.toast.hammerCancelled': 'Hammer cancelled',
  'booster.toast.emptyCell': 'That cell is empty',
  'booster.toast.cellRemoved': 'Cell removed',

  /* ============================== Топбар ============================== */
  'topbar.meta': '🗺️ Meta',
  'topbar.shopTitle': 'Shop (SIMULATION)',
  'topbar.dashTitle': 'Monetization dashboard',
  'topbar.cockpitTitle': 'Soft-launch cockpit',

  /* ============================ Мета-экран ============================ */
  'meta.close': '← Back to game',
  'meta.map.title': '🗺️ Journey Map',
  'meta.map.note': 'Earn ★ from runs (by score) — unlock nodes and claim rewards.',
  'meta.map.node': 'Node {id}',
  'meta.map.boss': ' · Boss',
  'meta.map.claim': 'Claim',
  'meta.map.claimed': '✓ claimed',
  'meta.map.locked': '🔒 need {stars}★',
  'meta.shop.title': '🛒 Booster Shop',
  'meta.shop.note': 'Spend coins on rescue tools. You can also buy them mid-run.',
  'meta.shop.owned': 'owned: {n}',
  'meta.missions.title': '🎯 Daily Missions',
  'meta.missions.note': 'Three missions a day, rotating. Progress counts as you play.',
  'meta.missions.done': '✓ done',
  'meta.missions.bonus': 'All 3 missions → bonus chest +{bonus}🪙',
  'meta.streak.title': '🔥 Daily Streak',
  'meta.streak.count': 'Streak: {n} days',
  'meta.streak.day': 'D{n}',
  'meta.streak.claim': 'Claim daily reward',
  'meta.streak.claimed': 'Daily reward claimed',
  'meta.streak.simDay': '⏭ Next day (test)',
  'meta.ads.title': '📺 Ads (SIMULATION)',
  'meta.ads.rw3': '🔨 Booster for an ad (RW-3)',
  'meta.ads.rw4': '🔥 ×2 daily reward (RW-4)',

  /* ============================ Настройки ============================= */
  'settings.title': '⚙️ Settings',
  'settings.language': 'Language',
  'settings.reloadNote': 'Changing the language reloads the game — no progress is lost.',
  'settings.brightness': 'Background brightness',
  'settings.brightnessDark': 'Dark',
  'settings.brightnessLight': 'Lighter',
  'settings.sound': 'Sound',
  'settings.soundOn': '🔊 On',
  'settings.soundOff': '🔇 Off',
  'settings.replayFtue': '🎓 Replay the tutorial',

  /* ========================= Тосты меты =============================== */
  'meta.toast.missionDone': 'Mission complete: +{reward}🪙',
  'meta.toast.allMissions': 'All daily missions done! Bonus chest +{bonus}🪙',
  'meta.toast.nodeClaimed': 'Node {id}: {parts}',
  'meta.toast.streakClaimed': 'Streak day {day}: {parts}',
  'meta.toast.newDay': 'A new day begins (test). Day +1',

  /* ========================== Миссии дня ============================== */
  'mission.lines20': 'Clear 20 lines',
  'mission.lines35': 'Clear 35 lines',
  'mission.combo3': 'Reach a ×3 combo',
  'mission.games2': 'Play 2 runs',
  'mission.score25': 'Score 2,500 points in one run',
  'mission.clean1': 'Get a clean board',

  /* ========================== Магазин IAP ============================= */
  'shop.title': '🛒 Shop (SIMULATION)',
  'shop.note':
    '“Purchases” are instant grants — no money, no payment providers. ' +
    'In production this is StoreKit / Google Play Billing (06 §5, 10 §2).',
  'shop.active': '✓ active',
  'shop.status.sim': 'SIMULATION',
  'shop.status.adsRemoved': '🚫 Ads removed',
  'shop.status.adsOn': '📺 Ads enabled',
  'shop.status.subActive': '⭐ Subscription active',
  'shop.status.subNone': 'No subscription',
  'shop.status.skins': '🎨 skins: {n}',

  /* ==================== Полка IAP (11 SKU, 06 §5) ===================== */
  'iap.starter.title': 'Starter Pack',
  'iap.starter.desc': '600 coins + Hammer · D3–D10 window, one-time',
  'iap.starter.badge': 'BEST START',
  'iap.coins_s.title': 'Coin Pack S',
  'iap.coins_s.desc': '1,200 coins · impulse top-up',
  'iap.piggy.title': 'Piggy Bank',
  'iap.piggy.desc': 'up to 3,000 coins · savings you hate to lose',
  'iap.remove_ads.title': 'Remove Ads',
  'iap.remove_ads.desc': 'Removes interstitials + banner forever (rewarded stays)',
  'iap.remove_ads.badge': 'FLAGSHIP SKU',
  'iap.season_pass.title': 'Season Pass',
  'iap.season_pass.desc': 'Paid track tier + 1,000 coins + 3 boosters',
  'iap.coins_m.title': 'Pack M',
  'iap.coins_m.desc': '3,500 coins + 2 boosters',
  'iap.coins_l.title': 'Pack L',
  'iap.coins_l.desc': '8,000 coins + 5 boosters',
  'iap.coins_xl.title': 'Pack XL',
  'iap.coins_xl.desc': '18,000 coins + 12 boosters + exclusive skin',
  'iap.coins_xxl.title': 'Pack XXL',
  'iap.coins_xxl.desc': '50,000 coins + 30 boosters · whale tail',
  'iap.mega.title': 'Season Mega Chest',
  'iap.mega.desc': '110,000 coins + all season skins + profile frame',
  'iap.mega.badge': 'ANCHOR',
  'iap.sub.title': 'Surge Premium subscription',
  'iap.sub.desc': 'No ads + 200 coins/day + exclusive theme (monthly)',
  'iap.sub.badge': 'SUBSCRIPTION',

  /* ===================== Тосты/статусы монетизации ==================== */
  'mon.toast.intCounted': 'Interstitial counted · +${rev}',
  'mon.toast.gameRunning': 'The run is still going',
  'mon.toast.reviveUsed': 'Second Chance already used this run',
  'mon.toast.revived': '💚 Board cleared up — keep playing!',
  'mon.toast.rw2Limit': 'Daily limit for “×2 coins” reached',
  'mon.toast.rw2Done': '💰 +{bonus}🪙 (×2 coins for this run)',
  'mon.toast.rw3Limit': 'Daily limit for free boosters reached',
  'mon.toast.rw3Done': '🔨 +1 Hammer (free for a rewarded ad)',
  'mon.toast.rw4Limit': 'Daily limit for “×2 reward” reached',
  'mon.toast.rw4Done': '🔥 +{bonus}🪙 (×2 daily reward)',
  'mon.toast.purchased': 'SIMULATION: purchased “{title}” · ${price}',
  'mon.status.rewarded': 'Rewarded today: RW-3 {rw3}/{rw3cap} · RW-4 {rw4}/{rw4cap}',
  'mon.status.noAds': ' · 🚫 INT+BAN removed',

  /* =================== Оверлей показа рекламы (сим) =================== */
  'adsim.badge': 'SIMULATION — no real ads',
  'adsim.sec': 'sec',
  'adsim.skip': 'Skip ✕',
  'adsim.close': 'Close ✕',
  'adsim.claim': 'Claim reward 🎁',
  'adsim.title.int2': 'Interstitial · INT-2 (between runs)',
  'adsim.title.rw1': 'Rewarded · RW-1 “Second Chance”',
  'adsim.title.rw2': 'Rewarded · RW-2 “×2 coins for the run”',
  'adsim.title.rw3': 'Rewarded · RW-3 “Free booster”',
  'adsim.title.rw4': 'Rewarded · RW-4 “×2 daily reward”',
  'adsim.titlePrefix.int': 'Interstitial · ',
  'adsim.titlePrefix.rw': 'Rewarded · ',
  'adsim.pitch.rw1': 'Watch to the end — we free up the board and the run continues.',
  'adsim.pitch.rw2': 'Watch to the end — we double the coins earned this run.',
  'adsim.pitch.rw3': 'Watch to the end — get a free Hammer booster.',
  'adsim.pitch.rw4': 'Watch to the end — double the daily bonus / save your streak (100 coins).',
  'adsim.pitch.default': 'In production a real network runs here: AppLovin MAX / AdMob (06 §8).',
  'adsim.ecpm': 'eCPM ({geo}): ${value} / 1000',

  /* ======================= Баннер BAN-1 (сим) ========================= */
  'banner.sim': 'SIMULATION',
  'banner.label': 'Ad banner · BAN-1',
  'banner.ecpm': 'eCPM ${value} · {geo}',

  /* ==================== Гео-корзины симуляции ========================= */
  'geo.tier1': 'Tier-1 (US/JP/DE/UK)',
  'geo.blend': 'Blend 60/40',
  'geo.tier23': 'Tier-2/3',

  /* ==================== FTUE-онбординг (07 §3) ======================== */
  'ftue.tag': 'Tutorial · first 5 minutes (07 §3)',
  'ftue.stepMeta': 'Step {n} of {total} · {meta}',
  'ftue.skip': 'Skip',
  'ftue.back': '← Back',
  'ftue.next': 'Next →',
  'ftue.done': 'Done · play ▶',
  'ftue.step.shapes.meta': '07 §3 · steps 1–2 · 0:00–0:05',
  'ftue.step.shapes.title': 'Place pieces on the board',
  'ftue.step.shapes.text':
    'The row at the bottom is your hand of pieces. Drag any of them onto the 8×8 grid. ' +
    'A green glow means it fits, red means it does not. No sign-ups, no timers: ' +
    'you play right away, at your own pace.',
  'ftue.step.line.meta': '07 §3 · steps 3–4 · 0:20–0:45',
  'ftue.step.line.title': 'Clear rows and columns',
  'ftue.step.line.text':
    'Fill a whole row or column and it clears, freeing space for new pieces. ' +
    'That is the entire loop: clear a line → earn points and coins. ' +
    'Mistakes are fine — the board forgives.',
  'ftue.step.surge.meta': '07 §3 · steps 5–6 · 2:30',
  'ftue.step.surge.title': 'Combos charge the Surge',
  'ftue.step.surge.text':
    'Clearing lines on back-to-back moves builds ×2 · ×3 · ×5 combos and charges the ' +
    'Surge meter right here at the top. Planning chains of clears is the core skill ' +
    'of Block Surge.',
  'ftue.step.crystal.meta': '07 §3 · step 7 · 3:00–4:30',
  'ftue.step.crystal.title': 'Full Surge → Crystal Block',
  'ftue.step.crystal.text':
    'When the meter is full, a Crystal Block arrives in the fourth dock slot. ' +
    'Drag it onto the board — it detonates a 3×3 blast and adds points. ' +
    'That is the climax of a run.',
  'ftue.step.coins.meta': '07 §3 · step 8 · 4:30',
  'ftue.step.coins.title': 'Coins and rewards',
  'ftue.step.coins.text':
    'Clears, combos and finished runs earn you coins — the counter is at the top left. ' +
    'Spend them on rescue boosters; the Journey Map, daily streak and daily missions ' +
    'await in the Meta menu.',
  'ftue.step.ads.meta': '06 §3 · 07 §3 (minutes 5–10)',
  'ftue.step.ads.title': 'Ads — optional and later',
  'ftue.step.ads.text':
    'Rewarded videos (Second Chance, ×2 coins, a free booster) are always optional and ' +
    'always worth it. The first one appears only after you have learned the ropes; ads ' +
    'between runs start no earlier than level 6 and minute 8. No fake close buttons, ever.'
} as const satisfies Record<TranslationKey, string>;
