/**
 * CoreGame — ядро партии WordGrove (Проход Е.1, порт prototype/game.js).
 *
 * ЧИСТАЯ логика: ни Phaser, ни DOM. Рендер (WheelScene + GridUi) только
 * отображает состояние и вызывает методы; RNG подсказки и storage инжектируются.
 * Сейв — ключ 'wordgrove.save.v1' в схеме прототипа (без миграции).
 *
 * Порядок проверки слова — 11 §4.1: длина -> сетка -> дубликат -> бонус ->
 * невалидно. Мультимножество колеса соблюдено конструктивно: каждая плашка
 * в протяжке используется один раз (гарантия сцены колеса).
 *
 * Дневной режим (Проход Б, 04 §3.3): ядро играет уровень из пула по сид-дате,
 * не затрагивая прогресс кампании — campaignSnapshot хранит состояние кампании,
 * чтобы save() не перезаписал кампанийный сейв дневными клетками.
 */
import { CORE_SAVE_KEY, HINT_COST, MIN_WORD_LEN, PERFECT_BONUS, START_COINS, WIN_REWARD } from './config';
import { buildGrid, type GridModel } from './grid';
import { LEVELS } from './levels';
import { coreDefaults, sanitizeCoreSave, type CoreSave } from './save';
import { defaultStorage, type KeyValueStorage } from './storage';
import type { LevelData, Revealed, Rng } from './types';

/** Результат начисления жёлудей (см. Economy.addAcorns). */
export interface AcornResult {
  added: number;
  burned: number;
  full: boolean;
}

/** Приёмник жёлудей за бонусные слова — реализует Economy (инверсия зависимости). */
export interface AcornSink {
  addBonusAcorns(): AcornResult;
}

/** События ядра для меты (порт вызовов window.Meta.emit из game.js). */
export interface CoreHooks {
  /** Бонусное слово найдено (миссии/статистика). */
  onBonusWord?: (word: string) => void;
  /** Уровень кампании пройден и совершён переход (индекс пройденного, perfect). */
  onLevelComplete?: (index: number, perfect: boolean) => void;
}

/** Сводка победы (кампания или дневной). */
export interface WinInfo {
  /** Дневной режим: награду выдаёт Meta.onDailyComplete, кампанийная не начисляется. */
  daily: boolean;
  /** Монеты, начисленные ЭТИМ выигрышем (0 — уже выданы ранее или дневной). */
  granted: number;
  /** Полная награда кампании для экрана победы (20 + 5 за блестящий). */
  baseReward: number;
  /** Без единой подсказки. */
  perfect: boolean;
}

export type SubmitOutcome =
  | { kind: 'empty' }
  | { kind: 'tooShort'; word: string }
  | { kind: 'gridHit'; word: string; keys: readonly string[]; win: WinInfo | null }
  | { kind: 'duplicate'; word: string }
  | { kind: 'bonus'; word: string; acorns: AcornResult }
  | { kind: 'invalid'; word: string };

export type HintOutcome =
  | { ok: true; key: string; win: WinInfo | null }
  | { ok: false; reason: 'noCoins' | 'done' };

export interface CoreGameOptions {
  storage?: KeyValueStorage;
  /** RNG подсказки «Лампа» (случайная закрытая клетка). */
  rng?: Rng;
  /** Приёмник жёлудей (Economy); нет — бонус без начисления (как без economy.js). */
  acorns?: AcornSink;
  /** Трекер аналитики (заглушка 09 §1). */
  track?: (event: string, params?: Record<string, string | number | boolean>) => void;
  hooks?: CoreHooks;
  /**
   * Набор уровней (Проход Ж.1: контент языкозависим — main передаёт
   * levelsFor(locale)). По умолчанию — встроенный русский LEVELS.
   */
  levels?: readonly LevelData[];
}

/** Снимок кампании на время дневного режима (порт campaignSnapshot). */
interface CampaignSnapshot {
  level: number;
  revealed: Record<string, Revealed>;
  foundBonus: Record<string, true>;
  usedHint: boolean;
  rewardGiven: boolean;
}

export class CoreGame {
  /** Подписка UI: баланс монет изменился (пульс HUD). */
  onCoinsChanged: ((balance: number) => void) | null = null;

  private readonly storage: KeyValueStorage;
  private readonly rng: Rng;
  private readonly acorns: AcornSink | null;
  private readonly track: (event: string, params?: Record<string, string | number | boolean>) => void;
  private readonly hooks: CoreHooks;
  private readonly levels: readonly LevelData[];

  private state: CoreSave;
  private grid: GridModel;
  private dailyMode = false;
  private campaignSnapshot: CampaignSnapshot | null = null;

  constructor(opts: CoreGameOptions = {}) {
    this.storage = opts.storage ?? defaultStorage();
    this.rng = opts.rng ?? Math.random;
    this.acorns = opts.acorns ?? null;
    this.track = opts.track ?? (() => undefined);
    this.hooks = opts.hooks ?? {};
    this.levels = opts.levels ?? LEVELS;
    this.state = this.load();
    this.grid = this.buildLevel();
  }

  /* ============================ СЕЙВ ============================ */

  private load(): CoreSave {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(CORE_SAVE_KEY);
    } catch {
      raw = null;
    }
    if (raw === null) return coreDefaults();
    try {
      return sanitizeCoreSave(JSON.parse(raw));
    } catch {
      return coreDefaults(); // повреждённый JSON → чистый старт, без краша
    }
  }

  private save(): void {
    // В дневном режиме кампанийные поля берём из снимка (дневные клетки не
    // должны попасть в сейв кампании), а монеты — актуальные (порт save()).
    const snap = this.campaignSnapshot;
    const payload: CoreSave =
      this.dailyMode && snap !== null
        ? {
            level: snap.level,
            coins: this.state.coins,
            revealed: snap.revealed,
            foundBonus: snap.foundBonus,
            usedHint: snap.usedHint,
            rewardGiven: snap.rewardGiven
          }
        : this.state;
    try {
      this.storage.setItem(CORE_SAVE_KEY, JSON.stringify(payload));
    } catch {
      /* приватный режим/квота — играем без сохранения */
    }
  }

  /* ============================ УРОВЕНЬ ============================ */

  /** Индекс уровня для отображения (после финала показываем последний фоном). */
  private displayLevelIndex(): number {
    return Math.min(this.state.level, this.levels.length - 1);
  }

  private buildLevel(): GridModel {
    const level = this.levels[this.displayLevelIndex()];
    const grid = buildGrid(level);

    // Чистка сохранённых открытых клеток от чужих ключей (смена версии данных).
    const cleaned: Record<string, Revealed> = {};
    for (const k of grid.cellKeys) {
      const v = this.state.revealed[k];
      if (v) cleaned[k] = v;
    }
    this.state.revealed = cleaned;

    // Аналогично чистим бонус-копилку от слов не с этого уровня (старый сейв).
    const cleanedBonus: Record<string, true> = {};
    for (const w of Object.keys(this.state.foundBonus)) {
      if (grid.bonusWords.has(w)) cleanedBonus[w] = true;
    }
    this.state.foundBonus = cleanedBonus;

    this.grid = grid;
    return grid;
  }

  /* ============================ ГЕТТЕРЫ ============================ */

  getLevelData(): LevelData {
    return this.levels[this.displayLevelIndex()];
  }

  getGrid(): GridModel {
    return this.grid;
  }

  getWheel(): readonly string[] {
    return this.getLevelData().wheel;
  }

  getCoins(): number {
    return this.state.coins;
  }

  /** Индекс текущего уровня (в дневном режиме — индекс дневного). */
  getLevelIndex(): number {
    return this.state.level;
  }

  /** Прогресс КАМПАНИИ (в дневном режиме — из снимка; порт WG.getLevel). */
  getCampaignLevel(): number {
    const lv = this.dailyMode && this.campaignSnapshot !== null ? this.campaignSnapshot.level : this.state.level;
    return Math.min(lv, this.levels.length);
  }

  getTotalLevels(): number {
    return this.levels.length;
  }

  /** Кампания пройдена целиком (не относится к дневному режиму). */
  isFinished(): boolean {
    return !this.dailyMode && this.state.level >= this.levels.length;
  }

  isDailyMode(): boolean {
    return this.dailyMode;
  }

  getRevealed(): Readonly<Record<string, Revealed>> {
    return this.state.revealed;
  }

  isRevealed(key: string): boolean {
    return !!this.state.revealed[key];
  }

  wordCompleted(word: string): boolean {
    const keys = this.grid.wordCells.get(word);
    return keys !== undefined && keys.every((k) => this.isRevealed(k));
  }

  allCompleted(): boolean {
    return this.grid.cellKeys.every((k) => this.isRevealed(k));
  }

  getFoundBonus(): string[] {
    return Object.keys(this.state.foundBonus).sort();
  }

  usedHintThisLevel(): boolean {
    return this.state.usedHint;
  }

  /** Награда кампании для отображения на экране победы. */
  winBaseReward(): number {
    return WIN_REWARD + (this.state.usedHint ? 0 : PERFECT_BONUS);
  }

  /* ============================ ПРОВЕРКА СЛОВА ============================ */

  submitWord(word: string): SubmitOutcome {
    if (word.length === 0) return { kind: 'empty' };
    if (word.length < MIN_WORD_LEN) return { kind: 'tooShort', word };

    if (this.grid.gridWords.has(word)) {
      if (this.wordCompleted(word)) return { kind: 'duplicate', word }; // 03 §2.1: нейтрально
      return this.openGridWord(word); // GRID_HIT
    }

    if (this.state.foundBonus[word]) return { kind: 'duplicate', word };

    if (this.grid.bonusWords.has(word)) {
      // BONUS: валидное слово не из сетки → жёлуди в копилку (05 §2.2, 04 §3.4).
      this.state.foundBonus[word] = true;
      const acorns: AcornResult = this.acorns !== null ? this.acorns.addBonusAcorns() : { added: 0, burned: 0, full: false };
      this.hooks.onBonusWord?.(word);
      this.save();
      return { kind: 'bonus', word, acorns };
    }

    return { kind: 'invalid', word }; // INVALID: мягкая тряска, без штрафа (03 §1)
  }

  private openGridWord(word: string): SubmitOutcome {
    const keys = this.grid.wordCells.get(word) ?? [];
    for (const key of keys) {
      if (!this.state.revealed[key]) this.state.revealed[key] = 1;
    }
    this.save();
    const win = this.checkWin();
    return { kind: 'gridHit', word, keys, win };
  }

  /* ============================ ПОДСКАЗКА «ЛАМПА» ============================ */

  useHint(): HintOutcome {
    if (this.allCompleted()) return { ok: false, reason: 'done' };
    if (this.state.coins < HINT_COST) return { ok: false, reason: 'noCoins' };
    const hidden = this.grid.cellKeys.filter((k) => !this.state.revealed[k]);
    if (hidden.length === 0) return { ok: false, reason: 'done' };
    const key = hidden[Math.floor(this.rng() * hidden.length)];
    this.state.coins -= HINT_COST;
    this.state.usedHint = true;
    this.state.revealed[key] = 2;
    this.save();
    const win = this.checkWin();
    return { ok: true, key, win };
  }

  /**
   * Открыть случайную скрытую букву БЕСПЛАТНО (порт WG.revealFreeLetter):
   * хук для rewarded RV-1 и клубного безлимита (Проход Е.2). usedHint=true —
   * любое открытие буквы снимает «блестящий проход», как и платная Лампа.
   */
  revealFreeLetter(): { key: string; win: WinInfo | null } | null {
    if (this.allCompleted()) return null;
    const hidden = this.grid.cellKeys.filter((k) => !this.state.revealed[k]);
    if (hidden.length === 0) return null;
    const key = hidden[Math.floor(this.rng() * hidden.length)];
    this.state.usedHint = true;
    this.state.revealed[key] = 2;
    this.save();
    return { key, win: this.checkWin() };
  }

  /* ============================ ПОБЕДА / ПЕРЕХОДЫ ============================ */

  /**
   * Идемпотентная проверка победы (порт checkWin): начисляет награду кампании
   * ровно один раз (rewardGiven); в дневном режиме монеты дня выдаёт Meta.
   */
  private checkWin(): WinInfo | null {
    if (!this.allCompleted()) return null;
    if (this.dailyMode) {
      if (!this.state.rewardGiven) this.state.rewardGiven = true;
      this.save();
      return { daily: true, granted: 0, baseReward: 0, perfect: !this.state.usedHint };
    }
    const base = this.winBaseReward();
    let granted = 0;
    if (!this.state.rewardGiven) {
      this.state.rewardGiven = true;
      this.state.coins += base;
      granted = base;
      this.onCoinsChanged?.(this.state.coins);
    }
    this.save();
    return { daily: false, granted, baseReward: base, perfect: !this.state.usedHint };
  }

  /** Победа уже была на этом уровне (перезагрузка на экране победы). */
  currentWin(): WinInfo | null {
    if (!this.allCompleted()) return null;
    if (this.dailyMode) return { daily: true, granted: 0, baseReward: 0, perfect: !this.state.usedHint };
    return { daily: false, granted: 0, baseReward: this.winBaseReward(), perfect: !this.state.usedHint };
  }

  private resetLevelState(): void {
    this.state.revealed = {};
    this.state.foundBonus = {};
    this.state.usedHint = false;
    this.state.rewardGiven = false;
  }

  /**
   * Переход к следующему уровню кампании (кнопка «Дальше»). Эмитит
   * level_complete ПОСЛЕ инкремента (мета видит актуальный прогресс).
   */
  nextLevel(): 'next' | 'finished' {
    const completedIndex = this.state.level;
    const wasPerfect = !this.state.usedHint;
    this.state.level += 1;
    this.resetLevelState();
    this.save();
    this.hooks.onLevelComplete?.(completedIndex, wasPerfect);
    this.buildLevel();
    return this.state.level >= this.levels.length ? 'finished' : 'next';
  }

  /** Рестарт уровня: foundBonus сохраняем (антифарм, 11 §4.2). */
  restartLevel(): boolean {
    if (this.isFinished()) return false;
    this.state.revealed = {};
    this.state.usedHint = false;
    this.state.rewardGiven = false;
    this.save();
    this.buildLevel();
    return true;
  }

  /** «Играть с начала» после финала: монеты сохраняются. */
  replayFromStart(): void {
    this.state.level = 0;
    this.resetLevelState();
    this.save();
    this.buildLevel();
  }

  /** Полный сброс ядра (жёлуди/мету сбрасывают их владельцы). */
  wipe(): void {
    this.dailyMode = false;
    this.campaignSnapshot = null;
    this.state = coreDefaults();
    this.save();
    this.buildLevel();
    this.onCoinsChanged?.(this.state.coins);
  }

  /* ==================== ДНЕВНОЙ КРОССВОРД (Проход Б, 04 §3.3) ==================== */

  /** Войти в дневной режим: уровень idx из пула, кампания — в снимок. */
  startDaily(idx: number): boolean {
    if (this.dailyMode) return false;
    let dayIdx = idx;
    if (!Number.isInteger(dayIdx) || dayIdx < 0 || dayIdx >= this.levels.length) dayIdx = 0;
    this.dailyMode = true;
    this.campaignSnapshot = {
      level: this.state.level,
      revealed: this.state.revealed,
      foundBonus: this.state.foundBonus,
      usedHint: this.state.usedHint,
      rewardGiven: this.state.rewardGiven
    };
    // Эфемерное состояние дневного уровня (в сейв кампании не попадёт — save()).
    this.state.level = dayIdx;
    this.state.revealed = {};
    this.state.foundBonus = {};
    this.state.usedHint = false;
    this.state.rewardGiven = false;
    this.buildLevel();
    return true;
  }

  /** Выйти из дневного режима: восстановить кампанию. */
  exitDaily(): void {
    if (!this.dailyMode || this.campaignSnapshot === null) {
      this.dailyMode = false;
      return;
    }
    const snap = this.campaignSnapshot;
    this.dailyMode = false;
    this.campaignSnapshot = null;
    this.state.level = snap.level;
    this.state.revealed = snap.revealed;
    this.state.foundBonus = snap.foundBonus;
    this.state.usedHint = snap.usedHint;
    this.state.rewardGiven = snap.rewardGiven;
    this.buildLevel();
  }

  /* ==================== МОСТ К СЛОЯМ МЕТЫ (порт window.WG) ==================== */

  /** Внешние начисления (дневной, стрик, миссии, регион, копилка) — с персистом. */
  addCoins(n: number, source?: string): void {
    const amt = Math.floor(n || 0);
    if (!amt) return;
    this.state.coins += amt;
    this.save();
    this.track('currency_earn', {
      currency: 'coin',
      amount: amt,
      source: source ?? 'meta',
      balance_after: this.state.coins
    });
    this.onCoinsChanged?.(this.state.coins);
  }

  /** Списание монет метой (бустеры/заморозка). true — хватило средств. */
  spendCoins(n: number, sink?: string): boolean {
    const amt = Math.floor(n || 0);
    if (amt < 0 || this.state.coins < amt) return false;
    this.state.coins -= amt;
    this.save();
    this.track('currency_spend', {
      currency: 'coin',
      amount: amt,
      sink: sink ?? 'meta',
      balance_after: this.state.coins
    });
    this.onCoinsChanged?.(this.state.coins);
    return true;
  }

  /** Стартовый баланс (для UI финального сброса). */
  static get START_COINS(): number {
    return START_COINS;
  }
}
