/**
 * Английский словарь Orchard Peaks (Проход Ж.1).
 *
 * `satisfies Record<TranslationKey, string>` — компилятор гарантирует, что
 * здесь есть КАЖДЫЙ ключ русского словаря и нет лишних (ошибка tsc при
 * рассинхроне). Терминология — из prototype/store-listing.md (EN — основной
 * язык листинга): harvest, garden orders, Golden Basket, Gardener's Club,
 * Morning Watering Can, garden ticket (взнос — НЕ «bet»/«stake», без
 * казино-лексики), Aunt Martha, Biscuit. Тон — тёплый, спокойный, 45+.
 */
import type { TranslationKey } from './ru';

export const en = {
  /* ==================== App / static shell ==================== */
  'app.title': 'Orchard Peaks: Cozy Solitaire',

  'hud.coins.tip': 'Coin balance (saved)',
  'hud.harvestBank.tip': 'Harvest for garden orders (saved)',
  'hud.level.tip': 'Current level n (raises the garden ticket E(n) and the win multiplier W(n))',
  'hud.level.label': 'Lvl',
  'hud.score.tip': 'Points this level',
  'hud.score.label': 'Score:',
  'hud.chain.tip': 'Chain of cards removed in a row',
  'hud.chain.label': 'Chain:',
  'hud.tableHarvest.tip': 'Harvest gathered in this hand',
  'hud.tableHarvest.label': '🍎 table:',
  'hud.btn.garden': '🌳 Garden',
  'hud.btn.store': '💎 Shop',
  'hud.btn.dash': '📊 KPI',
  'hud.btn.soft': '🚀 Soft',
  'hud.btn.soft.tip':
    'Soft-launch cockpit: economy simulator, A/B, tuning, go/no-go gates (internal tool)',
  'hud.btn.restart': 'New deal',
  'hud.progress.tip': 'Board clearing progress',

  'boosterBar.aria': 'Boosters',
  'booster.undo.tip': 'Undo the last move',
  'booster.undo.free': '↩ Undo ({n})',
  'booster.undo.paid': '↩ Undo (💰{price})',
  'booster.joker.tip': 'Joker: remove any face-up card',
  'booster.joker.count': '🃏 Joker ({n})',
  'booster.basket.tip': 'Golden Basket: ×2 harvest this hand',
  'booster.basket.count': '🧺 Basket ({n})',
  'booster.basket.active': '🧺 ×2 active',
  'booster.wallet.tip':
    "Gardener's Wallet (rewarded): top up coins by watching an ad — SIMULATION",
  'booster.wallet.label': '💰 Wallet',

  'table.stock.aria': 'Draw deck: turn the next card',
  'table.stock.label': 'Deck',
  'table.waste.aria': 'Face-up card on the pile',
  'table.waste.label': 'Pile',
  'table.hint.html':
    'Remove face-up cards one rank above or below the pile card.<br>' +
    'Ace and King are neighbours. Cards with&nbsp;🍎 bring harvest for the garden.',

  'card.open.aria': 'Card {card}',
  'card.closed.aria': 'Face-down card',
  /* Letter ranks (2–10 stay digits in both locales; the core keeps Т/В/Д/К). */
  'card.rank.1': 'A',
  'card.rank.11': 'J',
  'card.rank.12': 'Q',
  'card.rank.13': 'K',

  /* ==================== Meta screen: shell ==================== */
  'meta.screen.aria': 'Garden and tasks',
  'meta.back': '← Play',
  'meta.coins.tip': 'Coins',
  'meta.harvest.tip': 'Harvest for orders',
  'meta.tab.garden': '🌳 Garden',
  'meta.tab.tasks': '🎯 Tasks',
  'meta.tab.shop': '🛒 Market',
  'meta.tab.settings': '⚙️ Settings',

  /* ==================== Game toasts (table) ==================== */
  'game.toast.jokerOpenOnly': 'The Joker works only on a face-up card',
  'game.toast.jokerUsed': '🃏 Joker played',
  'game.toast.jokerChoose': '🃏 Pick any face-up card',
  'game.toast.nothingToUndo': 'Nothing to undo',
  'game.toast.noCoinsUndo': 'Not enough coins to undo (needs {price})',
  'game.toast.undoFree': 'Move undone (free)',
  'game.toast.undoPaid': 'Move undone (−{price} 💰)',
  'game.toast.basketAlready': 'The Basket is already on',
  'game.toast.basketOn': '🧺 Harvest this hand ×{mult}',
  'game.toast.secondChance': 'Second chance! Five cards added to the deck.',
  'game.toast.streakClaimed': 'Streak counted!',

  /* ==================== Win screen ==================== */
  'win.title': 'Board clear!',
  'win.subtitle': 'The garden thanks you. Level {n} complete.',
  'win.row.entry': 'Garden ticket',
  'win.entry.free': 'free',
  'win.row.reward': 'Win W({n})',
  'win.row.stockBonus': 'Deck bonus: {n} cards',
  'win.row.rw2': '📺 ×2 for an ad (RW2)',
  'win.row.total': 'Coins total this level',
  'win.row.harvest': 'Harvest: {n} 🍎{x2}',
  'win.row.balance': 'Balance',
  'win.row.harvestBank': 'Harvest in the garden',
  'win.metaCta': 'The harvest is growing — visit the garden to move an order along.',

  'ad.simTag': 'SIMULATION',
  'ad.rw2.cta': '📺 ×2 reward for an ad',
  'ad.rw2.done': '✓ Reward doubled by an ad (RW2)',
  'ad.rw5.cta': '📺 ×2 fair tokens',
  'ad.rw1.cta': '📺 Second chance: +5 cards to the deck',

  'btn.toGarden': '🌳 To the garden',
  'btn.playAgain': 'Play again',
  'btn.tryAgain': 'Try again',
  'btn.later': 'Later',
  'btn.claim': 'Claim',

  /* ==================== Lose screen ==================== */
  'lose.title': 'So close!',
  'lose.subtitle': 'The board was {pct}% clear. Biscuit is sure the next one will work out.',
  'lose.harvestKept': 'Harvest kept: +{n} 🍎 (already in the garden)',
  'lose.harvestNone': 'Harvest never burns — gather 🍎 in a new hand.',
  'lose.balance': 'Balance: 💰 {coins} · 🍎 {harvest}',

  /* ==================== Streak modal ==================== */
  'streak.title': 'Morning Watering Can',
  'streak.subtitle': 'Day {d} in a row. Claim your reward and keep the streak going.',
  'streak.reward': 'Reward: 💰 {coins}{extra}',
  'streak.extra.undo': ' +1 undo',
  'streak.extra.joker': ' +Joker 🃏',
  'streak.extra.basket': ' +Basket 🧺',

  /* ==================== Meta: toasts ==================== */
  'meta.toast.zoneDone': '🎉 The “{name}” zone is done! +💰 {bonus}',
  'meta.toast.orderDone': 'Order complete! The garden has grown.',
  'meta.toast.bought': 'Bought: {name}',
  'meta.toast.missionClaimed': 'Mission reward claimed!',
  'meta.toast.streakClaimed': 'Streak counted! The watering can is full.',
  'meta.toast.newDay': 'A new day has come (test).',

  /* ==================== Meta: Garden tab ==================== */
  'garden.allDone.title': '🎉 The whole garden is in bloom!',
  'garden.allDone.sub':
    'You have finished every zone of the prototype. The full game has 12 zones and 240 levels.',
  'garden.intro':
    'Orders spend 🍎 harvest (and sometimes 💰 coins), advance the zone and open the ' +
    'next goal. Short on harvest? Play another hand.',
  'garden.locked.teaser': 'Opens when you finish “{name}”',
  'garden.order.need': 'Needs:',
  'garden.order.rewardArrow': '→ reward',
  'garden.order.do': 'Fulfil order',
  'garden.order.noCoins': 'Not enough coins',
  'garden.order.noHarvest': 'Not enough harvest',
  'garden.zone.done': '✓ Zone done — the garden thanks you!',

  /* ==================== Meta: Tasks tab ==================== */
  'tasks.streak.title': '🌅 Morning Watering Can — streak',
  'tasks.streak.claim': 'Claim day {d}: 💰 {coins}{extra}',
  'tasks.streak.extra.undo': ' +↩',
  'tasks.streak.extra.joker': ' +🃏',
  'tasks.streak.extra.basket': ' +🧺',
  'tasks.streak.claimed': "Today's reward is claimed. Come back tomorrow — the streak continues.",
  'tasks.missions.daily': 'Daily missions',
  'tasks.missions.weekly': 'Mission of the week',
  'tasks.mission.claimed': '✓ Claimed (💰 {coins})',
  'tasks.mission.claim': 'Claim 💰 {coins}',
  'tasks.mission.card': ' + card',
  'tasks.mission.reward': 'Reward: 💰 {coins}',
  'tasks.test.title': '🧪 Loop check',
  'tasks.test.note': 'Shift “today” one day forward to see the streak and the mission reset.',
  'tasks.test.newDay': 'New day (test)',

  /* ==================== Meta: Market tab ==================== */
  'lavka.intro': 'Boosters are bought with coins and help during hands (05 §5.6).',
  'lavka.max': 'Max',
  'lavka.undo.name': 'Undo a move',
  'lavka.undo.hint': 'Free undos: {n}. After that — 💰 {price} per undo right in the hand.',

  'plan.title': '📊 Economy: where you are on the curve',
  'plan.now':
    'Level <b>{n}</b> · ticket <b>💰 {e}</b> · win <b>💰 {w}</b> · multiplier <b>×{m}</b>',
  'plan.note1':
    'The designed balance path of the median player (05 §5.4): days 1–4 — surplus ' +
    '(the “honeymoon”), day 5+ — a planned slide into deficit, days 12–16 — the ' +
    'first money-decision point.',
  'plan.th.day': 'Day',
  'plan.th.level': 'Lvl',
  'plan.th.saldo': 'Net/day',
  'plan.th.balance': 'Balance',
  'plan.note2': '▲ the row closest to your level ({note}).',
  'plan.d1.note': 'Honeymoon: surplus by design',
  'plan.d2.note': 'The player feels “rich”, tries boosters',
  'plan.d3.note': 'Balance peak is near',
  'plan.d4.note': 'The curve levels off',
  'plan.d5.note': 'First deficit day',
  'plan.d7.note': 'Day-7 streak bonus softens it',
  'plan.d10.note': 'Balance melts — demand ripens',
  'plan.d14.note': 'The “Wallet” point: less than 1 ticket left',
  'plan.d21.note': 'The rewarded wallet became routine',
  'plan.d30.note': 'A stable micro-deficit carousel',

  /* ==================== Meta: Settings tab ==================== */
  'settings.lang.title': '🌐 Язык · Language',
  'settings.lang.note': 'Switching the language reloads the page — your progress and saves are kept.',
  'settings.lang.ru': 'Русский',
  'settings.lang.en': 'English',
  'settings.ftue.title': '❓ Tutorial',
  'settings.ftue.note': 'You can replay the first-run coach marks at any time.',
  'settings.ftue.replay': 'Replay the tutorial',

  /* ==================== Shop 💎 ==================== */
  'store.title': '💎 Shop',
  'store.back': '← Play',
  'store.simBanner':
    '⚠ SIMULATION: ad networks and billing are NOT connected. Purchases charge no ' +
    'money; an “ad view” is an on-screen stub. In production — AppLovin MAX / AdMob ' +
    'and the app stores.',
  'store.h.rewarded': '🎁 Free for an ad (rewarded)',
  'store.sub.rewarded':
    'Rewarded is the backbone of the model (target 65–70% of ad revenue, 06 §6.1). ' +
    'These bonuses are opt-in: the subscription and remove-ads do NOT remove them.',
  'store.capLeft': 'left today: {left}/{cap}',
  'store.capNone': 'no daily limit',
  'store.limit': 'Limit',
  'store.cta.watch': 'Watch',
  'store.cta.spin': 'Spin',
  'store.h.noads': '🚫 Ad-free and subscription',
  'store.owned': 'Owned ✓',
  'store.sub.month': 'month {n}',
  'store.cancel': 'Cancel',
  'store.perMonth': '/mo',
  'store.h.piggy': '🐷 Piggy bank',
  'store.piggy.break': 'Crack open 💰',
  'store.piggy.from': 'from {n}',
  'store.h.coins': '🪙 Coins and bundles',
  'store.sub.coins':
    "Denominations are personalised by the player's E(n) (06 §6.4). US prices; " +
    'localised via the store matrix in production.',
  'store.once': 'one-time',
  'store.contents.cards': '{n} card(s)',
  'store.foot': 'SIMULATION · the revenue of every view/purchase goes to the “📊 KPI” dashboard.',

  /* ==================== Monetization toasts ==================== */
  'mon.toast.rwCap': "Today's limit for this reward is used up",
  'mon.toast.wallet': "Gardener's Wallet: +{n} 💰",
  'mon.toast.booster': 'Booster for an ad: +1 {emoji} {name}',
  'mon.toast.wheel': '🎡 Fair Wheel: +{n} 💰',
  'mon.toast.event': '×2 fair tokens: +{n} 💰',
  'mon.toast.onceOwned': 'This bundle is already bought (one-time)',
  'mon.toast.adsOwned': 'Ads are already removed',
  'mon.toast.piggyOwned': 'The piggy bank is already active',
  'mon.toast.buy': 'SIMULATED purchase: {label} (${price})',
  'mon.toast.subCancel': 'Subscription cancelled (the decor stays)',
  'mon.toast.piggyBreak': 'Piggy bank opened: +{n} 💰',

  /* ==================== Ad overlay (simulation) ==================== */
  'adov.simTag.rewarded': 'SIMULATION · REWARDED',
  'adov.simTag.interstitial': 'SIMULATION · INTERSTITIAL',
  'adov.note.prod': 'in production an AppLovin MAX / AdMob ad plays here',
  'adov.note.fail': 'The ad failed to load (fill < 100%) — no reward',
  'adov.btn.loading': 'Ad…',
  'adov.btn.wait': 'Ad… {s} s',
  'adov.btn.claim': 'Claim reward ✓',
  'adov.btn.close': 'Close ✕',
  'adov.btn.closePlain': 'Close',

  /* ==================== Configs: boosters (econ.ts) ==================== */
  'booster.joker.name': 'Joker',
  'booster.joker.hint': 'Remove any face-up card — chain “insurance”',
  'booster.basket.name': 'Golden Basket',
  'booster.basket.hint': '×2 harvest for the hand — grows the garden faster',

  /* ==================== Configs: missions (econ.ts) ==================== */
  'mission.d_harvest.text': 'Gather 25 🍎 of harvest',
  'mission.d_chain.text': 'Build a chain of 5 cards',
  'mission.d_order.text': 'Fulfil a garden order',
  'mission.w_wins.text': 'Win 12 levels this week',

  /* ==================== Configs: zones and orders (meta/config.ts) ==================== */
  'zone.porch.name': 'The Porch',
  'zone.porch.scene': "The wooden porch of Aunt Martha's house",
  'zone.beds.name': 'Flower Beds',
  'zone.beds.scene': 'A strip of flower beds along the fence',
  'zone.garden.name': 'Vegetable Patch',
  'zone.garden.scene': 'The vegetable patch behind the house',
  'zone.greenhouse.name': 'Greenhouse',
  'zone.greenhouse.scene': 'The glass greenhouse by the pond',

  'order.porch.0.title': 'Clear the path',
  'order.porch.1.title': 'Hang a lantern',
  'order.porch.2.title': 'Fix the bench',
  'order.porch.3.title': 'Plant geraniums by the door',
  'order.beds.0.title': 'Dig a flower bed',
  'order.beds.1.title': 'Plant lavender',
  'order.beds.2.title': 'Plant tulips',
  'order.beds.3.title': 'Lay the border',
  'order.garden.0.title': 'Mark out the beds',
  'order.garden.1.title': 'Plant carrots',
  'order.garden.2.title': 'Plant tomatoes',
  'order.garden.3.title': 'Gather the first harvest',
  'order.greenhouse.0.title': 'Assemble the frame',
  'order.greenhouse.1.title': 'Fit the glass',
  'order.greenhouse.2.title': 'Plant the seedlings',
  'order.greenhouse.3.title': 'Start the watering',

  /* ==================== Configs: placements (monetize/config.ts) ==================== */
  'placement.RW1.name': 'Second Chance',
  'placement.RW1.desc': 'Continue a stuck level (board ≥ 60% clear)',
  'placement.RW2.name': 'Double the Reward',
  'placement.RW2.desc': '×2 coins for the completed level',
  'placement.RW3.name': 'Booster for the Level',
  'placement.RW3.desc': 'A free booster for the hand',
  'placement.RW4.name': 'Fair Wheel',
  'placement.RW4.desc': 'Spin the wheel for a coin bonus',
  'placement.RW5.name': '×2 Fair Tokens',
  'placement.RW5.desc': 'Double the event tokens (Fri–Sun)',
  'placement.RW6.name': "Gardener's Wallet",
  'placement.RW6.desc': 'Top up coins when the balance is low',
  'placement.INT1.name': 'Between levels',
  'placement.INT1.desc': 'Return to the garden map after a win',

  /* ==================== Configs: IAP shelf (monetize/config.ts) ==================== */
  'iap.coins_s.label': 'Handful of Coins',
  'iap.coins_s.note': 'Entry point, impulse buy',
  'iap.starter_pack.label': 'Starter Pack',
  'iap.starter_pack.note': 'One-time, D3–D21 window · the main first-payment converter',
  'iap.piggy_greenhouse.label': 'Greenhouse Piggy Bank',
  'iap.piggy_greenhouse.note': 'Saves 5% of wins · opens from 4000 · cap 15000',
  'iap.coins_m.label': 'Coin Purse',
  'iap.coins_m.note': 'The workhorse',
  'iap.remove_ads.label': 'Remove Ads',
  'iap.remove_ads.note': 'Forever · removes interstitials (rewarded stays) +500💰',
  'iap.club_month.label': "Gardener's Club",
  'iap.club_month.note': 'Subscription/mo · no INT · +50% harvest · 500💰/day',
  'iap.coins_l.label': 'Coin Chest',
  'iap.coins_l.note': 'The main revenue volume',
  'iap.almanac_premium.label': 'Premium Almanac',
  'iap.almanac_premium.note': 'Seasonal almanac track',
  'iap.coins_xl.label': 'Big Coin Chest',
  'iap.event_bundle.label': 'Fair Bundle',
  'iap.event_bundle.note': 'Denominations rotate by E(n)',
  'iap.coins_xxl.label': 'Grand Coin Chest',
  'iap.coins_max.label': "Top Chest “Martha's Fountain”",
  'iap.coins_max.note': 'League status',

  /* ==================== FTUE onboarding ==================== */
  'onb.aria': 'Orchard Peaks tutorial',
  'onb.stepLabel': 'Step {cur} of {total}',
  'onb.next': 'Next',
  'onb.back': '← Back',
  'onb.skip': 'Skip tutorial',
  'onb.s1.title': 'Welcome to the garden',
  'onb.s1.body':
    "You've inherited Aunt Martha's neglected garden — with a greenhouse, a pond " +
    'and a beehive. Every hand of solitaire is a day of work in the garden. ' +
    "Biscuit the dog is already waiting. Let's deal the first hand.",
  'onb.s1.cta': 'Show me how to play',
  'onb.s2.title': 'The main rule: one up or one down',
  'onb.s2.body':
    'The pile card sits at the bottom. Remove any face-up card that is one rank ' +
    'above or below it. Ace and King are neighbours — the circle closes. Made a ' +
    'mistake? The “↩ Undo” button forgives.',
  'onb.s3.title': 'No move? Draw from the deck',
  'onb.s3.body':
    'If no card on the board fits, turn a new one from the deck on the left. ' +
    "There's no rush: no timers, no penalties for pausing. Play at your own pace — " +
    'even with a cup of coffee.',
  'onb.s4.title': 'Chain and multiplier',
  'onb.s4.body':
    'Remove cards back to back without opening the deck — the chain grows, and ' +
    'with it the reward multiplier. The longer the chain, the more coins per hand. ' +
    'A soft golden glow tells you the chain is on.',
  'onb.s5.title': 'Harvest cards — why the garden matters',
  'onb.s5.body':
    "Cards with the 🍎 badge bring harvest. Harvest is not points: it's what " +
    'brings the garden back to life. It gathers in the basket at the top and is ' +
    "kept even if the hand doesn't work out.",
  'onb.s6.title': 'The first garden order',
  'onb.s6.body':
    'Open “🌳 Garden” and fulfil the first order — clearing the porch. The harvest ' +
    'goes into the order, the porch transforms before your eyes, and a new flower ' +
    'bed opens next. That is how the whole garden story grows.',
  'onb.s7.title': 'Done — the garden is yours',
  'onb.s7.body':
    'That is all you need to start. Play calmly, at a pace that suits you. Want to ' +
    'refresh the rules? Open “🌳 Garden” → “⚙️ Settings” and tap “Replay the ' +
    'tutorial”. Happy harvest!',
  'onb.s7.cta': 'Start playing'
} satisfies Record<TranslationKey, string>;
