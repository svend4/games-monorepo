/**
 * Мета-прогрессия (Проход Е.2, порт window.Meta из meta.js):
 * карта «Путешествия» (04 §2), стрик дней (04 §3), ежедневные миссии (04 §4.1)
 * и хуки партии (onMove/onBomb/onGameEnd/onNewGame).
 *
 * ЧИСТАЯ логика: ни Phaser, ни DOM. UI подписывается на onToast/onChanged;
 * GameScene вызывает хуки в тех же точках, где game.js прототипа звал Meta.*.
 *
 * Начисление конца партии — ДЕЛЬТОЙ (как в прототипе): при будущем
 * rewarded-оживлении RW-1 (Проход В) onGameEnd сработает повторно в той же
 * партии; звёзды/монеты конца добираются только приростом, а gamesPlayed и
 * миссия «партий» засчитываются ровно один раз за матч.
 */
import { ECON } from '../economy/econ';
import type { Analytics } from '../economy/analytics';
import { t } from '../i18n';
import type { Economy } from '../economy/economy';
import type { Store } from '../economy/store';
import type { MetaSave, StatsSave } from '../economy/save';
import {
  MAP_NODES,
  MISSION_BONUS,
  STAR_THRESHOLDS,
  STREAK_REWARDS,
  type MapNode,
  type MissionType
} from './config';
import { daysBetween, ymd } from './dates';
import { missionDef, rollMissions } from './missions';

/** Итог конца партии для экрана результата. */
export interface GameEndResult {
  /** Звёзды по финальному счёту (для '★★☆'). */
  stars: number;
  /** Монеты, заработанные за партию (для строки итога). */
  coins: number;
}

export type NodeStatus = 'claimed' | 'ready' | 'locked';

export class Meta {
  /** Подписка UI: всплывающее сообщение. */
  onToast: ((msg: string) => void) | null = null;
  /** Подписка UI: мета-состояние изменилось (перерисовать экраны). */
  onChanged: (() => void) | null = null;

  /* Счётчики текущего матча (см. шапку файла про дельта-начисление). */
  private endCreditedThisMatch = false;
  private prevEndStars = 0;
  private prevEndCoins = 0;

  constructor(
    private readonly store: Store,
    private readonly economy: Economy,
    private readonly analytics: Analytics,
    /** Инжектируемые часы — детерминизм дат в тестах. */
    private readonly now: () => Date = () => new Date()
  ) {
    this.ensureMissions();
  }

  /** Мета-ветка сейва (живая ссылка — для UI и тестов). */
  get metaState(): MetaSave {
    return this.store.state.meta;
  }

  private get m(): MetaSave {
    return this.store.state.meta;
  }

  private get stats(): StatsSave {
    return this.store.state.stats;
  }

  private toast(msg: string): void {
    this.onToast?.(msg);
  }

  private changed(): void {
    this.onChanged?.();
  }

  /* ============================ ДАТЫ ================================= */

  /** «Сегодня» с учётом тестового сдвига дней (кнопка «Новый день (тест)»). */
  today(): string {
    const d = new Date(this.now().getTime());
    d.setDate(d.getDate() + (this.m.simOffset || 0));
    return ymd(d);
  }

  /* ===================== МИССИИ ДНЯ ======================== */

  /** Набор миссий соответствует сегодняшней дате; иначе — ротация. */
  ensureMissions(): void {
    const t = this.today();
    const mi = this.m.missions;
    if (mi.date !== t) {
      mi.date = t;
      mi.set = rollMissions(t);
      mi.progress = {};
      mi.done = [];
      mi.bonusClaimed = false;
      this.store.save();
    }
  }

  /**
   * Начислить прогресс миссиям заданного типа. mode:
   *  'add' — progress += value (линии, партии, «чистое поле»);
   *  'max' — progress = max(progress, value) (комбо, очки за партию).
   */
  private advanceMissions(type: MissionType, value: number, mode: 'add' | 'max'): void {
    this.ensureMissions();
    const mi = this.m.missions;
    let changed = false;
    for (const id of mi.set) {
      const def = missionDef(id);
      if (!def || def.type !== type) continue;
      if (mi.done.indexOf(id) !== -1) continue;
      const cur = mi.progress[id] ?? 0;
      const next = mode === 'max' ? Math.max(cur, value) : cur + value;
      mi.progress[id] = next;
      changed = true;
      if (next >= def.target) this.completeMission(def.id);
    }
    if (changed) {
      this.store.save();
      this.changed();
    }
  }

  private completeMission(id: string): void {
    const def = missionDef(id);
    if (!def) return;
    const mi = this.m.missions;
    if (mi.done.indexOf(def.id) !== -1) return;
    mi.done.push(def.id);
    this.economy.addCoins(def.reward, 'mission');
    this.analytics.track('mission_complete', { mission_id: def.id, type: 'daily' });
    this.toast(t('meta.toast.missionDone', { reward: def.reward }));
    // Все 3 закрыты → бонус-сундук (04 §4.1)
    if (mi.done.length >= mi.set.length && !mi.bonusClaimed) {
      mi.bonusClaimed = true;
      this.economy.addCoins(MISSION_BONUS, 'mission_bonus');
      this.analytics.track('mission_complete', { mission_id: 'daily_bonus', type: 'daily' });
      this.toast(t('meta.toast.allMissions', { bonus: MISSION_BONUS }));
    }
    this.store.save();
  }

  /* ========================= КАРТА «ПУТЕШЕСТВИЯ» ===================== */

  nodeState(node: MapNode): NodeStatus {
    if (this.m.mapClaimed.indexOf(node.id) !== -1) return 'claimed';
    if (this.m.totalStars >= node.stars) return 'ready';
    return 'locked';
  }

  claimNode(id: number): void {
    const node = MAP_NODES.find((n) => n.id === id);
    if (!node) return;
    if (this.nodeState(node) !== 'ready') return;
    this.m.mapClaimed.push(node.id);
    const r = node.reward;
    const parts: string[] = [];
    if (r.coins) {
      this.economy.addCoins(r.coins, 'chest');
      parts.push('+' + r.coins + '🪙');
    }
    if (r.booster) {
      this.economy.addBooster(r.booster, 1, 'chest');
      parts.push('+1 ' + t(`booster.${r.booster}.name`));
    }
    this.analytics.track('currency_earn', { amount: r.coins ?? 0, source: 'map_node_' + node.id });
    this.toast(t('meta.toast.nodeClaimed', { id: node.id, parts: parts.join(', ') }));
    this.store.save();
    this.changed();
  }

  /* ============================ СТРИК ДНЕЙ =========================== */

  /** Доступна ли дневная награда (ещё не забрана сегодня). */
  streakClaimable(): boolean {
    return this.m.streak.lastClaim !== this.today();
  }

  claimStreak(): void {
    if (!this.streakClaimable()) return;
    const todayStr = this.today();
    const st = this.m.streak;
    const gap = st.lastClaim !== '' ? daysBetween(st.lastClaim, todayStr) : 1;
    let newDay: number;
    let action: string;
    if (st.lastClaim === '' || gap >= 2) {
      newDay = 1; // первый заход или пропуск 2+ дней → сброс
      st.count = 1;
      action = st.lastClaim !== '' && gap >= 2 ? 'reset' : 'inc';
    } else {
      newDay = st.day >= 7 ? 1 : st.day + 1; // цикл 7 дней
      st.count += 1;
      action = 'inc';
    }
    st.day = newDay;
    st.lastClaim = todayStr;

    const reward = STREAK_REWARDS[newDay - 1];
    const parts: string[] = [];
    if (reward.coins) {
      this.economy.addCoins(reward.coins, 'streak');
      parts.push('+' + reward.coins + '🪙');
    }
    if (reward.booster) {
      this.economy.addBooster(reward.booster, 1, 'streak');
      parts.push('+1 ' + t(`booster.${reward.booster}.name`));
    }
    this.analytics.track('streak_change', { new_value: st.count, action });
    this.toast(t('meta.toast.streakClaimed', { day: newDay, parts: parts.join(', ') }));
    this.store.save();
    this.changed();
  }

  /** Кнопка отладки: имитировать наступление следующего календарного дня. */
  simNextDay(): void {
    this.m.simOffset = (this.m.simOffset || 0) + 1;
    this.ensureMissions(); // новая дата → ротация миссий
    this.store.save();
    this.changed();
    this.toast(t('meta.toast.newDay'));
  }

  /* ======================= ХУКИ ИЗ ПАРТИИ (GameScene) =================== */

  /**
   * Ход с постановкой фигуры завершён: lines — очищено линий, mult — множитель
   * комбо этого хода, clean — собралось ли «чистое поле».
   */
  onMove(lines: number, mult: number, clean: boolean): void {
    // Монеты: 05 §2.1 — за линию 1 × множитель комбо; бонус за «чистое поле».
    if (lines > 0) this.economy.addCoins(lines * ECON.COIN_PER_LINE * mult, 'level', true);
    if (clean) this.economy.addCoins(ECON.COIN_CLEAN_BOARD, 'level', true);
    // Прогресс миссий.
    if (lines > 0) this.advanceMissions('lines', lines, 'add');
    if (mult >= 2) this.advanceMissions('combo', mult, 'max');
    if (clean) this.advanceMissions('clean', 1, 'add');
    this.analytics.track('line_clear', { lines_n: lines, combo_mult: mult });
  }

  /** Взрыв кристальной бомбы: clean — собралось ли «чистое поле». */
  onBomb(clean: boolean): void {
    if (clean) {
      this.economy.addCoins(ECON.COIN_CLEAN_BOARD, 'level', true);
      this.advanceMissions('clean', 1, 'add');
    }
  }

  /**
   * Конец партии (честный game over ядра). Начисление — дельтой (см. шапку):
   * повторный вызов в той же партии добирает только прирост.
   */
  onGameEnd(score: number): GameEndResult {
    // Звёзды за партию (04 §2) по финальному счёту.
    let stars = 0;
    for (let i = 0; i < STAR_THRESHOLDS.length; i++) {
      if (score >= STAR_THRESHOLDS[i]) stars = i + 1;
    }
    const starsDelta = this.endCreditedThisMatch ? Math.max(0, stars - this.prevEndStars) : stars;
    this.m.totalStars += starsDelta;
    this.prevEndStars = Math.max(this.prevEndStars, stars);

    // Монеты за конец партии (аналог «Победа на уровне», 05 §2.1) — тоже дельтой.
    const endCoins = Math.min(ECON.COIN_ENDGAME_MAX, Math.floor(score / ECON.COIN_ENDGAME_DIV));
    const endCoinsDelta = this.endCreditedThisMatch
      ? Math.max(0, endCoins - this.prevEndCoins)
      : endCoins;
    if (endCoinsDelta > 0) this.economy.addCoins(endCoinsDelta, 'level', true);
    this.prevEndCoins = Math.max(this.prevEndCoins, endCoins);

    // Партия засчитывается один раз за матч (оживление её не удваивает).
    if (!this.endCreditedThisMatch) {
      this.stats.gamesPlayed += 1;
      this.advanceMissions('games', 1, 'add');
    }
    this.advanceMissions('score', score, 'max');
    this.endCreditedThisMatch = true;

    this.analytics.track('game_end', { mode: 'classic', score, stars });
    this.store.save();
    this.changed();
    return { stars, coins: this.economy.getEarnedThisGame() };
  }

  /** Рестарт партии (в т.ч. первый запуск сцены). */
  onNewGame(): void {
    this.economy.resetEarnedThisGame();
    this.endCreditedThisMatch = false; // новая партия — начисление конца снова «полное»
    this.prevEndStars = 0;
    this.prevEndCoins = 0;
    this.changed();
  }
}
