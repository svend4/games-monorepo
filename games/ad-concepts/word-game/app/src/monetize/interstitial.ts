/**
 * Правила показа interstitial I-1 (Проход Е.2, порт interstitialBlockReason
 * из прототипа monetize.js; спека — 06 §4, капы 1:1, порядок проверок 1:1).
 *
 * ЧИСТАЯ логика: время — только через инжектируемый Clock (никаких Date.now
 * в правилах), внешние факты (уровень кампании, дневной режим, no-ads,
 * дневной счётчик) — через функции-зависимости. Каждый кап тестируется
 * детерминированно.
 */
import type { Clock } from './clock';
import { MONETIZE } from './config';

/** Код блокирующего правила (значение cap_rule события ad_capped, 09 §1.3). */
export type IntBlockReason =
  | 'remove_ads' // Remove Ads / подписка — INT выключен навсегда (06 §5)
  | 'daily' // не после дневного кроссворда (06 §4 п.5)
  | 'ftue_level' // FTUE: раньше 3-го уровня (06 §4 п.2)
  | 'session_cap' // дневной кап 12 показов (06 §4 п.10)
  | 'interval' // < 45 c с прошлого interstitial (06 §4 п.3)
  | 'after_rw'; // < 30 c после rewarded (06 §4 п.4)

export interface InterstitialPolicyDeps {
  clock: Clock;
  /** Remove Ads / подписка активны. */
  adsRemoved(): boolean;
  /** Сейчас дневной кроссворд. */
  isDaily(): boolean;
  /** Прогресс кампании (индекс текущего уровня). */
  campaignLevel(): number;
  /** Показов INT сегодня (день уже актуализирован ensureDay контроллера). */
  dayIntShown(): number;
}

export class InterstitialPolicy {
  /**
   * −Infinity = «никогда»: любые интервалы от этой точки считаются истёкшими.
   * (Прототип держал 0 при реальном epoch-времени — эквивалентно; с
   * инжектируемыми часами, стартующими с 0, нужен явный «никогда».)
   */
  private lastIntMs = Number.NEGATIVE_INFINITY;
  private lastRewardedMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly deps: InterstitialPolicyDeps) {}

  /** Код блокирующего правила или null — показывать можно. Порядок 1:1. */
  blockReason(): IntBlockReason | null {
    const now = this.deps.clock.now();
    if (this.deps.adsRemoved()) return 'remove_ads';
    if (this.deps.isDaily()) return 'daily';
    if (this.deps.campaignLevel() < MONETIZE.INT.MIN_LEVEL_INDEX) return 'ftue_level';
    if (this.deps.dayIntShown() >= MONETIZE.INT.SESSION_CAP) return 'session_cap';
    if (now - this.lastIntMs < MONETIZE.INT.MIN_INTERVAL_MS) return 'interval';
    if (now - this.lastRewardedMs < MONETIZE.INT.AFTER_RW_MS) return 'after_rw';
    return null;
  }

  /** Interstitial показан: фиксируем время для интервального капа. */
  noteShown(): void {
    this.lastIntMs = this.deps.clock.now();
  }

  /** Rewarded показан: 30-секундная «оплата отдыха» (06 §4 п.4). */
  noteRewarded(): void {
    this.lastRewardedMs = this.deps.clock.now();
  }
}
