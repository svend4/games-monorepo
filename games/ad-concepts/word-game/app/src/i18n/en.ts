/**
 * Английский словарь WordGrove (Проход Ж.1).
 *
 * `satisfies Record<TranslationKey, string>` — компилятор гарантирует, что
 * набор ключей СОВПАДАЕТ с русским словарём (ru.ts, источник истины): нет
 * ни пропущенных, ни лишних ключей.
 *
 * Терминология — из prototype/store-listing.md (EN-листинг сторов):
 * копилка = stash, жёлуди = acorns, Лампа = Lamp, стрик = streak,
 * заморозка стрика = Streak Freeze (streak shield), роща = the Grove.
 */
import type { TranslationKey } from './ru';

export const EN = {
  /* ---------- App statics / HUD ---------- */
  'app.title': 'WordGrove — production port (TS + Phaser 3)',
  'hud.coinsTitle': 'Coins',
  'hud.acornsTitle': 'Acorns (stash)',
  'hud.shopTitle': 'Shop: WordGrove Club subscription, Remove Ads, coins (SIMULATION)',
  'hud.dashTitle': 'Monetization dashboard (session KPIs)',
  'hud.cockpitTitle': 'Soft-launch cockpit: economy simulator + A/B + tuning + gates',
  'hud.metaTitle': 'Meta: atlas, daily, stash, missions',
  'hud.restartTitle': 'Restart this level',
  'hud.hintTitle': 'Lamp: reveal a random letter in the grid',
  'hud.rv1Title': 'Free Lamp for watching an ad (RV-1, SIMULATION)',
  'hud.rv1Free': 'free',
  'hud.shuffleTitle': 'Shuffle the letters (free)',
  'hud.bonusTitle': 'Bonus words found',
  'hud.daily': '📅 Daily crossword',
  'hud.level': 'Level {n}/{total}',
  'hud.groveDone': 'Grove complete',
  'banner.simTag': 'SIMULATION',

  /* ---------- Game-screen toasts ---------- */
  'toast.firstRun': 'Press a letter and drag across letters, release to check',
  'toast.tooShort': 'Words need at least {min} letters',
  'toast.duplicate': 'Already found',
  'toast.piggyFull': '⭐ The stash is full — acorns are burning! Open the stash 🐿️',
  'toast.bonusWord': '⭐ Bonus word! +{n} 🌰',
  'toast.clubHint': '👑 Club hint (unlimited)',
  'toast.nothingToReveal': 'Nothing left to reveal',
  'toast.noCoins': 'Not enough coins — open the stash 🐿️ or finish a level',
  'toast.hintUsed': '💡 Letter revealed',
  'toast.levelRestarted': 'Level restarted',
  'toast.progressReset': 'Progress reset',
  'toast.dailyStart': '📅 Daily crossword: theme “{theme}”',
  'toast.piggyOpened': '🐿️ Stash opened: +{n} 🪙',
  'toast.regionDone': '{emoji} Region “{name}” complete! +{n} 🪙',

  /* ---------- Win / final overlays ---------- */
  'win.title': 'Level {n} complete! 🌿',
  'win.perfect': '✨ Flawless clear: +{n} 🪙',
  'win.bonusFound': 'Bonus words found: {found} of {total}',
  'win.bonusTotal': 'Bonus words hidden in this level: {total}',
  'win.next': 'Next ▶',
  'final.title': '🌳 The Grove is complete!',
  'final.body': 'All {total} levels behind you. Coins collected: {coins} 🪙',
  'final.hint': 'Open the 🗺️ Meta: the region atlas, the daily crossword with streaks, the acorn stash and missions.',
  'final.replay': 'Play from the start',
  'final.wipe': 'Reset everything',

  /* ---------- Daily win overlay ---------- */
  'dailyWin.title': '📅 Daily crossword complete!',
  'dailyWin.already': 'You already finished it today — the reward comes once per day.',
  'dailyWin.streakNow': 'Current streak: 🔥 {n}',
  'dailyWin.dayReward': '+{n} 🪙 for today',
  'dailyWin.milestone': '🔥 Streak milestone {days} d.: +{n} 🪙',
  'dailyWin.streak': 'Streak: 🔥 {n} in a row',
  'dailyWin.bonus': 'Bonus words: {n} → acorns in the stash 🌰',
  'dailyWin.toMeta': 'To the meta menu',

  /* ---------- Bonus-list overlay ---------- */
  'bonus.title': '⭐ Bonus words',
  'bonus.found': 'Found in this level: {found} of {total}',
  'bonus.empty': 'Nothing yet. Build valid words that are not in the grid — each adds +{n} 🌰 to the stash',
  'bonus.ok': 'Got it',

  /* ---------- Meta screen ---------- */
  'meta.close': '✕ Play',
  'meta.tabAtlas': '🗺️ Atlas',
  'meta.tabDaily': '📅 Daily',
  'meta.tabPiggy': '🐿️ Stash',
  'meta.tabMissions': '🎯 Missions',
  'atlas.progress': 'Levels completed: {done} / {total}',
  'atlas.regionClaimed': '✅ Region reward claimed: +{n} 🪙',
  'atlas.regionReward': '🏆 Finish all levels → +{n} 🪙',
  'atlas.continue': '▶ Continue level {n}',
  'atlas.done': '🌳 The Grove is fully complete!',
  'daily.themeLabel': 'Today’s theme',
  'daily.inARow': 'in a row',
  'daily.longest': 'Best streak: {n}',
  'daily.msDay': '{n}d',
  'daily.nextMilestone': 'Next milestone: {n} days',
  'daily.rewardInfo': 'Daily reward: +{n} 🪙 (bonus words → acorns in the stash)',
  'daily.doneToday': '✅ Done for today — come back tomorrow',
  'daily.play': '📅 Play the daily crossword',
  'piggy.full': 'The stash is full — new acorns burn!',
  'piggy.info': 'Acorns drop in for bonus words (+{n}/word). Opening the stash converts them into coins 1:1.',
  'piggy.prodNote': 'In production, opening is gated by a rewarded ad (RV-5; here — SIMULATION).',
  'piggy.open': '🐿️ Open the stash (+{n} 🪙)',
  'piggy.empty': 'Empty — collect bonus words in levels',
  'missions.sub': 'Daily missions (refresh every day)',
  'missions.claimed': '✅ Claimed',
  'missions.claim': 'Claim',
  'missions.inProgress': 'In progress',

  /* ---------- Content labels (meta configs) ---------- */
  'region.grove': 'Green Grove',
  'region.meadow': 'Sunny Meadow',
  'mission.bonus5': 'Find 5 bonus words',
  'mission.levels3': 'Complete 3 levels',
  'mission.nohint': 'Complete a level without hints',
  'theme.kitchen': 'Kitchen',
  'theme.autumn': 'Autumn',
  'theme.cinema80s': '’80s movies',
  'theme.nature': 'Nature',
  'theme.city': 'City',
  'theme.music': 'Music',
  'theme.travel': 'Travel',

  /* ---------- Settings (meta footer) ---------- */
  'settings.language': 'Language',
  'settings.langNote': 'Changing the language reloads the page',
  'settings.replayOnboarding': '❔ Replay the tutorial',

  /* ---------- Shop ---------- */
  'shop.close': '← Back to game',
  'shop.title': '🛒 Shop',
  'shop.simTag': 'SIMULATION',
  'shop.note':
    'Everything on this screen is a simulation: the subscription and purchases deliver instantly, ' +
    'with no real money or payment providers (in production — App Store / Google Play Billing, 10 §2). ' +
    'Every purchase logs revenue to the 📊 dashboard.',
  'shop.rvHeader': '📺 Watch an ad for a reward',
  'shop.rvTag': 'rewarded',
  'shop.rvNote':
    'Rewarded is a voluntary “watch → reward” trade (06 §3.1). ' +
    'RV-1 “Free Lamp” lives in the game; RV-2 “×2 coins” on the win screen; ' +
    'RV-5 “Open the stash” in the meta 🐿️ Stash; RV-6 — here.',
  'shop.rv6Btn': '🧊 Streak Freeze — keep your run going',
  'shop.rv6Sub': 'RV-6 · SIMULATION',
  'shop.rv6Status': 'Streak Freezes: <b>{n}</b> · RV-6 today: {used}/{cap}',
  'shop.shelfHeader': '🪙 Coin shelf (06 §5.3)',
  'shop.subBadge': 'FLAGSHIP PRODUCT · SIMULATION',
  'shop.subTitle': '👑 WordGrove Club',
  'shop.subActive': '✅ Active{trial} · plan: {plan}',
  'shop.subTrialSuffix': ' (7-day trial)',
  'shop.subCancel': 'Cancel subscription',
  'shop.subTrialBtn': 'Start 7 days free',
  'shop.subTrialSub': 'then {label} · ${price}/mo',
  'shop.subYearBtn': 'Yearly ${price}',
  'shop.subYearSub': '{label} · best value',
  'shop.raTitle': '🚫 Remove ads forever',
  'shop.raSub': 'Disables interstitials + the banner (rewarded stays). Does not include premium content.',
  'shop.owned': '✓ owned',
  'shop.adsOff': '🚫 Ads off',
  'shop.adsOn': '📺 Ads on',
  'shop.clubActive': '👑 Club active',
  'shop.noSub': 'No subscription',

  /* ---------- Subscription plans and perks (monetize config) ---------- */
  'plan.monthly': 'Monthly',
  'plan.yearly': 'Year (−54%)',
  'shop.perk1': 'Zero interstitials and banners',
  'shop.perk2': 'A daily 9×9 premium themed crossword',
  'shop.perk3': 'Unlimited Lamps (free hints)',
  'shop.perk4': 'Automatic acorn stash opening',
  'shop.perk5': '+20% coins from all rewards',
  'shop.perk6': 'Auto Streak Freeze · 7-day daily archive',

  /* ---------- IAP shelf (SKU labels by id from monetize/config.ts) ---------- */
  'sku.coins_handful.title': 'Handful of Coins',
  'sku.coins_handful.desc': '600 🪙 · impulse first purchase',
  'sku.coins_starter.title': 'Starter Pack',
  'sku.coins_starter.desc': '1800 🪙 + 3 Lamps + 2 Scopes + badge · one time',
  'sku.coins_pouch.title': 'Coin Pouch',
  'sku.coins_pouch.desc': '3500 🪙 · standard',
  'sku.coins_chest.title': 'Chest',
  'sku.coins_chest.desc': '8000 🪙 + 5 Rockets · the main volume',
  'sku.coins_chest_t.title': 'Chest + Theme',
  'sku.coins_chest_t.desc': '18,000 🪙 + 12 Rockets + a décor theme',
  'sku.coins_region.title': 'Region Casket',
  'sku.coins_region.desc': '50,000 🪙 + 30 Rockets + an exclusive postcard',
  'sku.coins_master.title': 'Master’s Sack',
  'sku.coins_master.desc': '120,000 🪙 + all boosters ×20 + a profile frame',
  'sku.badge.start': 'START',
  'sku.badge.bestStart': 'BEST START',
  'sku.badge.anchor': 'ANCHOR',

  /* ---------- Monetization-layer toasts ---------- */
  'mon.intCounted': 'Interstitial counted · +${rev}',
  'mon.rv1LimitDay': 'Free Lamp limit reached for today ({n})',
  'mon.rv1PerLevel': 'Free Lamp — once per level',
  'mon.rv1Done': '💡 Letter revealed for watching (RV-1)',
  'mon.nothingToReveal': 'Nothing to reveal — the level is almost solved',
  'mon.rv2Done': '💰 +{n} 🪙 (×2 level coins)',
  'mon.rv2Btn': '📺 ×2 level coins (+{n} 🪙)',
  'mon.rv2Sub': 'RV-2 · SIMULATION',
  'mon.rv2Used': '✓ Doubled: +{n} 🪙',
  'mon.rv6Limit': 'Streak Freeze limit reached for today',
  'mon.rv6Done': '🧊 Streak Freeze received — your run is protected',
  'mon.trialStarted': 'SIMULATION: WordGrove Club — 7-day trial active',
  'mon.subStarted': 'SIMULATION: WordGrove Club subscription started ({plan})',
  'mon.trialConverted': 'SIMULATION: trial ended — WordGrove Club subscription active',
  'mon.subCancelled': 'SIMULATION: subscription cancelled',
  'mon.removeAdsOwned': 'Remove Ads is already owned',
  'mon.removeAdsDone': 'SIMULATION: ads removed forever · ${price}',
  'mon.starterOnce': 'The Starter Pack is one-time only',
  'mon.iapDone': 'SIMULATION: purchased “{title}” · +{coins} 🪙 · ${price}',

  /* ---------- Ad-show simulation overlay ---------- */
  'adsim.tag': 'AD SIMULATION · no real networks',
  'adsim.defaultFormat': 'Ad',
  'adsim.title.i1': 'Interstitial · I-1 (between levels)',
  'adsim.title.rv1': 'Rewarded · RV-1 “Free Lamp”',
  'adsim.title.rv2': 'Rewarded · RV-2 “×2 level coins”',
  'adsim.title.rv5': 'Rewarded · RV-5 “Open the acorn stash”',
  'adsim.title.rv6': 'Rewarded · RV-6 “Streak Freeze”',
  'adsim.pitch.rv1': 'Watch to the end — we’ll reveal a random grid letter for free.',
  'adsim.pitch.rv2': 'Watch to the end — we’ll double the coins earned in this level.',
  'adsim.pitch.rv5': 'Watch to the end — we’ll open the stash and convert acorns into coins.',
  'adsim.pitch.rv6': 'Watch to the end — we’ll freeze your streak so the run continues safely.',
  'adsim.pitch.default': 'In production a real network runs here: AppLovin MAX / AdMob (06 §6, §8).',
  'adsim.showingPrefix': 'Playing:',
  'adsim.seconds': 'sec',
  'adsim.skip': 'Skip ✕',
  'adsim.close': 'Close ✕',
  'adsim.claim': 'Claim reward 🎁',

  /* ---------- FTUE onboarding (port of prototype/onboarding.js) ---------- */
  'ob.step': 'Step {n} of {total}',
  'ob.next': 'Next',
  'ob.back': 'Back',
  'ob.skip': 'Skip',
  'ob.startGame': 'Start playing',
  'ob.helpTitle': 'Replay the tutorial',
  'ob.ariaLabel': 'WordGrove tutorial',
  'ob.s1.title': 'Welcome to WordGrove 🌿',
  'ob.s1.body':
    'A relaxing crossword: build words from the letters on the wheel and fill the grid. ' +
    'Half a minute of tips — and you can play in peace.',
  'ob.s2.title': 'Build your first word',
  'ob.s2.body':
    'Press a letter on the wheel and drag across its neighbours — the trace links the letters, ' +
    'and the word appears above the wheel. Release to check. Drag into the centre to cancel.',
  'ob.s3.title': 'Fill the crossword',
  'ob.s3.body':
    'A correct word writes itself into the grid. Reveal every word of the level — ' +
    'and the coins 🪙 are yours. No timers, no rush.',
  'ob.s4.title': 'Bonus words are never wasted',
  'ob.s4.body':
    'Built a word from the same letters that isn’t in the grid? It drops acorns 🌰 into your stash. ' +
    'Trade the stash for coins later — not a single word is wasted.',
  'ob.s5.title': 'Stuck? Light the Lamp',
  'ob.s5.body':
    'The Lamp 💡 reveals one random letter for coins. Later you’ll be able to get it ' +
    'free for a short video — optional, no pressure.',
  'ob.s6.title': 'WordGrove Club — whenever you like',
  'ob.s6.body':
    'The club lives here: a daily premium crossword and ad-free play. ' +
    'Nothing is pushed on you now — settle in, the offer can wait.',
  'ob.s7.title': 'All set 🎉',
  'ob.s7.body':
    'Build your first word from the wheel letters. You can replay this tutorial ' +
    'any time with the ❔ button at the top of the screen.',

  /* ---------- Pluralization ---------- */
  'plural.day.one': 'day',
  'plural.day.few': 'days',
  'plural.day.many': 'days'
} as const satisfies Record<TranslationKey, string>;
