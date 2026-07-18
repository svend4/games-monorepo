/**
 * Мета-прогрессия (Проход Е.1, порт логики prototype/meta.js БЕЗ DOM):
 *   04 §3.1 Атлас   — регионы уровней, награда за полный регион (раз в регион);
 *   04 §3.3 Дневной — кроссворд дня по сид-дате + стрик с вехами 3/7/14/30;
 *   04 §3.5 Миссии  — daily-миссии по игровым событиям;
 *   статистика (bonusTotal/dailyTotal) для будущих слоёв.
 *
 * ЧИСТАЯ логика: DOM-экран — src/ui/MetaUi.ts. Модуль владеет своим сейвом
 * 'wordgrove.meta.v1' (схема прототипа 1:1, без миграции); монеты берёт/выдаёт
 * через мост bridge (порт window.WG), жёлуди — через Economy. Часы (now)
 * инжектируются — детерминизм дат в тестах.
 */
import { LEVELS } from '../core/levels';
import { defaultStorage, type KeyValueStorage } from '../core/storage';
import type { Analytics } from '../economy/analytics';
import { ECON } from '../economy/econ';
import type { Economy } from '../economy/economy';
import {
  META_SAVE_KEY,
  MISSIONS,
  REGIONS,
  STREAK_MILESTONE_DAYS,
  THEMES,
  missionDef,
  type MissionMetric,
  type RegionDef
} from './config';
import { dayOfYear, isYesterday, todayStr } from './dates';

/** Мост к ядру (порт window.WG): монеты и прогресс кампании. */
export interface MetaBridge {
  getCoins(): number;
  addCoins(n: number, source?: string): void;
  getCampaignLevel(): number;
  getTotalLevels(): number;
}

export interface MissionRow {
  id: string;
  progress: number;
  claimed: boolean;
}

export interface MetaSave {
  daily: { lastDate: string | null; streak: number; longest: number };
  missions: { date: string | null; list: MissionRow[] };
  regions: { claimed: Record<string, boolean> };
  stats: { bonusTotal: number; dailyTotal: number };
}

/** Сводка победы в дневном для оверлея (порт onDailyComplete). */
export interface DailyResult {
  already: boolean;
  coins: number;
  streak: number;
  milestone: number;
}

export type CoreEvent = 'bonus_word' | 'level_complete';

export interface CoreEventPayload {
  word?: string;
  index?: number;
  perfect?: boolean;
}

function metaDefaults(): MetaSave {
  return {
    daily: { lastDate: null, streak: 0, longest: 0 },
    missions: { date: null, list: [] },
    regions: { claimed: {} },
    stats: { bonusTotal: 0, dailyTotal: 0 }
  };
}

function toCount(v: unknown, def: number): number {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.floor(v);
  return def;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Санитайзинг сейва меты (порт loadMeta): неизвестные id миссий отбрасываются,
 * progress приводится к [0..target] (повреждённый progress="abc"/Infinity дал бы
 * забрать награду без выполнения), claimed — к boolean. Экспорт для тестов.
 */
export function sanitizeMetaSave(raw: unknown): MetaSave {
  const out = metaDefaults();
  if (!isPlainObject(raw)) return out;

  if (isPlainObject(raw.daily)) {
    const d = raw.daily;
    if (typeof d.lastDate === 'string') out.daily.lastDate = d.lastDate;
    out.daily.streak = toCount(d.streak, 0);
    out.daily.longest = toCount(d.longest, 0);
  }
  if (isPlainObject(raw.missions)) {
    const m = raw.missions;
    if (typeof m.date === 'string') out.missions.date = m.date;
    if (Array.isArray(m.list)) {
      out.missions.list = m.list
        .filter((row): row is Record<string, unknown> => isPlainObject(row) && typeof row.id === 'string' && missionDef(row.id) !== null)
        .map((row) => {
          const def = missionDef(row.id as string);
          const target = def !== null ? def.target : 0;
          return {
            id: row.id as string,
            progress: Math.min(toCount(row.progress, 0), target),
            claimed: !!row.claimed
          };
        });
    }
  }
  if (isPlainObject(raw.regions) && isPlainObject(raw.regions.claimed)) {
    for (const id of Object.keys(raw.regions.claimed)) {
      if (raw.regions.claimed[id]) out.regions.claimed[id] = true;
    }
  }
  if (isPlainObject(raw.stats)) {
    out.stats.bonusTotal = toCount(raw.stats.bonusTotal, 0);
    out.stats.dailyTotal = toCount(raw.stats.dailyTotal, 0);
  }
  return out;
}

export class Meta {
  /** Мост к ядру; назначается в main после создания CoreGame. */
  bridge: MetaBridge | null = null;
  /** Подписка UI: тост (награда региона и т.п.). */
  onToast: ((msg: string) => void) | null = null;
  /** Подписка UI: мета изменилась (бейдж/перерисовка экрана). */
  onChanged: (() => void) | null = null;

  private meta: MetaSave;

  constructor(
    private readonly economy: Economy,
    private readonly analytics?: Analytics,
    private readonly storage: KeyValueStorage = defaultStorage(),
    /** Инжектируемые часы — детерминизм дат в тестах. */
    private readonly now: () => Date = () => new Date()
  ) {
    this.meta = this.loadMeta();
  }

  /** Живое состояние меты (для UI и тестов). */
  get state(): MetaSave {
    return this.meta;
  }

  /* ============================ СЕЙВ ============================ */

  private loadMeta(): MetaSave {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(META_SAVE_KEY);
    } catch {
      return metaDefaults();
    }
    if (raw === null) return metaDefaults();
    try {
      return sanitizeMetaSave(JSON.parse(raw));
    } catch {
      return metaDefaults();
    }
  }

  private saveMeta(): void {
    try {
      this.storage.setItem(META_SAVE_KEY, JSON.stringify(this.meta));
    } catch {
      /* приватный режим/квота */
    }
  }

  private track(event: string, params?: Record<string, string | number | boolean>): void {
    this.analytics?.track(event, params);
  }

  private changed(): void {
    this.onChanged?.();
  }

  /* ============================ ДАТЫ / ДНЕВНОЙ (04 §3.3) ============================ */

  todayStr(): string {
    return todayStr(this.now());
  }

  private totalLevels(): number {
    return this.bridge !== null ? this.bridge.getTotalLevels() : LEVELS.length;
  }

  /** Детерминированный уровень дня из пула по сид-дате (формула прототипа 1:1). */
  dailySeedIndex(): number {
    const d = this.todayStr();
    let h = 0;
    for (let i = 0; i < d.length; i++) h = (h * 31 + d.charCodeAt(i)) >>> 0;
    return h % this.totalLevels();
  }

  todayTheme(): string {
    return THEMES[dayOfYear(this.now()) % THEMES.length];
  }

  isDailyDoneToday(): boolean {
    return this.meta.daily.lastDate === this.todayStr();
  }

  nextMilestone(streak: number): number | null {
    for (const days of STREAK_MILESTONE_DAYS) {
      if (days > streak) return days;
    }
    return null;
  }

  /**
   * Победа в дневном режиме (вызывает UI при показе оверлея победы дневного).
   * Начисляет монеты дня + веху стрика; идемпотентно в пределах дня (1/день).
   */
  onDailyComplete(): DailyResult {
    const today = this.todayStr();
    if (this.meta.daily.lastDate === today) {
      return { already: true, coins: 0, streak: this.meta.daily.streak, milestone: 0 };
    }
    if (this.meta.daily.lastDate !== null && isYesterday(this.meta.daily.lastDate, today)) {
      this.meta.daily.streak += 1;
    } else {
      this.meta.daily.streak = 1;
    }
    this.meta.daily.lastDate = today;
    if (this.meta.daily.streak > this.meta.daily.longest) this.meta.daily.longest = this.meta.daily.streak;
    this.meta.stats.dailyTotal += 1;

    const milestone = ECON.STREAK_MILESTONES[this.meta.daily.streak] ?? 0;
    const coins = ECON.DAILY_COINS + milestone;
    this.addCoins(coins, milestone > 0 ? 'daily+streak_milestone' : 'daily');
    this.track('daily_finish', { theme_id: this.todayTheme(), is_premium: false, streak_after: this.meta.daily.streak });
    if (milestone > 0) this.track('streak_milestone', { days: this.meta.daily.streak });

    this.saveMeta();
    this.changed();
    return { already: false, coins, streak: this.meta.daily.streak, milestone };
  }

  /* ============================ МИССИИ (04 §3.5) ============================ */

  ensureMissionsToday(): void {
    const today = this.todayStr();
    if (this.meta.missions.date === today && this.meta.missions.list.length > 0) return;
    this.meta.missions.date = today;
    this.meta.missions.list = MISSIONS.map((m) => ({ id: m.id, progress: 0, claimed: false }));
    this.saveMeta();
  }

  private bumpMissions(metric: MissionMetric, amount: number): void {
    this.ensureMissionsToday();
    for (const row of this.meta.missions.list) {
      const def = missionDef(row.id);
      if (def === null || def.metric !== metric) continue;
      if (row.progress < def.target) row.progress = Math.min(def.target, row.progress + amount);
    }
  }

  claimMission(id: string): boolean {
    this.ensureMissionsToday();
    const row = this.meta.missions.list.find((r) => r.id === id) ?? null;
    const def = missionDef(id);
    if (row === null || def === null) return false;
    if (row.claimed || row.progress < def.target) return false;
    row.claimed = true;
    if (def.coins > 0) this.addCoins(def.coins, 'mission:' + id);
    if (def.acorns > 0) this.economy.addAcorns(def.acorns);
    this.track('mission_complete', { mission_id: id, type: 'daily' });
    this.saveMeta();
    this.changed();
    return true;
  }

  missionsClaimable(): boolean {
    this.ensureMissionsToday();
    for (const row of this.meta.missions.list) {
      const def = missionDef(row.id);
      if (def !== null && !row.claimed && row.progress >= def.target) return true;
    }
    return false;
  }

  /* ============================ АТЛАС (04 §3.1) ============================ */

  levelsDone(): number {
    return this.bridge !== null ? this.bridge.getCampaignLevel() : 0;
  }

  regionDone(region: RegionDef): boolean {
    const done = this.levelsDone();
    return region.levels.every((lvl) => lvl < done);
  }

  /**
   * Выдать награды за полностью пройденные регионы (раз в регион).
   * Вызывается при завершении уровня и при init (миграция игрока Прохода А).
   */
  checkRegions(silent: boolean): void {
    for (const region of REGIONS) {
      if (this.meta.regions.claimed[region.id]) continue;
      if (!this.regionDone(region)) continue;
      this.meta.regions.claimed[region.id] = true;
      this.addCoins(ECON.REGION_REWARD, 'region:' + region.id);
      this.track('postcard_earned', { postcard_id: region.id, region: region.id });
      this.saveMeta();
      if (!silent) {
        this.onToast?.(region.emoji + ' Регион «' + region.name + '» пройден! +' + ECON.REGION_REWARD + ' 🪙');
      }
    }
  }

  /* ============================ СОБЫТИЯ ЯДРА ============================ */

  /** CoreGame вызывает через хуки (порт Meta.emit). */
  emit(evt: CoreEvent, payload: CoreEventPayload = {}): void {
    if (evt === 'bonus_word') {
      this.meta.stats.bonusTotal += 1;
      this.bumpMissions('bonus_word', 1);
    } else if (evt === 'level_complete') {
      this.bumpMissions('level_complete', 1);
      if (payload.perfect === true) this.bumpMissions('level_perfect', 1);
      this.checkRegions(false);
    }
    this.saveMeta();
    this.changed();
  }

  /* ============================ МОСТ К МОНЕТАМ ============================ */

  private addCoins(n: number, source: string): void {
    this.bridge?.addCoins(n, source);
  }

  getCoins(): number {
    return this.bridge !== null ? this.bridge.getCoins() : 0;
  }

  /* ============================ БЕЙДЖ / СБРОС / INIT ============================ */

  /** «Есть что забрать»: миссия готова / дневной не пройден / копилка полна. */
  anyActionable(): boolean {
    return this.missionsClaimable() || !this.isDailyDoneToday() || this.economy.isPiggyFull();
  }

  reset(): void {
    this.meta = metaDefaults();
    this.saveMeta();
    this.changed();
  }

  /**
   * Инициализация ПОСЛЕ загрузки сейва ядра: миссии дня + миграция — выдать
   * награды за уже пройденные регионы (игрок Прохода А), без тостов.
   */
  init(): void {
    this.ensureMissionsToday();
    this.checkRegions(true);
    this.changed();
  }
}
