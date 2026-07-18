/**
 * Применение i18n к статическому каркасу index.html (Проход Ж.1).
 *
 * Вызывается ОДИН РАЗ на старте (main.ts) до инициализации UI-классов:
 * подменяет русские строки каркаса (HUD, бустер-бар, колода/сброс, вкладки
 * меты) на текущую локаль. Динамические экраны (TableUi / MetaUi / ShopUi /
 * OnboardingUi / SimAdProvider) переводятся в месте рендера через t()/tDyn().
 * Русский текст в index.html остаётся как no-JS/фолбэк-содержимое.
 */
import { getLocale, t, type TranslationKey } from './index';

function setText(id: string, key: TranslationKey): void {
  const el = document.getElementById(id);
  if (el !== null) el.textContent = t(key);
}

function setHtml(id: string, key: TranslationKey): void {
  const el = document.getElementById(id);
  if (el !== null) el.innerHTML = t(key);
}

function setTitle(id: string, key: TranslationKey): void {
  const el = document.getElementById(id);
  if (el !== null) el.setAttribute('title', t(key));
}

function setAria(id: string, key: TranslationKey): void {
  const el = document.getElementById(id);
  if (el !== null) el.setAttribute('aria-label', t(key));
}

export function applyStaticI18n(): void {
  document.documentElement.lang = getLocale();
  document.title = t('app.title');

  /* ---- HUD: подсказки и подписи ---- */
  setTitle('hud-item-coins', 'hud.coins.tip');
  setTitle('hud-item-harvest-bank', 'hud.harvestBank.tip');
  setTitle('hud-item-level', 'hud.level.tip');
  setTitle('hud-item-score', 'hud.score.tip');
  setTitle('hud-item-chain', 'hud.chain.tip');
  setTitle('hud-item-harvest', 'hud.tableHarvest.tip');
  setText('hud-level-label', 'hud.level.label');
  setText('hud-score-label', 'hud.score.label');
  setText('hud-chain-label', 'hud.chain.label');
  setText('hud-harvest-label', 'hud.tableHarvest.label');

  /* ---- HUD: кнопки ---- */
  setText('btn-garden', 'hud.btn.garden');
  setText('btn-store', 'hud.btn.store');
  setText('btn-dash', 'hud.btn.dash');
  setText('btn-soft', 'hud.btn.soft');
  setTitle('btn-soft', 'hud.btn.soft.tip');
  setText('btn-restart', 'hud.btn.restart');
  setTitle('progress', 'hud.progress.tip');

  /* ---- Бустер-бар (тексты счётчиков перерисует TableUi.updateBoosterBar) ---- */
  setAria('booster-bar', 'boosterBar.aria');
  setTitle('bst-undo', 'booster.undo.tip');
  setTitle('bst-joker', 'booster.joker.tip');
  setTitle('bst-basket', 'booster.basket.tip');
  setTitle('bst-wallet', 'booster.wallet.tip');
  setText('bst-wallet', 'booster.wallet.label');

  /* ---- Низ стола: колода, сброс, правило ---- */
  setAria('stock-card', 'table.stock.aria');
  setText('stock-label', 'table.stock.label');
  setAria('waste-card', 'table.waste.aria');
  setText('waste-label', 'table.waste.label');
  setHtml('hint-text', 'table.hint.html');

  /* ---- Мета-экран: каркас и вкладки ---- */
  setAria('meta-screen', 'meta.screen.aria');
  setText('meta-back', 'meta.back');
  setTitle('meta-bal-coins', 'meta.coins.tip');
  setTitle('meta-bal-harvest', 'meta.harvest.tip');
  const tabs: ReadonlyArray<[string, TranslationKey]> = [
    ['garden', 'meta.tab.garden'],
    ['tasks', 'meta.tab.tasks'],
    ['shop', 'meta.tab.shop'],
    ['settings', 'meta.tab.settings']
  ];
  for (const [tab, key] of tabs) {
    const btn = document.querySelector('#meta-tabs button[data-tab="' + tab + '"]');
    if (btn !== null) btn.textContent = t(key);
  }
}
