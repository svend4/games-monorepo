/**
 * Мета-прогрессия (Проход Е.1, порт ЛОГИКИ из prototype/meta.js): сад с зонами
 * и заказами (04 §4.2 — сердце модели), стрик «Утренняя лейка» и миссии (§4.4).
 * ЧИСТАЯ логика без DOM — рендер мета-экрана живёт в ui/MetaUi.ts.
 *
 * Петля (04 §4.8): солитер → монеты (W(n)) + урожай (карты 🍎) → заказы сада
 * потребляют урожай/монеты → зона продвигается, открывается новый заказ →
 * мотив сыграть ещё раздачу за урожаем.
 *
 * Часы инжектируются (clock: () => number, мс) — стрик/суточные сбросы
 * тестируются без реального времени; сдвиг simDayOffset («Новый день (тест)»)
 * добавляется поверх, как в прототипе.
 */
import { ECON, type MissionDef, type MissionType, type StreakReward } from '../economy/econ';
import type { Economy } from '../economy/economy';
import type { Analytics } from '../economy/analytics';
import type { Store } from '../economy/store';
import type { SaveState } from '../economy/save';
import { DAY_MS, dateStr, weekKeyOf } from './dates';
import { ALMANAC_PER_ORDER, FLAT, TOTAL_ORDERS, ZONES, zoneCompleteBonus, type FlatOrder } from './config';

export interface StreakStatus {
  claimable: boolean;
  day: number;
}

/** Итог выполнения заказа: завершилась ли зона (для тоста/наград UI). */
export interface OrderResult {
  zoneCompleted: { name: string; bonus: number } | null;
}

/** Награда дня стрика с безопасным индексом (день 1..7, дальше — 7). */
export function streakRewardFor(day: number): StreakReward {
  const idx = Math.max(1, Math.min(7, day || 1));
  return ECON.STREAK_REWARDS[idx] ?? { coins: 0 };
}

function allMissions(): readonly MissionDef[] {
  return [...ECON.DAILY_MISSIONS, ...ECON.WEEKLY_MISSIONS];
}

export function missionById(id: string): MissionDef | null {
  return allMissions().find((d) => d.id === id) ?? null;
}

export class Meta {
  /** Прогресс миссий изменился по игровому событию (UI перерисовывает вкладку). */
  onMissionsChanged: (() => void) | null = null;

  constructor(
    private readonly store: Store,
    private readonly economy: Economy,
    private readonly analytics: Analytics,
    private readonly clock: () => number = () => Date.now()
  ) {
    // Economy считает бонус за сток от номера главы (зона активного заказа + 1).
    economy.chapterProvider = () => this.currentChapter();
    this.refreshMissions();
  }

  /** Живая ссылка на сейв (переживает Store.reset). */
  private get st(): SaveState {
    return this.store.state;
  }

  /* ======================= ДАТЫ / СИМ-ДЕНЬ (тест) ======================= */

  private nowMs(): number {
    return this.clock() + (this.st.stats.simDayOffset || 0) * DAY_MS;
  }

  today(): string {
    return dateStr(this.nowMs());
  }

  private yesterday(): string {
    return dateStr(this.nowMs() - DAY_MS);
  }

  private weekKey(): number {
    return weekKeyOf(this.nowMs());
  }

  /** Кнопка «Новый день (тест)»: сдвиг виртуального «сегодня» на день вперёд. */
  newDay(): void {
    this.st.stats.simDayOffset = (this.st.stats.simDayOffset || 0) + 1;
    this.store.save();
    this.refreshMissions();
  }

  /* ========================= СТРИК (04 §4.4) =========================== */

  streakStatus(): StreakStatus {
    const st = this.st.streak;
    const t = this.today();
    if (st.lastClaim === t) return { claimable: false, day: st.day }; // уже забрали сегодня
    const newDay = st.lastClaim === this.yesterday() ? Math.min(7, (st.day || 0) + 1) : 1;
    return { claimable: true, day: newDay };
  }

  claimStreak(): boolean {
    const s = this.streakStatus();
    if (!s.claimable) return false;
    const rw = streakRewardFor(s.day);
    this.economy.addCoins(rw.coins, 'streak');
    if (rw.undo) this.economy.addFreeUndo(rw.undo);
    if (rw.joker) this.economy.addBooster('joker', rw.joker, 'streak');
    if (rw.basket) this.economy.addBooster('basket', rw.basket, 'streak');
    this.st.streak.day = s.day;
    this.st.streak.lastClaim = this.today();
    this.store.save();
    this.analytics.track('streak_update', { day_no: s.day });
    return true;
  }

  /* ========================= МИССИИ (04 §4.4) ========================== */

  refreshMissions(): void {
    const m = this.st.missions;
    const t = this.today();
    const wk = this.weekKey();
    let changed = false;
    if (m.day !== t) {
      for (const d of ECON.DAILY_MISSIONS) {
        delete m.prog[d.id];
        delete m.claimed[d.id];
      }
      m.day = t;
      changed = true;
    }
    if (m.week !== wk) {
      for (const d of ECON.WEEKLY_MISSIONS) {
        delete m.prog[d.id];
        delete m.claimed[d.id];
      }
      m.week = wk;
      changed = true;
    }
    if (changed) this.store.save();
  }

  /** Прогресс миссий по игровым событиям. type: harvest|chain5|orders|wins. */
  track(type: MissionType, amount = 1): void {
    this.refreshMissions();
    const m = this.st.missions;
    let touched = false;
    for (const def of allMissions()) {
      if (def.type !== type || m.claimed[def.id]) continue;
      const cur = m.prog[def.id] ?? 0;
      if (cur >= def.target) continue;
      m.prog[def.id] = Math.min(def.target, cur + amount);
      touched = true;
    }
    if (touched) {
      this.store.save();
      this.onMissionsChanged?.();
    }
  }

  missionProgress(id: string): number {
    return this.st.missions.prog[id] ?? 0;
  }

  missionClaimed(id: string): boolean {
    return this.st.missions.claimed[id] === true;
  }

  claimMission(id: string): boolean {
    const def = missionById(id);
    if (def === null) return false;
    const m = this.st.missions;
    if (m.claimed[id] || (m.prog[id] ?? 0) < def.target) return false;
    this.economy.addCoins(def.coins, 'mission');
    if (def.card) this.st.garden.cards += 1;
    m.claimed[id] = true;
    this.store.save();
    this.analytics.track('mission_complete', { mission_id: id, coins: def.coins });
    return true;
  }

  /* ====================== ЗАКАЗЫ САДА (04 §4.2) ======================== */

  /** Индекс зоны текущего активного заказа (для бонуса за сток = глава). */
  currentZoneIdx(): number {
    let done = this.st.garden.completed;
    if (!(done >= 0)) done = 0; // защита от NaN/отрицательного индекса
    if (done >= TOTAL_ORDERS) return ZONES.length - 1;
    const entry = FLAT[done];
    return entry !== undefined ? entry.zoneIdx : ZONES.length - 1; // битый индекс не роняет мету
  }

  currentChapter(): number {
    return this.currentZoneIdx() + 1;
  }

  gardenCompleted(): number {
    return this.st.garden.completed;
  }

  herbCards(): number {
    return this.st.garden.cards;
  }

  almanacPoints(): number {
    return this.st.almanac;
  }

  activeOrder(): FlatOrder | null {
    if (this.st.garden.completed >= TOTAL_ORDERS) return null; // сад пройден целиком
    return FLAT[this.st.garden.completed] ?? null;
  }

  canComplete(entry: FlatOrder | null): boolean {
    if (entry === null) return false;
    return (
      this.economy.getHarvest() >= entry.order.costH && this.economy.getCoins() >= entry.order.costC
    );
  }

  /**
   * Выполнить активный заказ: списать урожай/монеты, начислить награду,
   * продвинуть зону; на границе зоны — крупный бонус + карточка гербария.
   * null — заказ недоступен (сад пройден или не хватает ресурсов).
   */
  completeActiveOrder(): OrderResult | null {
    const entry = this.activeOrder();
    if (entry === null || !this.canComplete(entry)) return null;
    const o = entry.order;
    this.economy.spendHarvest(o.costH);
    if (o.costC > 0) this.economy.spendCoins(o.costC, 'order');
    const idx = this.st.garden.completed;
    this.st.garden.completed += 1;
    this.st.almanac += ALMANAC_PER_ORDER;
    this.economy.addCoins(o.rc, 'order'); // награда за заказ (04 §4.2)
    this.analytics.track('order_complete', {
      order_id: idx,
      zone_id: entry.zoneIdx,
      harvest_spent: o.costH
    });
    // Завершение зоны → крупная награда (04 §4.2/§4.3).
    const zone = ZONES[entry.zoneIdx];
    let zoneCompleted: OrderResult['zoneCompleted'] = null;
    if (this.st.garden.completed >= zone.endIndex) {
      const bonus = zoneCompleteBonus(entry.zoneIdx);
      this.economy.addCoins(bonus, 'zone_complete');
      this.st.garden.cards += 1; // карточка гербария за зону (флейвор)
      this.analytics.track('zone_complete', { zone_id: entry.zoneIdx });
      zoneCompleted = { name: zone.name, bonus };
    }
    this.store.save();
    this.track('orders', 1); // прогресс миссий
    return { zoneCompleted };
  }
}
