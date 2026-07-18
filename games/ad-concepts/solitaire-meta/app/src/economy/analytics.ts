/**
 * Лёгкий трекер событий по дереву 09-analytics-kpi.md §9.1 (порт из
 * prototype/economy.js). Прод-стек — BigQuery + AppsFlyer (09 §9.7); здесь —
 * in-memory тэлли + компактный console-лог значимых событий.
 */

export type AnalyticsParams = Record<string, string | number | boolean>;

/** Какие события логируем в консоль (1:1 со списком LOUD прототипа). */
const LOUD: ReadonlySet<string> = new Set([
  'coins_delta',
  'order_complete',
  'zone_complete',
  'streak_update',
  'mission_complete',
  'booster_use',
  'level_finish'
]);

export class Analytics {
  /** event → count (для отладки и будущих проверок KPI). */
  readonly tally: Record<string, number> = {};

  /**
   * Подписчик ленты событий (Проход Е.2): дашборд 📊 собирает последние
   * события трекинга (09 §9.1). Аналог оборачивания Analytics.track в
   * прототипе analytics.js — здесь явный колбэк вместо monkey-patch.
   */
  onTrack: ((event: string, params?: AnalyticsParams) => void) | null = null;

  /** quiet=true — без console-лога (тесты). */
  constructor(private readonly quiet = false) {}

  track(event: string, params?: AnalyticsParams): void {
    this.tally[event] = (this.tally[event] ?? 0) + 1;
    try {
      this.onTrack?.(event, params);
    } catch {
      /* подписчик не должен ронять трекинг */
    }
    if (!this.quiet && LOUD.has(event)) {
      try {
        console.log('[analytics] ' + event, params ?? {});
      } catch {
        /* no-op */
      }
    }
  }
}
