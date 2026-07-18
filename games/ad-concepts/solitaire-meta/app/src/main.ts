/**
 * Точка входа Orchard Peaks (Проходы Е.1 + Е.2 + Е.3): композиция сервисов и UI.
 * Порядок как в прототипе (economy.js → meta.js → monetize.js → analytics.js →
 * game.js): сначала Store/Economy/Meta, затем слой монетизации (провайдеры
 * рекламы/покупок — за фабрикой/интерфейсом), экраны 💎/📊/🚀, последним —
 * стол партии с хуками в мету и монетизацию.
 *
 * Рендер стола — DOM (TableUi), НЕ Phaser: решение по доступности ЦА 45+
 * (глава 07) задокументировано в README и src/ui/TableUi.ts.
 * ВСЯ реклама и покупки — СИМУЛЯЦИЯ (SimAdProvider/SimPurchaseProvider).
 */
import './style.css';
import { Store } from './economy/store';
import { Analytics } from './economy/analytics';
import { Economy } from './economy/economy';
import { Meta } from './meta/meta';
import { MetaUi } from './ui/MetaUi';
import { TableUi } from './ui/TableUi';
import { createAdProvider } from './ads/index';
import { SimAdProvider } from './ads/simProvider';
import { MonetizeStore } from './monetize/store';
import { MonetizeController } from './monetize/monetize';
import { SimPurchaseProvider } from './monetize/purchase';
import { ShopUi } from './ui/ShopUi';
import { DashboardUi } from './ui/DashboardUi';
import { Experiments } from './experiments/experiments';
import { CockpitUi } from './ui/CockpitUi';

/* Слой экономики и меты: один Store — атомарный сейв orchardPeaks.meta
 * (те же ключи, что у прототипа: прогресс подхватывается без миграции). */
const store = new Store();
const analytics = new Analytics();
const economy = new Economy(store, analytics);
const meta = new Meta(store, economy, analytics);

/* Совсем новый игрок — фиксируем стартовый бонус явным событием (05 §5.3). */
if (store.isFreshInstall()) {
  analytics.track('coins_delta', {
    amount: store.state.economy.coins,
    direction: 'in',
    source_id: 'ftue_start'
  });
  store.save();
}

/* ==================== МОНЕТИЗАЦИЯ (Проход Е.2, ВСЁ — СИМУЛЯЦИЯ) =========== */

/* Отдельный сейв orchardPeaks.monetize (схема прототипа 1:1). */
const monStore = new MonetizeStore();

/* Провайдер рекламы — через фабрику (веб-сборка → SimAdProvider; прод-флаг
 * VITE_AD_PROVIDER=max выберет скелет MaxAdProvider для AppLovin MAX). */
const adProvider = createAdProvider();
// .catch: скелет MaxAdProvider намеренно бросает NOT_WIRED вне прод-сборки —
// без обработчика это unhandled rejection на старте.
void adProvider.init().catch(() => undefined);

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

/* Гео-переключение симулятора (сеттер SimAdProvider) — от дашборда 📊. */
if (adProvider instanceof SimAdProvider) {
  adProvider.setGeo(monetize.getGeo());
  monetize.onGeoChanged = (tier) => adProvider.setGeo(tier);
}

/* Магазин 💎 и дашборд 📊 — DOM-оверлеи в духе Е.1. */
const shopUi = new ShopUi(monetize);
shopUi.mount();
const dashboardUi = new DashboardUi(monetize, analytics);
dashboardUi.mount();
dashboardUi.onOpenStore = () => shopUi.open();

/* ==================== SOFT-LAUNCH КОКПИТ (Проход Е.3) ===================== */
/* Офлайн-инструмент прод-команды поверх симулятора экономики (src/sim):
 * A/B по персистентному session-id, тюнинг ручек, гейты 09 §9.5. В игру не
 * вмешивается — пишет только ключи orchardPeaks.tuning/abSession/softScen. */
const experiments = new Experiments();
const cockpitUi = new CockpitUi(experiments);
cockpitUi.mount();

/* Мета-экран (Сад/Задания/Лавка) и стол партии — DOM-оверлеи прототипа 1:1. */
const metaUi = new MetaUi(economy, meta);
const tableUi = new TableUi(economy, meta, metaUi, analytics, monetize, localStorage);

metaUi.init();
tableUi.init();

/* Кнопки HUD Проходов В/Г: магазин, KPI-дашборд, soft-launch кокпит. */
document.getElementById('btn-store')?.addEventListener('click', () => shopUi.open());
document.getElementById('btn-dash')?.addEventListener('click', () => dashboardUi.open());
document.getElementById('btn-soft')?.addEventListener('click', () => cockpitUi.open());

/* Лёгкий тост монетизации (порт gtoast: собственный элемент #mon-toast). */
let monToastTimer: ReturnType<typeof setTimeout> | null = null;
function monToast(msg: string): void {
  let el = document.getElementById('mon-toast');
  if (el === null) {
    el = document.createElement('div');
    el.id = 'mon-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  if (monToastTimer !== null) clearTimeout(monToastTimer);
  monToastTimer = setTimeout(() => el?.classList.remove('show'), 2100);
}

/* Подписки монетизации на UI: тосты + «живой» рефреш экранов. */
monetize.onToast = monToast;
monetize.onChanged = () => {
  tableUi.syncHud(); // HUD + видимость кнопки «💰 Кошелёк»
  shopUi.refresh();
  dashboardUi.refresh();
};

/* Возврат из экранов 💎/📊/🚀 — обновить HUD (как из меты). */
shopUi.onClose = () => tableUi.syncHud();
dashboardUi.onClose = () => tableUi.syncHud();
cockpitUi.onClose = () => tableUi.syncHud();

tableUi.newGame();
tableUi.maybeShowStreakModal(); // ежедневный стрик поверх стартовой раздачи
