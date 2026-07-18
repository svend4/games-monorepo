/**
 * Лёгкий трекер событий по дереву 09-analytics-kpi.md §2.2 (порт из economy.js).
 * Прод-стек — Firebase + AppsFlyer + BigQuery (09 §0); здесь — in-memory тэлли +
 * компактный console-лог значимых событий (без спама на каждую линию).
 */

export type AnalyticsParams = Record<string, string | number | boolean>;

/** Какие события логируем в консоль. */
const LOUD: ReadonlySet<string> = new Set([
  'currency_spend',
  'mission_complete',
  'streak_change',
  'booster_used',
  'season_progress',
  'game_end',
  // Проход Е.2 (монетизация): покупки и недопоказы interstitial
  'iap_completed',
  'ad_capped'
]);

export class Analytics {
  /** event → count (для отладки и будущих проверок KPI). */
  readonly tally: Record<string, number> = {};

  /** quiet=true — без console-лога (тесты). */
  constructor(private readonly quiet = false) {}

  track(event: string, params?: AnalyticsParams): void {
    this.tally[event] = (this.tally[event] ?? 0) + 1;
    if (!this.quiet && LOUD.has(event)) {
      try {
        console.log('[analytics] ' + event, params ?? {});
      } catch {
        /* no-op */
      }
    }
  }
}
