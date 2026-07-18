/**
 * Правила показа interstitial INT-2 (Проход Е.2, порт interstitialBlockReason
 * из прототипа monetize.js; спека — 06 §3, капы 1:1).
 *
 * ЧИСТАЯ логика: время — только через инжектируемый Clock (никаких Date.now
 * в правилах), внешние факты (партий сыграно, no-ads, дневной счётчик) —
 * через функции-зависимости. Каждый кап тестируется детерминированно.
 */
import type { Clock } from './clock';
import { MONETIZE } from './config';

/** Код блокирующего правила (значение параметра cap_rule события ad_capped, 09 §2.3). */
export type IntBlockReason =
  | 'remove_ads'   // Remove Ads / подписка — INT выключен навсегда (06 §3.8)
  | 'ftue_games'   // FTUE: сыграно меньше FTUE_GAMES партий (06 §3.1)
  | 'ftue_time'    // FTUE: первые FTUE_MS сессии (06 §3.1)
  | 'session_cap'  // дневной кап SESSION_CAP показов (06 §3.1)
  | 'frequency'    // частотный кап: нет MIN_GAMES_BETWEEN партий с прошлого показа
  | 'interval'     // < MIN_INTERVAL_MS с прошлого interstitial (06 §3.3)
  | 'after_rw'     // < AFTER_RW_MS после rewarded (06 §3.4)
  | 'after_iap';   // < AFTER_IAP_MS после покупки (06 §3.6)

export interface InterstitialPolicyDeps {
  clock: Clock;
  /** Всего партий сыграно (stats.gamesPlayed меты). */
  gamesPlayed(): number;
  /** Remove Ads / подписка активны. */
  adsRemoved(): boolean;
  /** Показов INT сегодня (день уже актуализирован ensureDay контроллера). */
  dayIntShown(): number;
}

export class InterstitialPolicy {
  private readonly sessionStart: number;
  /** −Infinity = «никогда»: любые интервалы от этой точки считаются истёкшими. */
  private lastIntMs = Number.NEGATIVE_INFINITY;
  private lastIntGame = -999; // как в прототипе: первый показ частотой не заблокирован
  private lastRewardedMs = Number.NEGATIVE_INFINITY;
  private lastIapMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly deps: InterstitialPolicyDeps) {
    this.sessionStart = deps.clock.now();
  }

  /** Код блокирующего правила или null — показывать можно. Порядок проверок 1:1. */
  blockReason(): IntBlockReason | null {
    const now = this.deps.clock.now();
    if (this.deps.adsRemoved()) return 'remove_ads';
    if (this.deps.gamesPlayed() < MONETIZE.INT.FTUE_GAMES) return 'ftue_games';
    if (now - this.sessionStart < MONETIZE.INT.FTUE_MS) return 'ftue_time';
    if (this.deps.dayIntShown() >= MONETIZE.INT.SESSION_CAP) return 'session_cap';
    if (this.deps.gamesPlayed() - this.lastIntGame < MONETIZE.INT.MIN_GAMES_BETWEEN) {
      return 'frequency';
    }
    if (now - this.lastIntMs < MONETIZE.INT.MIN_INTERVAL_MS) return 'interval';
    if (now - this.lastRewardedMs < MONETIZE.INT.AFTER_RW_MS) return 'after_rw';
    if (now - this.lastIapMs < MONETIZE.INT.AFTER_IAP_MS) return 'after_iap';
    return null;
  }

  /** Interstitial показан: фиксируем время и номер партии для частотного капа. */
  noteShown(): void {
    this.lastIntMs = this.deps.clock.now();
    this.lastIntGame = this.deps.gamesPlayed();
  }

  /** Rewarded показан: 60-секундная «оплата отдыха» (06 §3.4). */
  noteRewarded(): void {
    this.lastRewardedMs = this.deps.clock.now();
  }

  /** IAP-покупка: льгота от interstitial на сутки (06 §3.6, §7 «Плательщик»). */
  noteIap(): void {
    this.lastIapMs = this.deps.clock.now();
  }
}
