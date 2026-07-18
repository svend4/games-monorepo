/**
 * Экономика — жёлуди и копилка (Проход Е.1, порт prototype/economy.js).
 *
 * Ядро (CoreGame) остаётся владельцем МОНЕТ (сейв 'wordgrove.save.v1');
 * этот модуль владеет ЖЁЛУДЯМИ и КОПИЛКОЙ (сейв 'wordgrove.economy.v1').
 * Монеты трогает только через мост coinBridge (порт window.WG) — конвертация
 * копилки в монеты 1:1 (05 §2.2). Числа — economy/econ.ts (05-economy.md).
 *
 * Совместимость: при отсутствии сейва экономики (старый игрок Прохода А)
 * всё стартует с дефолтов — жёлуди 0, монеты игрока не трогаются.
 */
import type { AcornResult, AcornSink } from '../core/game';
import { defaultStorage, type KeyValueStorage } from '../core/storage';
import type { Analytics } from './analytics';
import { ECON } from './econ';

/** Мост к монетам ядра (порт window.WG.addCoins). */
export interface CoinBridge {
  addCoins(n: number, source?: string): void;
}

export interface EconomyState {
  /** Текущие жёлуди в копилке (0..ACORN_CAP). */
  acorns: number;
  /** Всего накоплено (для статистики/миссий). */
  acornsLifetime: number;
  /** Сколько раз открывали копилку. */
  piggyOpens: number;
  /** Сколько жёлудей сгорело при переполнении. */
  burned: number;
}

function econDefaults(): EconomyState {
  return { acorns: 0, acornsLifetime: 0, piggyOpens: 0, burned: 0 };
}

/** Конечное неотрицательное целое или дефолт (порт проверок load прототипа). */
function toCount(v: unknown, def: number): number {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.floor(v);
  return def;
}

/** Санитайзинг сейва экономики (экспорт для тестов). */
export function sanitizeEconomySave(raw: unknown): EconomyState {
  const out = econDefaults();
  if (!raw || typeof raw !== 'object') return out;
  const s = raw as Record<string, unknown>;
  out.acorns = Math.min(toCount(s.acorns, 0), ECON.ACORN_CAP);
  out.acornsLifetime = toCount(s.acornsLifetime, 0);
  out.piggyOpens = toCount(s.piggyOpens, 0);
  out.burned = toCount(s.burned, 0);
  return out;
}

export class Economy implements AcornSink {
  /** Мост к монетам ядра; назначается в main после создания CoreGame. */
  coinBridge: CoinBridge | null = null;
  /** Подписка UI: жёлуди изменились. */
  onChange: (() => void) | null = null;

  private st: EconomyState;

  constructor(
    private readonly storage: KeyValueStorage = defaultStorage(),
    private readonly analytics?: Analytics
  ) {
    this.st = this.load();
  }

  private load(): EconomyState {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(ECON.SAVE_KEY);
    } catch {
      return econDefaults();
    }
    if (raw === null) return econDefaults();
    try {
      return sanitizeEconomySave(JSON.parse(raw));
    } catch {
      return econDefaults();
    }
  }

  private save(): void {
    try {
      this.storage.setItem(ECON.SAVE_KEY, JSON.stringify(this.st));
    } catch {
      /* приватный режим/квота — играем без сохранения экономики */
    }
  }

  track(event: string, params?: Record<string, string | number | boolean>): void {
    this.analytics?.track(event, params);
  }

  /* ================= ЖЁЛУДИ / КОПИЛКА (04 §3.4, 05 §2.2) ================= */

  getAcorns(): number {
    return this.st.acorns;
  }

  getCap(): number {
    return ECON.ACORN_CAP;
  }

  isPiggyFull(): boolean {
    return this.st.acorns >= ECON.ACORN_CAP;
  }

  getState(): Readonly<EconomyState> {
    return this.st;
  }

  /** Начислить жёлуди с учётом капа; переполнение сгорает (05 §2.2). */
  addAcorns(n: number): AcornResult {
    const amt = Math.max(0, Math.floor(n || 0));
    const space = Math.max(0, ECON.ACORN_CAP - this.st.acorns);
    const added = Math.min(amt, space);
    const burned = amt - added;
    this.st.acorns += added;
    this.st.acornsLifetime += added;
    this.st.burned += burned;
    this.save();
    if (added > 0) {
      this.track('currency_earn', {
        currency: 'acorn',
        amount: added,
        source: 'bonus_word',
        balance_after: this.st.acorns
      });
    }
    this.onChange?.();
    return { added, burned, full: this.isPiggyFull() };
  }

  /** Жёлуди за бонусное слово (+2, ECON.ACORN_PER_BONUS) — хук ядра. */
  addBonusAcorns(): AcornResult {
    return this.addAcorns(ECON.ACORN_PER_BONUS);
  }

  /**
   * Открыть копилку → конвертация в монеты 1:1 (05 §2.2). В проде гейт —
   * rewarded RV-5 (Проход Е.2); здесь открытие бесплатно. Возвращает монеты.
   */
  openPiggy(): number {
    const amount = this.st.acorns;
    if (amount <= 0) return 0;
    this.st.acorns = 0;
    this.st.piggyOpens += 1;
    this.save();
    this.coinBridge?.addCoins(amount, 'piggy'); // конвертация 1:1
    this.track('piggy_open', { amount, source: 'free_pass_b' });
    this.track('currency_spend', { currency: 'acorn', amount, sink: 'piggy_convert', balance_after: 0 });
    this.onChange?.();
    return amount;
  }

  reset(): void {
    this.st = econDefaults();
    this.save();
    this.onChange?.();
  }
}
