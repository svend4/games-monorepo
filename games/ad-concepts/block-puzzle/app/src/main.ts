/**
 * Точка входа Block Surge (Проход Е.1 + Е.2): сервисы меты и монетизации +
 * конфиг Phaser. Порядок как в прототипе (economy.js → meta.js → monetize.js →
 * analytics.js → game.js): сначала Store/Economy/Meta и DOM-оверлеи, затем
 * слой монетизации (провайдеры рекламы/покупок — за фабрикой/интерфейсом),
 * последней — сцена партии с хуками в мету и монетизацию.
 * Размер канваса задаёт сцена; Scale.FIT вписывает игру в колонку между
 * топбаром меты и бустер-баром с сохранением пропорций.
 */
import Phaser from 'phaser';
import { GAME_H, GAME_W, GameScene } from './scenes/GameScene';
import { Store } from './economy/store';
import { Analytics } from './economy/analytics';
import { Economy } from './economy/economy';
import { Meta } from './meta/meta';
import { BoosterController } from './meta/boosters';
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

/* Слой экономики и меты (Проход Б): один Store — атомарный сейв blocksurge_meta. */
const store = new Store();
const analytics = new Analytics();
const economy = new Economy(store, analytics);
const meta = new Meta(store, economy, analytics);
const boosters = new BoosterController(economy);

/* DOM-оверлей меты: топбар, бустер-бар, мета-экран, тосты. */
const ui = new MetaUi(economy, meta, boosters);
ui.mount();

/* ==================== МОНЕТИЗАЦИЯ (Проход Е.2, ВСЁ — СИМУЛЯЦИЯ) =========== */

/* Отдельный сейв blocksurge_monetize (схема прототипа 1:1). */
const monStore = new MonetizeStore();

/* forward-ссылка для предиката баннера (контроллер создаётся после провайдера). */
let monetizeRef: MonetizeController | null = null;

/** Баннер «крутится» только на игровом экране — не под DOM-оверлеями
 * и не под экраном итога в канвасе (порт mainScreenActive прототипа). */
function bannerActive(): boolean {
  if (monetizeRef !== null && monetizeRef.isResultOverlayVisible()) return false;
  const overlayIds = ['metaScreen', 'shopScreen', 'dashboardScreen', 'adOverlay', 'cockpitScreen'];
  return overlayIds.every((id) => {
    const el = document.getElementById(id);
    return el === null || el.classList.contains('hidden');
  });
}

/* Провайдер рекламы — через фабрику (веб-сборка → SimAdProvider; прод-флаг
 * VITE_AD_PROVIDER=max выберет скелет MaxAdProvider). */
const adProvider = createAdProvider({ sim: { bannerActive } });
void adProvider.init();

/* Провайдер покупок — симулятор (в проде — StoreKit/Play Billing, 10 §2). */
const purchaseProvider = new SimPurchaseProvider();

const monetize = new MonetizeController({
  monStore,
  metaStore: store,
  economy,
  analytics,
  adProvider,
  purchaseProvider
});
monetizeRef = monetize;

/* Гео-переключение симулятора (сеттер SimAdProvider) — от дашборда. */
if (adProvider instanceof SimAdProvider) {
  adProvider.setGeo(monetize.getGeo());
  monetize.onGeoChanged = (tier) => adProvider.setGeo(tier);
}

/* Магазин (🛒) и дашборд (📊) — DOM-оверлеи в духе Е.1. */
const shopUi = new ShopUi(monetize, economy);
shopUi.mount();
const dashboardUi = new DashboardUi(monetize);
dashboardUi.mount();

/* ==================== SOFT-LAUNCH КОКПИТ (Проход Е.3) ===================== */
/* Офлайн-инструмент прод-команды поверх симулятора экономики (src/sim):
 * A/B по персистентному session-id, тюнинг ручек, гейты 09 §5.4. В игру не
 * вмешивается — пишет только свой ключ localStorage blocksurge_softlaunch. */
const experiments = new Experiments();
const cockpitUi = new CockpitUi(experiments);
cockpitUi.mount();

/* Бейджи топбара и rewarded-панель мета-экрана. */
ui.onShopClick = () => shopUi.open();
ui.onDashClick = () => dashboardUi.open();
ui.onCockpitClick = () => cockpitUi.open();
ui.adPanel = {
  statusLine: () => monetize.metaAdStatusLine(),
  rw3Enabled: () => monetize.canFreeBooster(),
  rw4Enabled: () => monetize.canDoubleStreak(),
  onRw3: () => void monetize.offerFreeBooster(),
  onRw4: () => void monetize.offerDoubleStreak(),
  onShown: () => monetize.noteMetaOffersShown()
};

/* Подписки монетизации на UI: тосты + «живой» рефреш экранов. */
monetize.onToast = (msg) => ui.toast(msg);
monetize.onChanged = () => {
  ui.refreshCoinHud();
  ui.renderMeta();
  shopUi.refresh();
  dashboardUi.refresh();
};

/* Баннер BAN-1: показать, если реклама не убрана (Remove Ads/подписка). */
monetize.updateBanner();

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: '#0e1117',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: [new GameScene({ economy, meta, boosters, ui, monetize })]
});
