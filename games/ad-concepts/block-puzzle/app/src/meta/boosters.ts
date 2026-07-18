/**
 * Бустеры в партии (Проход Е.2, порт блока «БУСТЕРЫ: ВЛИЯНИЕ НА ПАРТИЮ» из
 * meta.js): снимок для «Отмены», «Обмен» (новая тройка), «Молот» (снять клетку).
 *
 * Прототип менял var-глобалы ядра через window.*; в порте контроллер напрямую
 * мутирует переданный GameState теми же операциями и в том же порядке.
 * ЧИСТАЯ логика: тосты уходят через onToast, отрисовку обновляет сцена.
 */
import type { Board, GameState, PieceId } from '../core/types';
import { redealHand, refreshPlaceable } from '../core/game';
import type { Economy } from '../economy/economy';
import { t } from '../i18n';

/** Снимок состояния ДО хода/бомбы — один уровень отмены (05 §2.2 «Отмена»). */
interface UndoSnapshot {
  board: Board;
  hand: (PieceId | null)[];
  handMovesMade: number;
  score: number;
  chain: number;
  graceArmed: boolean;
  charge: number;
  bombReady: boolean;
}

export class BoosterController {
  /** Подписка UI: всплывающее сообщение. */
  onToast: ((msg: string) => void) | null = null;

  private snap: UndoSnapshot | null = null;
  private hammerArmed = false;

  constructor(private readonly economy: Economy) {}

  private toast(msg: string): void {
    this.onToast?.(msg);
  }

  /** Новая партия: снимок недействителен, «Молот» разряжен. */
  reset(): void {
    this.snap = null;
    this.hammerArmed = false;
  }

  /** Снимок состояния ДО мутации (сцена зовёт перед ходом и перед бомбой). */
  snapshot(state: GameState): void {
    this.snap = {
      board: state.board.map((row) => row.slice()),
      hand: state.hand.slice(),
      handMovesMade: state.handMovesMade,
      score: state.score,
      chain: state.combo.chain,
      graceArmed: state.combo.graceArmed,
      charge: state.surge.charge,
      bombReady: state.bombReady
    };
  }

  canUndo(state: GameState): boolean {
    return this.snap !== null && !state.gameOver;
  }

  /** «Отмена»: вернуть состояние снимка. true — ход отменён. */
  useUndo(state: GameState): boolean {
    if (state.gameOver) {
      this.toast(t('booster.toast.gameOver'));
      return false;
    }
    if (!this.snap) {
      this.toast(t('booster.toast.nothingToUndo'));
      return false;
    }
    if (this.economy.getBooster('undo') <= 0) return false; // защита; UI не должен пускать
    if (!this.economy.consumeBooster('undo', 'classic')) return false;
    const s = this.snap;
    state.board = s.board.map((row) => row.slice());
    state.hand = s.hand.slice();
    state.handMovesMade = s.handMovesMade;
    state.score = s.score;
    state.combo.chain = s.chain;
    state.combo.graceArmed = s.graceArmed;
    state.surge.charge = s.charge;
    state.bombReady = s.bombReady;
    this.snap = null; // один уровень отмены на ход
    refreshPlaceable(state);
    this.toast(t('booster.toast.undone'));
    return true;
  }

  /** «Обмен»: новая разрешимая тройка фигур. true — рука заменена. */
  useSwap(state: GameState): boolean {
    if (state.gameOver) {
      this.toast(t('booster.toast.gameOver'));
      return false;
    }
    if (this.economy.getBooster('swap') <= 0) return false;
    if (!this.economy.consumeBooster('swap', 'classic')) return false;
    redealHand(state); // новая разрешимая тройка (ядро, INV-G1)
    this.snap = null; // старую руку уже не вернуть
    this.toast(t('booster.toast.swapped'));
    return true;
  }

  /* ------------------------------ Молот -------------------------------- */

  /** Взвести/отменить режим «Молота» (повторный клик — отмена). */
  toggleHammer(state: GameState): void {
    if (state.gameOver) {
      this.toast(t('booster.toast.gameOver'));
      return;
    }
    if (this.economy.getBooster('hammer') <= 0) return;
    this.hammerArmed = !this.hammerArmed;
    this.toast(this.hammerArmed ? t('booster.toast.hammerArmed') : t('booster.toast.hammerCancelled'));
  }

  /** Разрядить «Молот» (рестарт/открытие меты). true — состояние изменилось. */
  disarmHammer(): boolean {
    if (!this.hammerArmed) return false;
    this.hammerArmed = false;
    return true;
  }

  isHammerArmed(): boolean {
    return this.hammerArmed;
  }

  /** Применить «Молот» к клетке поля (r, c). true — клетка снята. */
  hammerAt(state: GameState, r: number, c: number): boolean {
    if (!this.hammerArmed || state.gameOver) return false;
    const n = state.board.length;
    if (r < 0 || c < 0 || r >= n || c >= n) return false;
    if (state.board[r][c] === 0) {
      this.toast(t('booster.toast.emptyCell'));
      return false;
    }
    if (this.economy.getBooster('hammer') <= 0) {
      this.disarmHammer();
      return false;
    }
    this.snapshot(state); // молот тоже можно отменить
    if (!this.economy.consumeBooster('hammer', 'classic')) return false;
    state.board[r][c] = 0;
    this.hammerArmed = false;
    refreshPlaceable(state);
    // checkGameOver прототипа здесь опущен: снятие клетки не сужает
    // размещаемость, а gameOver обратно не снимается — вызов был no-op.
    this.toast(t('booster.toast.cellRemoved'));
    return true;
  }
}
