/**
 * Лёгкий трекер событий (порт track() из prototype/economy.js) по соглашениям
 * 09-analytics-kpi.md §1 (snake_case). В проде — Firebase; здесь — in-memory
 * тэлли (для тестов/отладки) + console.debug в браузере.
 */
export type AnalyticsParams = Record<string, string | number | boolean>;

export class Analytics {
  /** event -> count (для отладки и проверок в тестах). */
  readonly tally: Record<string, number> = {};

  /** quiet=true — без console-лога (тесты). */
  constructor(private readonly quiet = false) {}

  track(event: string, params?: AnalyticsParams): void {
    this.tally[event] = (this.tally[event] ?? 0) + 1;
    if (!this.quiet) {
      try {
        console.debug('[wg-track]', event, params ?? {});
      } catch {
        /* no-op */
      }
    }
  }
}
