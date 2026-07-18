/**
 * Экономика: монеты + инвентарь бустеров (Проход Е.2, порт window.Economy).
 * Реализует 05 §2.1–§2.2 поверх Store. ЧИСТАЯ логика без DOM: об изменениях
 * баланса подписчики (UI) узнают через onChange — вместо refreshCoinHud
 * прототипа, дёргавшего document напрямую.
 */
import { ECON, type BoosterId } from './econ';
import type { Analytics } from './analytics';
import type { Store } from './store';
import type { EconomySave } from './save';

export class Economy {
  /** Подписка UI: любой сдвиг монет/бустеров. */
  onChange: (() => void) | null = null;

  /** Монеты, заработанные в текущей партии (для экрана итога). */
  private earnedThisGame = 0;

  constructor(
    private readonly store: Store,
    private readonly analytics: Analytics
  ) {
    // FTUE-начисление стартового бонуса как явное событие (05 §2.1: 200 разово).
    if (store.isFreshInstall()) {
      analytics.track('currency_earn', { amount: ECON.START_COINS, source: 'ftue_start' });
      store.save();
    }
  }

  /** Живая ссылка на ветку сейва (не кэшируем — переживает Store.reset). */
  private get s(): EconomySave {
    return this.store.state.economy;
  }

  private changed(): void {
    this.onChange?.();
  }

  getCoins(): number {
    return this.s.coins;
  }

  getEarnedThisGame(): number {
    return this.earnedThisGame;
  }

  resetEarnedThisGame(): void {
    this.earnedThisGame = 0;
  }

  /** Приход монет. source — из перечня 09 §2.2 (level/mission/streak/chest/...). */
  addCoins(amount: number, source: string, countThisGame = false): number {
    const amt = Math.max(0, Math.round(amount));
    if (amt === 0) return 0;
    this.s.coins += amt;
    if (countThisGame) this.earnedThisGame += amt;
    this.analytics.track('currency_earn', { amount: amt, source });
    this.store.save();
    this.changed();
    return amt;
  }

  /** Расход монет. Возвращает true, если хватило средств. sink — 09 §2.2. */
  spendCoins(amount: number, sink: string): boolean {
    const amt = Math.max(0, Math.round(amount));
    if (this.s.coins < amt) return false;
    this.s.coins -= amt;
    this.analytics.track('currency_spend', { amount: amt, sink });
    this.store.save();
    this.changed();
    return true;
  }

  /* ------------------------------ Бустеры ------------------------------- */

  getBooster(id: BoosterId): number {
    return this.s.boosters[id] ?? 0;
  }

  addBooster(id: BoosterId, n = 1, source = 'grant'): void {
    this.s.boosters[id] += n;
    this.analytics.track('currency_earn', { amount: 0, source: source + ':booster_' + id });
    this.store.save();
    this.changed();
  }

  /** Покупка бустера за монеты (sink монет, 05 §2.2). true при успехе. */
  buyBooster(id: BoosterId): boolean {
    const def = ECON.BOOSTERS[id];
    if (!this.spendCoins(def.price, 'booster')) return false;
    this.s.boosters[id] += 1;
    this.store.save();
    this.changed();
    return true;
  }

  /** Списание одного бустера при использовании в партии. */
  consumeBooster(id: BoosterId, context = 'classic'): boolean {
    if ((this.s.boosters[id] ?? 0) <= 0) return false;
    this.s.boosters[id] -= 1;
    this.analytics.track('booster_used', { type: id, context });
    this.store.save();
    this.changed();
    return true;
  }
}
