/**
 * Экономика: две валюты (монеты + урожай), инвентарь бустеров, ундо
 * (порт window.Economy из prototype/economy.js 1:1). ЧИСТАЯ логика без DOM:
 * об изменениях балансов подписчики (HUD игры, мета-экран) узнают через
 * subscribe — вместо прямых дёрганий document в прототипе.
 */
import { ECON, entryCostFor, fmt, winMultFor, winRewardFor, type BoosterId } from './econ';
import type { Analytics } from './analytics';
import type { Store } from './store';
import type { EconomySave } from './save';

export class Economy {
  /**
   * Поставщик номера «главы» для бонуса за сток (глава = индекс зоны + 1).
   * В прототипе Economy звал window.Meta.currentChapter; здесь Meta
   * подставляет себя после создания (разрыв циклической зависимости).
   */
  chapterProvider: () => number = () => 1;

  private readonly listeners: (() => void)[] = [];

  /** Монеты, заработанные в текущем уровне (для экрана итога). */
  private earnedCoinsThisLevel = 0;

  constructor(
    private readonly store: Store,
    private readonly analytics: Analytics
  ) {}

  /** Живая ссылка на ветку сейва (не кэшируем — переживает Store.reset). */
  private get s(): EconomySave {
    return this.store.state.economy;
  }

  /* --- Подписка на изменение валют (HUD игры + баланс мета-экрана) --- */
  subscribe(fn: () => void): void {
    this.listeners.push(fn);
  }

  notify(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        /* подписчик не должен ронять экономику */
      }
    }
  }

  /* --- Форматирование и формулы (чистые функции econ.ts) --- */
  fmt(n: number): string {
    return fmt(n);
  }

  entryCost(level?: number): number {
    return entryCostFor(level ?? this.s.level);
  }

  winMult(level?: number): number {
    return winMultFor(level ?? this.s.level);
  }

  winReward(level?: number): number {
    return winRewardFor(level ?? this.s.level);
  }

  /** Бонус за остаток стока: 25 × номер главы за карту (05 §5.2). */
  stockBonus(cards: number): number {
    return Math.max(0, cards | 0) * ECON.STOCK_BONUS_PER_CARD * this.chapterProvider();
  }

  /* --- Геттеры --- */
  getCoins(): number {
    return this.s.coins;
  }

  getHarvest(): number {
    return this.s.harvest;
  }

  getLevel(): number {
    return this.s.level;
  }

  getFreeUndos(): number {
    return this.s.freeUndos;
  }

  getEarnedThisLevel(): number {
    return this.earnedCoinsThisLevel;
  }

  resetEarnedThisLevel(): void {
    this.earnedCoinsThisLevel = 0;
  }

  /* --- Монеты (source_id по 09 §9.1) --- */
  addCoins(amount: number, source: string, countLevel = false): number {
    const amt = Math.max(0, Math.round(amount));
    if (amt === 0) return 0;
    this.s.coins += amt;
    if (countLevel) this.earnedCoinsThisLevel += amt;
    this.analytics.track('coins_delta', { amount: amt, direction: 'in', source_id: source });
    this.store.save();
    this.notify();
    return amt;
  }

  spendCoins(amount: number, sink: string): boolean {
    const amt = Math.max(0, Math.round(amount));
    if (this.s.coins < amt) return false;
    this.s.coins -= amt;
    this.analytics.track('coins_delta', { amount: amt, direction: 'out', source_id: sink });
    this.store.save();
    this.notify();
    return true;
  }

  /* --- Урожай (мета-ресурс; единственный sink — заказы сада, 05 §5.2) --- */
  addHarvest(amount: number, source = 'cards'): number {
    const amt = Math.max(0, Math.round(amount));
    if (amt === 0) return 0;
    this.s.harvest += amt;
    this.analytics.track('coins_delta', { amount: amt, direction: 'in', source_id: 'harvest:' + source });
    this.store.save();
    this.notify();
    return amt;
  }

  spendHarvest(amount: number): boolean {
    const amt = Math.max(0, Math.round(amount));
    if (this.s.harvest < amt) return false;
    this.s.harvest -= amt;
    this.store.save();
    this.notify();
    return true;
  }

  /* --- Прогресс уровня --- */
  nextLevel(): number {
    this.s.level += 1;
    this.store.save();
    this.notify();
    return this.s.level;
  }

  /* --- Бустеры (05 §5.6) --- */
  getBooster(id: BoosterId): number {
    return this.s.boosters[id] ?? 0;
  }

  addBooster(id: BoosterId, n = 1, source = '?'): void {
    const cap = ECON.BOOSTERS[id].cap;
    this.s.boosters[id] = Math.min(cap, (this.s.boosters[id] ?? 0) + n); // кап инвентаря, 05 §5.5
    this.analytics.track('booster_use', { booster_id: id, context: 'grant:' + source });
    this.store.save();
    this.notify();
  }

  /** Покупка бустера за монеты. false — инвентарь полон или не хватает монет. */
  buyBooster(id: BoosterId): boolean {
    const def = ECON.BOOSTERS[id];
    if ((this.s.boosters[id] ?? 0) >= def.cap) return false; // инвентарь полон
    if (!this.spendCoins(def.price, 'booster')) return false;
    this.s.boosters[id] = (this.s.boosters[id] ?? 0) + 1;
    this.store.save();
    this.notify();
    return true;
  }

  consumeBooster(id: BoosterId, context = 'in'): boolean {
    if ((this.s.boosters[id] ?? 0) <= 0) return false;
    this.s.boosters[id] -= 1;
    this.analytics.track('booster_use', { booster_id: id, context });
    this.store.save();
    this.notify();
    return true;
  }

  /* --- Ундо: бесплатные из инвентаря, затем за монеты (05 §5.2) --- */
  useUndo(): 'free' | 'paid' | null {
    if (this.s.freeUndos > 0) {
      this.s.freeUndos -= 1;
      this.analytics.track('booster_use', { booster_id: 'undo', context: 'free' });
      this.store.save();
      this.notify();
      return 'free';
    }
    if (this.spendCoins(ECON.UNDO_PRICE, 'undo')) {
      this.analytics.track('booster_use', { booster_id: 'undo', context: 'paid' });
      return 'paid';
    }
    return null; // нет ни бесплатных, ни монет
  }

  addFreeUndo(n = 1): void {
    this.s.freeUndos += n;
    this.store.save();
    this.notify();
  }
}
