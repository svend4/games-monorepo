/**
 * Точка входа WordGrove (Проходы Е.1 + Е.2 + Е.3): композиция сервисов.
 * Порядок как в прототипе (economy.js → monetize.js → analytics.js → sim.js +
 * experiments.js → meta.js → game.js): экономика и мета создаются до ядра,
 * мосты (порт window.WG/window.Economy) назначаются после, meta.init() —
 * после загрузки сейва ядра; слой монетизации (провайдеры рекламы/покупок —
 * за фабрикой/интерфейсом) подключается к готовым Е.1-сервисам хуками, не
 * переписывая их логику.
 *
 * Рендер: колесо букв — Phaser (WheelScene, канвас в #wheel-host);
 * кроссвордная сетка, HUD и оверлеи — DOM (GridUi/MetaUi); экраны
 * монетизации — DOM-оверлеи (ShopUi/DashboardUi/CockpitUi).
 * ВСЯ реклама и покупки — СИМУЛЯЦИЯ (без реальных SDK и денег).
 */
import Phaser from 'phaser';
import { CoreGame } from './core/game';
import { mulberry32, randomSeed } from './core/rng';
import { defaultStorage } from './core/storage';
import { Analytics } from './economy/analytics';
import { Economy } from './economy/economy';
import { Meta } from './meta/meta';
import { WHEEL_SIZE, WheelScene } from './scenes/WheelScene';
import { GridUi } from './ui/GridUi';
import { MetaUi } from './ui/MetaUi';
import { createAdProvider } from './ads/index';
import { SimAdProvider } from './ads/simProvider';
import { MonetizeStore } from './monetize/store';
import { MonetizeController } from './monetize/monetize';
import { SimPurchaseProvider } from './monetize/purchase';
import { ShopUi } from './ui/ShopUi';
import { DashboardUi } from './ui/DashboardUi';
import { Experiments } from './experiments/experiments';
import { CockpitUi } from './ui/CockpitUi';

/* Слои экономики и меты (Проход Б): отдельные сейвы wordgrove.economy.v1 /
 * wordgrove.meta.v1; ядро владеет монетами в wordgrove.save.v1 (как прототип). */
const storage = defaultStorage();
const analytics = new Analytics();
const economy = new Economy(storage, analytics);
const meta = new Meta(economy, analytics, storage);

const game = new CoreGame({
  storage,
  rng: mulberry32(randomSeed()), // подсказка «Лампа»: сид вне логики, PRNG внутри
  acorns: economy,
  track: (event, params) => analytics.track(event, params),
  hooks: {
    onBonusWord: (word) => meta.emit('bonus_word', { word }),
    onLevelComplete: (index, perfect) => meta.emit('level_complete', { index, perfect })
  }
});

/* Мосты (порт window.WG): монеты остаются во владении ядра. */
economy.coinBridge = game;
meta.bridge = game;
/* Инициализация меты ПОСЛЕ загрузки сейва ядра: атлас/миссии видят актуальный
 * прогресс, награды за уже пройденные регионы выдаются (миграция Прохода А). */
meta.init();

/* DOM-рендер: сетка + HUD + оверлеи (GridUi), мета-экран (MetaUi). */
const gridUi = new GridUi(game, economy, meta);
const metaUi = new MetaUi({ meta, economy, game, toast: (msg) => gridUi.toast(msg) });
gridUi.onMetaOpen = (tab) => metaUi.open(tab);
metaUi.onPlayDaily = () => gridUi.startDaily();
meta.onToast = (msg) => gridUi.toast(msg);

gridUi.mount();
metaUi.mount();

/* ==================== МОНЕТИЗАЦИЯ (Проход Е.2, ВСЁ — СИМУЛЯЦИЯ) =========== */

/* Отдельный сейв wordgrove.monetize.v1 (схема прототипа 1:1). */
const monStore = new MonetizeStore(storage);

/* forward-ссылка для предиката баннера (контроллер создаётся после провайдера). */
let monetizeRef: MonetizeController | null = null;

/** Баннер «крутится» только на игровом экране: разрешён капами контроллера
 * (no-ads/дневной/уровень) и не перекрыт полноэкранными оверлеями (порт
 * bannerAllowed + anyFullscreenOpen из прототипа). */
function bannerActive(): boolean {
  if (monetizeRef === null || !monetizeRef.bannerAllowed()) return false;
  const overlayIds = ['overlay', 'meta-screen', 'shopScreen', 'dashboardScreen', 'cockpitScreen', 'adOverlay'];
  return overlayIds.every((id) => {
    const el = document.getElementById(id);
    return el === null || el.classList.contains('hidden');
  });
}

/* Провайдер рекламы — через фабрику (веб-сборка → SimAdProvider; прод-флаг
 * VITE_AD_PROVIDER=max выберет скелет MaxAdProvider). */
const adProvider = createAdProvider({ sim: { bannerActive } });
void adProvider.init().catch(() => undefined);

/* Провайдер покупок — симулятор (в проде — StoreKit/Play Billing, 10 §2). */
const purchaseProvider = new SimPurchaseProvider();

const monetize = new MonetizeController({
  monStore,
  economy,
  analytics,
  adProvider,
  purchaseProvider,
  bridge: {
    getCampaignLevel: () => game.getCampaignLevel(),
    isDailyMode: () => game.isDailyMode(),
    getCoins: () => game.getCoins(),
    addCoins: (n, source) => game.addCoins(n, source),
    // Открытие буквы С РЕНДЕРОМ — через GridUi (иначе клетка не оживёт на экране).
    revealFreeLetter: () => gridUi.revealFreeLetterFromAd()
  }
});
monetizeRef = monetize;

/* Гео-переключение симулятора (сеттер SimAdProvider) — от дашборда. */
if (adProvider instanceof SimAdProvider) {
  adProvider.setGeo(monetize.getGeo());
  monetize.onGeoChanged = (tier) => adProvider.setGeo(tier);
}

/* ==================== SOFT-LAUNCH КОКПИТ (Проход Е.3) ===================== */
/* Офлайн-инструмент прод-команды поверх симулятора экономики (src/sim):
 * A/B по персистентному session-id, тюнинг ручек, гейты 09 §4.3. В игру не
 * вмешивается — пишет только свой ключ localStorage wordgrove_softlaunch. */
const experiments = new Experiments(storage);
const cockpitUi = new CockpitUi(experiments);
cockpitUi.mount();

/* Магазин (🛒) и дашборд (📊) — DOM-оверлеи в духе Е.1. */
const shopUi = new ShopUi(monetize);
shopUi.mount();
const dashboardUi = new DashboardUi(monetize, experiments);
dashboardUi.mount();

/* --------------------- Интеграция Е.2 в игровые экраны -------------------- */

/* HUD-кнопки: магазин / дашборд / кокпит. */
document.getElementById('btn-shop')?.addEventListener('click', () => shopUi.open());
document.getElementById('btn-dash')?.addEventListener('click', () => dashboardUi.open());
document.getElementById('btn-cockpit')?.addEventListener('click', () => cockpitUi.open());

/* RV-1 «Бесплатная Лампа» в игре (кнопка 📺 под Лампой). */
const rv1Btn = document.getElementById('btn-rv1');
rv1Btn?.addEventListener('click', () => {
  void monetize.offerFreeLamp().catch(() => undefined);
});

/** Порт updateInLevelRv: подписчику RV-1 не нужен (Лампа и так бесплатна). */
function updateInLevelRv(): void {
  if (rv1Btn === null) return;
  if (monetize.adsRemoved()) {
    rv1Btn.classList.add('hidden');
    return;
  }
  rv1Btn.classList.remove('hidden');
  rv1Btn.classList.toggle('poor', !monetize.rv1Available());
}

/* Оверлей победы: инъекция RV-2 «×2 монеты» + interstitial I-1 перед «Дальше». */
gridUi.adHooks = {
  buildDoubleButton: (reward) => {
    monetize.noteRv2Shown(); // оффер показан (воронка 09 §1.3)
    const btn = document.createElement('button');
    btn.className = 'rv2-inject';
    btn.type = 'button';
    btn.innerHTML = '📺 ×2 монеты за уровень (+' + reward + ' 🪙)<span class="rv2-sub">RV-2 · СИМУЛЯЦИЯ</span>';
    btn.addEventListener('click', () => {
      if (btn instanceof HTMLButtonElement && btn.disabled) return;
      monetize
        .offerDoubleCoins(reward)
        .then((extra) => {
          if (extra > 0 && btn instanceof HTMLButtonElement) {
            btn.disabled = true;
            btn.classList.add('rv-used');
            btn.innerHTML = '✓ Удвоено: +' + extra + ' 🪙';
          }
        })
        .catch(() => undefined);
    });
    return btn;
  },
  beforeNext: () => monetize.maybeShowInterstitial().then(() => undefined)
};

/* Клубный безлимит подсказок: подписчику Лампа бесплатна (06 §5.1, перк 3). */
gridUi.freeHint = () => monetize.subscribed();

/* Копилка меты — через rewarded RV-5 (подписка/Remove Ads открывают бесплатно). */
metaUi.piggyOpener = () => monetize.openPiggy().then((res) => res.coins);

/* Подписки монетизации на UI: тосты + «живой» рефреш экранов + баннер/RV-1. */
monetize.onToast = (msg) => gridUi.toast(msg);
monetize.onChanged = () => {
  updateInLevelRv();
  monetize.updateBanner();
  shopUi.refresh();
  dashboardUi.refresh();
};

/* Смена уровня / вход-выход из дневного → баннер и RV-1 пересчитываются. */
gridUi.onAfterRebuild = () => {
  monetize.updateBanner();
  updateInLevelRv();
};

/* Стартовая синхронизация баннера и кнопки RV-1. */
monetize.updateBanner();
updateInLevelRv();

/* Phaser-рендер колеса: логический квадрат WHEEL_SIZE, Scale.FIT в #wheel-host. */
const wheelScene = new WheelScene({
  onWordChange: (word) => gridUi.setCurrentWord(word),
  onSubmit: (word) => gridUi.submitWord(word),
  canInteract: () => !game.allCompleted()
});

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'wheel-host',
  width: WHEEL_SIZE,
  height: WHEEL_SIZE,
  transparent: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: [wheelScene]
});

gridUi.wheel = wheelScene;
gridUi.start();
