/**
 * GameScene — Phaser-рендер ядра Block Surge (Проход Е.1).
 * Вся игровая логика — в src/core (чистые модули); сцена только рисует состояние,
 * обрабатывает drag&drop и проигрывает FX. Геометрия и палитра 1:1 из прототипа.
 *
 * HUD — Phaser-текст ВНУТРИ канваса, а не DOM-оверлей, как в прототипе.
 * Обоснование: один рендер-пайплайн — HUD масштабируется Scale.FIT вместе с полем
 * без рассинхрона координат/DPI между DOM-слоем и канвасом; в Capacitor WebView
 * (глава 10) не нужно координировать два дерева отрисовки; и весь экран
 * скриншотится/записывается для UA-креативов одним снимком канваса.
 */
import Phaser from 'phaser';
import type { GameState, PieceId } from '../core/types';
import { DEF } from '../core/catalog';
import { BOARD_N, canPlace, previewLines } from '../core/board';
import { CLEAN_BONUS, SURGE_MAX, multFor } from '../core/scoring';
import { createGame, dropBomb, placePiece } from '../core/game';
import { randomSeed } from '../core/rng';
import { ECON, type BoosterId } from '../economy/econ';
import type { Economy } from '../economy/economy';
import type { Meta } from '../meta/meta';
import type { BoosterController } from '../meta/boosters';
import type { MetaUi } from '../ui/MetaUi';
import type { MonetizeController } from '../monetize/monetize';
import { t } from '../i18n';
import { onThemeChanged, theme } from '../ui/theme';

/** Сервисы меты (Проход Е.2): экономика, прогрессия, бустеры, DOM-оверлей,
 * монетизация (interstitial на рестарте + rewarded на экране итога). */
export interface MetaServices {
  economy: Economy;
  meta: Meta;
  boosters: BoosterController;
  ui: MetaUi;
  monetize: MonetizeController;
}

/* ==================== ГЕОМЕТРИЯ (1:1 из прототипа + HUD) ==================== */

const N = BOARD_N;
const CELL = 46;              // размер клетки поля (логический px)
const PAD = 14;
const HUD_H = 108;            // HUD теперь в канвасе — поле сдвинуто вниз
const GRID_W = N * CELL;      // 368
const BOARD_X = PAD;
const BOARD_Y = HUD_H;
const DOCK_GAP = 18;
const DOCK_Y = BOARD_Y + GRID_W + DOCK_GAP;
const DOCK_H = 112;
const SLOT_GAP = 8;
const SLOT_W = (GRID_W - 3 * SLOT_GAP) / 4; // 3 гнезда фигур + гнездо бомбы
const DOCK_CELL = 15;         // размер клетки фигуры в доке
const LIFT_MOUSE = 26;        // подъём фигуры над курсором (мышь)
const LIFT_TOUCH = 80;        // подъём над пальцем (03 §3: 80 px)
const CLEAR_ANIM_MS = 300;
const FLOAT_ANIM_MS = 800;
const RING_ANIM_MS = 500;
const OVER_DELAY_MS = 450;    // пауза перед экраном результата (доигрывает FX)
const STORAGE_BEST = 'blocksurge_best'; // тот же ключ — сейв прототипа подхватывается

export const GAME_W = PAD * 2 + GRID_W;   // 396
export const GAME_H = DOCK_Y + DOCK_H + PAD; // 620

/** Логический прямоугольник внутри канваса (координаты сцены). */
export interface LogicalRect { x: number; y: number; w: number; h: number }

/**
 * Регионы канваса для коуч-марок FTUE (Проход Ж.1) — аналог глобалов
 * BOARD_X/DOCK_Y/slotRect, которые прототип читал с window. OnboardingUi
 * переводит их в экранные координаты через rect канваса (Scale.FIT).
 */
export const CANVAS_RECTS: Readonly<Record<'board' | 'dock' | 'bombSlot' | 'surge', LogicalRect>> = {
  board: { x: BOARD_X, y: BOARD_Y, w: GRID_W, h: GRID_W },
  dock: { x: BOARD_X, y: DOCK_Y, w: GRID_W, h: DOCK_H },
  bombSlot: { x: BOARD_X + 3 * (SLOT_W + SLOT_GAP), y: DOCK_Y, w: SLOT_W, h: DOCK_H },
  surge: { x: BOARD_X, y: 80, w: 340, h: 24 } // шкала «Прилива» + процент в HUD
};

/* Палитра фигур 1:1 из прототипа (индекс = colorIdx каталога). */
const COLORS: readonly number[] = [
  0xff6b6b, 0xffa94d, 0xffd43b, 0x69db7c, 0x38d9a9, 0x4dabf7, 0x9775fa, 0xf783ac
];

const FONT = 'system-ui, sans-serif';

function slotRect(i: number): { x: number; y: number; w: number; h: number } {
  return { x: BOARD_X + i * (SLOT_W + SLOT_GAP), y: DOCK_Y, w: SLOT_W, h: DOCK_H };
}

function boardToPx(r: number, c: number): { x: number; y: number } {
  return { x: BOARD_X + c * CELL, y: BOARD_Y + r * CELL };
}

/* ============================ ТИПЫ СЦЕНЫ =================================== */

interface Ghost {
  r: number;
  c: number;
  valid: boolean;
  fullRows: number[];
  fullCols: number[];
}

type DragState =
  | { kind: 'piece'; slot: number; id: PieceId; px: number; py: number; lift: number; pointerId: number; ghost: Ghost | null }
  | { kind: 'bomb'; px: number; py: number; lift: number; pointerId: number; ghost: Ghost | null };

interface ClearFxItem { r: number; c: number; color: number; t0: number }
interface RingFxItem { x: number; y: number; t0: number }

/* ============================== СЦЕНА ====================================== */

export class GameScene extends Phaser.Scene {
  private state!: GameState;
  private gfx!: Phaser.GameObjects.Graphics;
  private drag: DragState | null = null;

  /* Эффекты — только визуал, на логику не влияют (INV-G4) */
  private clearFx: ClearFxItem[] = [];
  private ringFx: RingFxItem[] = [];
  private floatTexts = new Set<Phaser.GameObjects.Text>();

  /* Рекорд */
  private best = 0;
  private startBest = 0; // рекорд на старте партии (для «Новый рекорд!»)

  /* HUD */
  private scoreLabelText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private surgePctText!: Phaser.GameObjects.Text;
  private restartBtnText!: Phaser.GameObjects.Text;
  private toastText!: Phaser.GameObjects.Text;
  private toastTimer: Phaser.Time.TimerEvent | null = null;

  /* Гнездо бомбы */
  private bombIcon!: Phaser.GameObjects.Text;
  private bombLabel!: Phaser.GameObjects.Text;
  private bombHint1!: Phaser.GameObjects.Text;
  private bombHint2!: Phaser.GameObjects.Text;
  private bombDragText!: Phaser.GameObjects.Text;

  /* Экран результата */
  private overlay!: Phaser.GameObjects.Container;
  private overScoreText!: Phaser.GameObjects.Text;
  private overBestText!: Phaser.GameObjects.Text;
  private overStarsText!: Phaser.GameObjects.Text;
  private overCoinsText!: Phaser.GameObjects.Text;
  private newRecordText!: Phaser.GameObjects.Text;
  private overTimer: Phaser.Time.TimerEvent | null = null;
  /* Rewarded-кнопки экрана итога (Проход Е.2: RW-1 «Второй шанс», RW-2 «×2 монеты») */
  private rwReviveBtn!: Phaser.GameObjects.Text;
  private rwDoubleBtn!: Phaser.GameObjects.Text;

  constructor(private readonly services: MetaServices) {
    super('game');
  }

  create(): void {
    this.gfx = this.add.graphics();
    this.buildHud();
    this.buildDockTexts();
    this.buildOverlay();

    // Тема (Проход Ж.1): фон камеры + вторичные тексты — из src/ui/theme.ts;
    // смена пресета яркости применяется сразу (заливки поля читаются per-frame).
    this.applyTheme();
    onThemeChanged(() => this.applyTheme());

    try {
      this.best = parseInt(localStorage.getItem(STORAGE_BEST) ?? '', 10) || 0;
    } catch {
      this.best = 0; // приватный режим
    }

    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);
    // Отпускание вне канваса → отмена без штрафа (03 §3: отмена жеста)
    this.input.on('pointerupoutside', this.onPointerUpOutside, this);
    // Потеря фокуса окна не должна оставлять drag «прилипшим» к курсору
    this.game.events.on(Phaser.Core.Events.BLUR, this.onBlur, this);

    // Проход Е.2: клики по DOM-бустер-бару обрабатывает сцена (нужен GameState)
    this.services.ui.onBoosterClick = (id) => this.handleBoosterClick(id);

    this.startGame();
  }

  override update(time: number): void {
    const g = this.gfx;
    g.clear();
    this.drawSurgeBar();
    this.drawBoard();
    this.drawGhost();
    this.drawDock();
    this.drawFx(time);
    this.drawDragPiece();
    this.updateBombSlotTexts(time);
  }

  /* ========================= ЖИЗНЕННЫЙ ЦИКЛ ПАРТИИ ========================= */

  private startGame(): void {
    if (this.overTimer) {
      this.overTimer.remove(false); // рестарт в окне паузы перед оверлеем
      this.overTimer = null;
    }
    this.state = createGame(randomSeed());
    this.clearFx = [];
    this.ringFx = [];
    this.drag = null;
    this.startBest = this.best;
    for (const t of this.floatTexts) t.destroy();
    this.floatTexts.clear();
    this.overlay.setVisible(false);
    // Проход Е.2: сброс счётчиков партии в мете и разрядка бустеров
    this.services.boosters.reset();
    this.services.meta.onNewGame();
    // Пер-партийные капы rewarded (RW-1/RW-2) снова доступны; экран итога скрыт
    this.services.monetize.onNewGame();
    this.services.monetize.setResultOverlayVisible(false);
    this.updateHud();
  }

  private commitPlace(slot: number, r: number, c: number): void {
    // Снимок для «Отмены» — только перед валидным ходом (как в прототипе)
    const pieceId = this.state.hand[slot];
    if (pieceId === null || this.state.gameOver) return;
    if (!canPlace(this.state.board, DEF[pieceId], r, c)) return;
    this.services.boosters.snapshot(this.state);

    const res = placePiece(this.state, slot, r, c);
    if (!res) return;
    this.services.meta.onMove(res.lineCount, res.mult, res.cleanBoard);
    const now = this.time.now;
    for (const cell of res.clearedCells) {
      this.clearFx.push({ r: cell.r, c: cell.c, color: COLORS[cell.colorIdx] ?? 0xffffff, t0: now });
    }
    const def = DEF[res.placed.id];
    const fx = boardToPx(r + def.h / 2, c + def.w / 2);
    this.addFloat(fx.x, fx.y, '+' + res.points, res.lineCount > 0 ? '#ffd43b' : '#b8c4d3');
    if (res.mult > 1 && res.lineCount > 0) {
      this.addFloat(fx.x, fx.y - 26, t('game.float.combo', { mult: res.mult }), '#ff922b');
    }
    if (res.cleanBoard) {
      this.addFloat(
        BOARD_X + GRID_W / 2,
        BOARD_Y + GRID_W / 2,
        t('game.float.cleanBoard', { bonus: CLEAN_BONUS }),
        '#69db7c'
      );
    }
    if (res.bombBecameReady) this.showToast(t('game.toast.surgeReady'));
    this.afterAction();
  }

  private commitBomb(r: number, c: number): void {
    // Снимок для «Отмены» — перед взрывом (как в прототипе)
    if (!this.state.bombReady || this.state.gameOver) return;
    this.services.boosters.snapshot(this.state);

    const res = dropBomb(this.state, r, c);
    if (!res) return;
    this.services.meta.onBomb(res.cleanBoard);
    const now = this.time.now;
    for (const cell of res.clearedCells) {
      this.clearFx.push({ r: cell.r, c: cell.c, color: COLORS[cell.colorIdx] ?? 0xffffff, t0: now });
    }
    const fx = boardToPx(r + 0.5, c + 0.5);
    this.ringFx.push({ x: fx.x, y: fx.y, t0: now });
    this.addFloat(fx.x, fx.y, '+' + res.points, '#67e8f9');
    this.afterAction();
  }

  /** Общий хвост хода/бомбы: рекорд, HUD, контроль game over. */
  private afterAction(): void {
    this.updateHud();
    if (this.state.gameOver) this.handleGameOver();
  }

  private handleGameOver(): void {
    // Значения фиксируем сейчас: к моменту срабатывания таймера мог быть рестарт
    const finalScore = this.state.score;
    const isRecord = finalScore > this.startBest;
    const finalBest = this.best; // уже поднят в updateHud
    // Проход Е.2: звёзды/монеты конца партии — сразу, как в прототипе
    // (checkGameOver → Meta.onGameEnd); оверлей лишь показывает итог позже.
    const end = this.services.meta.onGameEnd(finalScore);
    this.overTimer = this.time.delayedCall(OVER_DELAY_MS, () => {
      this.overTimer = null;
      this.overScoreText.setText(String(finalScore));
      this.overBestText.setText(String(finalBest));
      this.overStarsText.setText(
        end.stars > 0 ? '★'.repeat(end.stars) + '☆'.repeat(3 - end.stars) : '☆☆☆'
      );
      this.overCoinsText.setText(t('over.coinsValue', { coins: end.coins }));
      this.newRecordText.setVisible(isRecord);
      this.overlay.setVisible(true);
      // Проход Е.2: офферы RW-1/RW-2 «показаны» (воронка 09 §3) + актуализация кнопок
      this.services.monetize.setResultOverlayVisible(true);
      this.services.monetize.noteGameOverOffersShown();
      this.updateResultAdButtons();
    });
  }

  /* ================= REWARDED НА ЭКРАНЕ ИТОГА (Проход Е.2) ================ */

  /** Доступность кнопок RW-1/RW-2 (капы 06 §2.2) — прозрачность + сериклик в обработчике. */
  private updateResultAdButtons(): void {
    const m = this.services.monetize;
    this.rwReviveBtn.setAlpha(this.state.gameOver && m.canRevive() ? 1 : 0.4);
    this.rwDoubleBtn.setAlpha(m.canDoubleCoins() ? 1 : 0.4);
  }

  /** RW-1 «Второй шанс»: досмотрел → оживление той же партии (06 §2.2). */
  private onReviveClick(): void {
    const m = this.services.monetize;
    if (!this.state.gameOver || !m.canRevive()) return;
    // Прячем экран итога на время показа; неудача — возвращаем обратно.
    this.overlay.setVisible(false);
    m.setResultOverlayVisible(false);
    void m
      .offerRevive(this.state)
      .catch(() => false) // показ упал (прод-SDK) → вернём экран итога, не «зависаем»
      .then((revived) => {
        if (revived) {
          this.updateHud();
        } else {
          this.overlay.setVisible(true);
          m.setResultOverlayVisible(true);
        }
      });
  }

  /** RW-2 «×2 монеты за партию»: бонус = заработанному в партии (06 §2.2). */
  private onDoubleCoinsClick(): void {
    const m = this.services.monetize;
    if (!m.canDoubleCoins()) return;
    void m
      .offerDoubleCoins()
      .catch(() => 0) // показ упал (прод-SDK) → без награды, кнопки актуализируем
      .then((bonus) => {
        if (bonus > 0) {
          const earned = this.services.economy.getEarnedThisGame();
          this.overCoinsText.setText(t('over.coinsValueDoubled', { coins: earned + bonus }));
        }
        this.updateResultAdButtons();
      });
  }

  /* ==================== БУСТЕРЫ В ПАРТИИ (Проход Е.2) ===================== */

  /** Клик по бустер-бару: есть в инвентаре → применить; нет → докупить. */
  private handleBoosterClick(id: BoosterId): void {
    const { economy, boosters, ui } = this.services;
    if (economy.getBooster(id) <= 0) {
      const def = ECON.BOOSTERS[id];
      if (economy.buyBooster(id)) {
        ui.toast(t('toast.boosterBoughtPrice', { name: t(`booster.${id}.name`), price: def.price }));
      } else {
        ui.toast(t('toast.notEnoughCoins', { price: def.price }));
      }
      ui.renderBoosterBar();
      return;
    }
    if (id === 'undo') {
      if (boosters.useUndo(this.state)) this.updateHud();
    } else if (id === 'swap') {
      if (boosters.useSwap(this.state)) this.updateHud();
    } else {
      boosters.toggleHammer(this.state);
    }
    ui.renderBoosterBar();
  }

  /* ============================== ВВОД ==================================== */

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.state.gameOver || this.drag) return; // drag уже идёт (мультитач) — игнор
    const px = pointer.x;
    const py = pointer.y;

    // Режим «Молота» (Проход Е.2): тап по полю снимает клетку и НЕ начинает drag
    // (аналог capture-перехвата канваса в прототипе).
    if (this.services.boosters.isHammerArmed()) {
      const hc = Math.floor((px - BOARD_X) / CELL);
      const hr = Math.floor((py - BOARD_Y) / CELL);
      if (hr >= 0 && hc >= 0 && hr < N && hc < N) {
        if (this.services.boosters.hammerAt(this.state, hr, hc)) this.updateHud();
        this.services.ui.renderBoosterBar();
        return; // тап по полю перехвачен; клики вне поля уходят ядру (док и т.п.)
      }
    }

    const lift = pointer.wasTouch ? LIFT_TOUCH : LIFT_MOUSE;
    for (let i = 0; i < 4; i++) {
      const s = slotRect(i);
      if (px < s.x || px > s.x + s.w || py < s.y || py > s.y + s.h) continue;
      if (i < 3) {
        const id = this.state.hand[i];
        if (id === null) return;
        this.drag = { kind: 'piece', slot: i, id, px, py, lift, pointerId: pointer.id, ghost: null };
      } else {
        if (!this.state.bombReady) return;
        this.drag = { kind: 'bomb', px, py, lift, pointerId: pointer.id, ghost: null };
      }
      this.drag.ghost = this.computeGhost();
      return;
    }
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.drag || pointer.id !== this.drag.pointerId) return; // чужой указатель
    this.drag.px = pointer.x;
    this.drag.py = pointer.y;
    this.drag.ghost = this.computeGhost();
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.drag && pointer.id !== this.drag.pointerId) return;
    this.endDrag(true);
  }

  private onPointerUpOutside(pointer: Phaser.Input.Pointer): void {
    if (this.drag && pointer.id !== this.drag.pointerId) return;
    this.endDrag(false);
  }

  private onBlur(): void {
    this.endDrag(false);
  }

  private endDrag(commit: boolean): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null; // сбрасываем ДО мутаций состояния
    const g = d.ghost;
    if (!commit || !g) return; // отпустили вне поля → возврат в док без штрафа
    if (d.kind === 'piece' && g.valid) this.commitPlace(d.slot, g.r, g.c);
    else if (d.kind === 'bomb') this.commitBomb(g.r, g.c);
  }

  /** Снап: округление к ближайшей клетке (аппроксимация «≥60% площади», 03 §3). */
  private computeGhost(): Ghost | null {
    const d = this.drag;
    if (!d) return null;
    const cx = d.px;
    const cy = d.py - d.lift;

    if (d.kind === 'bomb') {
      const bc = Math.floor((cx - BOARD_X) / CELL);
      const br = Math.floor((cy - BOARD_Y) / CELL);
      if (br < 0 || bc < 0 || br >= N || bc >= N) return null;
      return { r: br, c: bc, valid: true, fullRows: [], fullCols: [] };
    }

    const def = DEF[d.id];
    const ox = cx - (def.w * CELL) / 2;
    const oy = cy - (def.h * CELL) / 2;
    const c = Math.round((ox - BOARD_X) / CELL);
    const r = Math.round((oy - BOARD_Y) / CELL);
    if (r < 0 || c < 0 || r > N - def.h || c > N - def.w) return null;
    const valid = canPlace(this.state.board, def, r, c);
    let fullRows: number[] = [];
    let fullCols: number[] = [];
    if (valid) {
      const lines = previewLines(this.state.board, def, r, c);
      fullRows = lines.rows;
      fullCols = lines.cols;
    }
    return { r, c, valid, fullRows, fullCols };
  }

  /* ============================== HUD ===================================== */

  private buildHud(): void {
    const sec = theme().textSecondary;
    this.scoreLabelText = this.add.text(BOARD_X, 10, t('hud.scoreLabel'), {
      fontFamily: FONT, fontSize: '10px', color: sec
    });
    this.scoreText = this.add.text(BOARD_X, 22, '0', {
      fontFamily: FONT, fontSize: '28px', fontStyle: 'bold', color: '#e8edf4'
    });
    this.bestText = this.add.text(GAME_W - PAD, 22, t('hud.best', { best: 0 }), {
      fontFamily: FONT, fontSize: '16px', color: sec
    }).setOrigin(1, 0);

    this.comboText = this.add.text(BOARD_X, 62, t('hud.comboNone'), {
      fontFamily: FONT, fontSize: '14px', color: sec
    });

    const restartBtn = this.add.text(GAME_W - PAD, 62, t('hud.restart'), {
      fontFamily: FONT, fontSize: '14px', color: sec
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    restartBtn.on('pointerover', () => restartBtn.setColor('#e8edf4'));
    restartBtn.on('pointerout', () => restartBtn.setColor(theme().textSecondary));
    restartBtn.on('pointerup', () => this.startGame());
    this.restartBtnText = restartBtn;

    this.surgePctText = this.add.text(BOARD_X + 268, 84, t('hud.surge', { pct: 0 }), {
      fontFamily: FONT, fontSize: '12px', color: sec
    });

    this.toastText = this.add.text(GAME_W / 2, BOARD_Y + 22, '', {
      fontFamily: FONT, fontSize: '13px', color: '#e8edf4',
      backgroundColor: theme().css.panelHover, padding: { x: 12, y: 6 }
    }).setOrigin(0.5).setDepth(8).setVisible(false);
  }

  /** Обновление HUD-текстов; рекорд фиксируем сразу при превышении (как в прототипе). */
  private updateHud(): void {
    const s = this.state;
    if (s.score > this.best) {
      this.best = s.score;
      try {
        localStorage.setItem(STORAGE_BEST, String(this.best));
      } catch {
        /* приватный режим — рекорд живёт до перезагрузки */
      }
    }
    this.scoreText.setText(String(s.score));
    this.bestText.setText(t('hud.best', { best: Math.max(this.best, s.score) }));
    if (s.combo.chain >= 2) {
      this.comboText.setText(t('hud.comboActive', { mult: multFor(s.combo.chain), chain: s.combo.chain }));
      this.comboText.setColor('#ff922b');
    } else if (s.combo.chain === 1) {
      this.comboText.setText(t('hud.comboStarted'));
      this.comboText.setColor(theme().textSecondary);
    } else {
      this.comboText.setText(t('hud.comboNone'));
      this.comboText.setColor(theme().textSecondary);
    }
    const pct = Math.round((s.surge.charge / SURGE_MAX) * 100);
    this.surgePctText.setText(t('hud.surge', { pct }));
    this.surgePctText.setColor(s.bombReady ? '#67e8f9' : theme().textSecondary);
  }

  /** Применить палитру темы к камере и статичным текстам (Проход Ж.1). */
  private applyTheme(): void {
    const p = theme();
    this.cameras.main.setBackgroundColor(p.canvasBg);
    this.scoreLabelText.setColor(p.textSecondary);
    this.bestText.setColor(p.textSecondary);
    this.restartBtnText.setColor(p.textSecondary);
    this.bombHint1.setColor(p.textDim);
    this.bombHint2.setColor(p.textDim);
    this.toastText.setStyle({ backgroundColor: p.css.panelHover });
    // combo/surge/best перекрашиваются по текущему состоянию (в create()
    // applyTheme зовётся до первой партии — state ещё не создан).
    if (this.state !== undefined) this.updateHud();
  }

  private showToast(msg: string): void {
    this.toastText.setText(msg).setVisible(true);
    if (this.toastTimer) this.toastTimer.remove(false);
    this.toastTimer = this.time.delayedCall(2000, () => {
      this.toastTimer = null;
      this.toastText.setVisible(false);
    });
  }

  private addFloat(x: number, y: number, text: string, color: string): void {
    const t = this.add.text(x, y, text, {
      fontFamily: FONT, fontSize: '17px', fontStyle: 'bold', color
    }).setOrigin(0.5).setDepth(6);
    this.floatTexts.add(t);
    this.tweens.add({ targets: t, y: y - 30, duration: FLOAT_ANIM_MS, ease: 'Linear' });
    this.tweens.add({
      targets: t,
      alpha: 0,
      delay: FLOAT_ANIM_MS * 0.7,
      duration: FLOAT_ANIM_MS * 0.3,
      onComplete: () => {
        this.floatTexts.delete(t);
        t.destroy();
      }
    });
  }

  /* ======================= ТЕКСТЫ ДОКА И ОВЕРЛЕЙ ========================== */

  private buildDockTexts(): void {
    const s = slotRect(3);
    const cx = s.x + s.w / 2;
    this.bombIcon = this.add.text(cx, s.y + s.h / 2 - 8, '💎', { fontSize: '34px' }).setOrigin(0.5);
    this.bombLabel = this.add.text(cx, s.y + s.h - 16, t('dock.bombLabel'), {
      fontFamily: FONT, fontSize: '11px', color: '#67e8f9'
    }).setOrigin(0.5);
    this.bombHint1 = this.add.text(cx, s.y + s.h / 2 - 8, t('dock.bombHint1'), {
      fontFamily: FONT, fontSize: '11px', color: theme().textDim
    }).setOrigin(0.5);
    this.bombHint2 = this.add.text(cx, s.y + s.h / 2 + 8, t('dock.bombHint2'), {
      fontFamily: FONT, fontSize: '11px', color: theme().textDim
    }).setOrigin(0.5);
    this.bombDragText = this.add.text(0, 0, '💎', { fontSize: '40px' })
      .setOrigin(0.5).setDepth(7).setVisible(false);
  }

  private buildOverlay(): void {
    const bg = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x0b0f16, 0.85);
    const title = this.add.text(GAME_W / 2, 130, t('over.title'), {
      fontFamily: FONT, fontSize: '26px', fontStyle: 'bold', color: '#e8edf4'
    }).setOrigin(0.5);
    this.newRecordText = this.add.text(GAME_W / 2, 160, t('over.newRecord'), {
      fontFamily: FONT, fontSize: '16px', color: '#ffd43b'
    }).setOrigin(0.5);
    const scoreLabel = this.add.text(GAME_W / 2, 190, t('over.scoreLabel'), {
      fontFamily: FONT, fontSize: '12px', color: '#8b98a9'
    }).setOrigin(0.5);
    this.overScoreText = this.add.text(GAME_W / 2, 216, '0', {
      fontFamily: FONT, fontSize: '32px', fontStyle: 'bold', color: '#e8edf4'
    }).setOrigin(0.5);
    const bestLabel = this.add.text(GAME_W / 2, 250, t('over.bestLabel'), {
      fontFamily: FONT, fontSize: '12px', color: '#8b98a9'
    }).setOrigin(0.5);
    this.overBestText = this.add.text(GAME_W / 2, 272, '0', {
      fontFamily: FONT, fontSize: '20px', color: '#e8edf4'
    }).setOrigin(0.5);
    // Проход Е.2: звёзды партии (04 §2) и монеты за партию (05 §2.1)
    const starsLabel = this.add.text(GAME_W / 2, 302, t('over.starsLabel'), {
      fontFamily: FONT, fontSize: '12px', color: '#8b98a9'
    }).setOrigin(0.5);
    this.overStarsText = this.add.text(GAME_W / 2, 326, '☆☆☆', {
      fontFamily: FONT, fontSize: '22px', color: '#ffd43b'
    }).setOrigin(0.5);
    const coinsLabel = this.add.text(GAME_W / 2, 356, t('over.coinsLabel'), {
      fontFamily: FONT, fontSize: '12px', color: '#8b98a9'
    }).setOrigin(0.5);
    this.overCoinsText = this.add.text(GAME_W / 2, 378, t('over.coinsValue', { coins: 0 }), {
      fontFamily: FONT, fontSize: '18px', color: '#ffd43b'
    }).setOrigin(0.5);
    // Проход Е.2: rewarded-офферы экрана итога (06 §2.2 RW-1/RW-2, СИМУЛЯЦИЯ)
    this.rwReviveBtn = this.add.text(GAME_W / 2, 416, t('over.revive'), {
      fontFamily: FONT, fontSize: '14px', fontStyle: 'bold', color: '#e8edf4',
      backgroundColor: '#1f4d3a', padding: { x: 16, y: 8 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.rwReviveBtn.on('pointerup', () => this.onReviveClick());
    this.rwDoubleBtn = this.add.text(GAME_W / 2, 454, t('over.doubleCoins'), {
      fontFamily: FONT, fontSize: '14px', fontStyle: 'bold', color: '#e8edf4',
      backgroundColor: '#2a2416', padding: { x: 16, y: 8 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.rwDoubleBtn.on('pointerup', () => this.onDoubleCoinsClick());
    const againBtn = this.add.text(GAME_W / 2, 500, t('over.again'), {
      fontFamily: FONT, fontSize: '18px', fontStyle: 'bold', color: '#0b0f16',
      backgroundColor: '#4dabf7', padding: { x: 20, y: 10 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    // Проход Е.2: рестарт с экрана итога — точка interstitial INT-2 (капы 06 §3);
    // ручной «↻ Заново» в HUD interstitial не показывает (как в прототипе).
    againBtn.on('pointerup', () => {
      void this.services.monetize
        .showInterstitialIfAllowed()
        .catch(() => false) // показ упал (прод-SDK) → рестарт всё равно идёт
        .then(() => this.startGame());
    });
    // Прямой мостик в мету с экрана итога (как overMetaBtn прототипа)
    const metaBtn = this.add.text(GAME_W / 2, 544, t('over.toMeta'), {
      fontFamily: FONT, fontSize: '14px', color: '#e8edf4',
      backgroundColor: '#17233a', padding: { x: 16, y: 8 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    metaBtn.on('pointerup', () => {
      this.overlay.setVisible(false);
      this.services.monetize.setResultOverlayVisible(false);
      this.services.ui.openMeta();
    });

    this.overlay = this.add.container(0, 0, [
      bg, title, this.newRecordText, scoreLabel, this.overScoreText,
      bestLabel, this.overBestText, starsLabel, this.overStarsText,
      coinsLabel, this.overCoinsText, this.rwReviveBtn, this.rwDoubleBtn,
      againBtn, metaBtn
    ]).setDepth(10).setVisible(false);
  }

  /* ============================ ОТРИСОВКА ================================= */

  /** Клетка со скруглением и бликом — перенос drawCell из прототипа. */
  private drawCellRect(x: number, y: number, size: number, color: number, alpha: number): void {
    const g = this.gfx;
    const rad = Math.max(2, size * 0.13);
    g.fillStyle(color, alpha);
    g.fillRoundedRect(x + 1.5, y + 1.5, size - 3, size - 3, rad);
    // блик сверху
    const gw = size - 8;
    const gh = gw * 0.32;
    g.fillStyle(0xffffff, alpha * 0.28);
    g.fillRoundedRect(x + 4, y + 4, gw, gh, Math.min(4, gw / 2, gh / 2));
  }

  private drawSurgeBar(): void {
    const g = this.gfx;
    const x = BOARD_X;
    const y = 86;
    const w = 260;
    const h = 12;
    g.fillStyle(theme().surgeTrack, 1);
    g.fillRoundedRect(x, y, w, h, 6);
    const charge = this.state.surge.charge;
    if (charge > 0 || this.state.bombReady) {
      const fillW = this.state.bombReady ? w : Math.max(8, (w * charge) / SURGE_MAX);
      g.fillStyle(this.state.bombReady ? 0x67e8f9 : 0x22d3ee, 1);
      g.fillRoundedRect(x, y, fillW, h, 6);
    }
  }

  private drawBoard(): void {
    const g = this.gfx;
    const pal = theme(); // палитра читается per-frame — смена пресета видна сразу
    g.fillStyle(pal.boardPanel, 1);
    g.fillRoundedRect(BOARD_X - 6, BOARD_Y - 6, GRID_W + 12, GRID_W + 12, 12);
    const b = this.state.board;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const p = boardToPx(r, c);
        // Контраст-проход Ж.1: пустая клетка светлее фона + заметная рамка.
        g.fillStyle(pal.cellEmpty, 1);
        g.fillRoundedRect(p.x + 1.5, p.y + 1.5, CELL - 3, CELL - 3, 6);
        g.lineStyle(1, pal.cellEmptyBorder, 1);
        g.strokeRoundedRect(p.x + 1.5, p.y + 1.5, CELL - 3, CELL - 3, 6);
        const v = b[r][c];
        if (v !== 0) this.drawCellRect(p.x, p.y, CELL, COLORS[v - 1] ?? 0xffffff, 1);
      }
    }
  }

  /** Призрак + подсветка линий, которые соберутся этим ходом (03 §3). */
  private drawGhost(): void {
    const d = this.drag;
    if (!d || !d.ghost) return;
    const g = this.gfx;
    const ghost = d.ghost;

    if (d.kind === 'bomb') {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const tr = ghost.r + dr;
          const tc = ghost.c + dc;
          if (tr < 0 || tc < 0 || tr >= N || tc >= N) continue;
          const p = boardToPx(tr, tc);
          g.fillStyle(0x67e8f9, 0.35);
          g.fillRoundedRect(p.x + 2, p.y + 2, CELL - 4, CELL - 4, 6);
        }
      }
      return;
    }

    const def = DEF[d.id];
    // свечение всей будущей строки/столбца
    if (ghost.valid && (ghost.fullRows.length > 0 || ghost.fullCols.length > 0)) {
      g.fillStyle(0x69db7c, 0.22);
      for (const r of ghost.fullRows) {
        const p = boardToPx(r, 0);
        g.fillRect(p.x, p.y, GRID_W, CELL);
      }
      for (const c of ghost.fullCols) {
        const p = boardToPx(0, c);
        g.fillRect(p.x, p.y, CELL, GRID_W);
      }
    }
    // призрак фигуры: зелёный — валидно, красный — нет
    for (const [dr, dc] of def.cells) {
      const p = boardToPx(ghost.r + dr, ghost.c + dc);
      g.fillStyle(ghost.valid ? 0x51cf66 : 0xff6b6b, ghost.valid ? 0.45 : 0.38);
      g.fillRoundedRect(p.x + 2, p.y + 2, CELL - 4, CELL - 4, 6);
    }
  }

  private drawDock(): void {
    const g = this.gfx;
    const pal = theme();
    for (let i = 0; i < 3; i++) {
      const s = slotRect(i);
      // Контраст-проход Ж.1: гнёзда дока светлее и с контрастной рамкой.
      g.fillStyle(pal.dockSlot, 1);
      g.fillRoundedRect(s.x, s.y, s.w, s.h, 10);
      g.lineStyle(1, pal.dockSlotBorder, 1);
      g.strokeRoundedRect(s.x, s.y, s.w, s.h, 10);
      const id = this.state.hand[i];
      if (id === null) continue;
      if (this.drag && this.drag.kind === 'piece' && this.drag.slot === i) continue;
      const def = DEF[id];
      const ds = DOCK_CELL;
      const ox = s.x + (s.w - def.w * ds) / 2;
      const oy = s.y + (s.h - def.h * ds) / 2;
      const alpha = this.state.handPlaceable[i] ? 1 : 0.28; // некуда ставить → приглушена
      for (const [dr, dc] of def.cells) {
        this.drawCellRect(ox + dc * ds, oy + dr * ds, ds, COLORS[def.colorIdx] ?? 0xffffff, alpha);
      }
    }
    // Гнездо кристальной бомбы (штриховая рамка прототипа → сплошная: у Phaser
    // Graphics нет line dash; функциональной разницы нет)
    const s = slotRect(3);
    g.fillStyle(pal.bombSlot, 1);
    g.fillRoundedRect(s.x, s.y, s.w, s.h, 10);
    g.lineStyle(1.5, this.state.bombReady ? 0x67e8f9 : pal.dockSlotBorder, 1);
    g.strokeRoundedRect(s.x + 2, s.y + 2, s.w - 4, s.h - 4, 8);
  }

  private drawDragPiece(): void {
    const d = this.drag;
    if (!d || d.kind !== 'piece') return;
    const g = this.gfx;
    const def = DEF[d.id];
    const cx = d.px;
    const cy = d.py - d.lift;
    const ox = cx - (def.w * CELL) / 2;
    const oy = cy - (def.h * CELL) / 2;
    // псевдотень (у Graphics нет shadowBlur канваса)
    for (const [dr, dc] of def.cells) {
      g.fillStyle(0x000000, 0.3);
      g.fillRoundedRect(ox + dc * CELL + 4, oy + dr * CELL + 8, CELL - 3, CELL - 3, 6);
    }
    for (const [dr, dc] of def.cells) {
      this.drawCellRect(ox + dc * CELL, oy + dr * CELL, CELL, COLORS[def.colorIdx] ?? 0xffffff, 0.92);
    }
  }

  private drawFx(now: number): void {
    const g = this.gfx;
    // исчезающие клетки очистки
    for (let i = this.clearFx.length - 1; i >= 0; i--) {
      const fx = this.clearFx[i];
      const t = (now - fx.t0) / CLEAR_ANIM_MS;
      if (t >= 1) {
        this.clearFx.splice(i, 1);
        continue;
      }
      const p = boardToPx(fx.r, fx.c);
      const size = CELL * (1 - t);
      const off = (CELL - size) / 2;
      g.fillStyle(fx.color, 1 - t);
      g.fillRoundedRect(p.x + off + 1, p.y + off + 1, Math.max(size - 2, 1), Math.max(size - 2, 1), 5);
    }
    // кольцо взрыва бомбы
    for (let i = this.ringFx.length - 1; i >= 0; i--) {
      const fx = this.ringFx[i];
      const t = (now - fx.t0) / RING_ANIM_MS;
      if (t >= 1) {
        this.ringFx.splice(i, 1);
        continue;
      }
      g.lineStyle(3 * (1 - t) + 1, 0x67e8f9, 1 - t);
      g.strokeCircle(fx.x, fx.y, 10 + t * CELL * 2.2);
    }
  }

  /** Видимость и пульс текстов гнезда бомбы + позиция перетаскиваемой бомбы. */
  private updateBombSlotTexts(now: number): void {
    const bombDragging = this.drag !== null && this.drag.kind === 'bomb';
    const ready = this.state.bombReady;
    this.bombIcon.setVisible(ready && !bombDragging);
    this.bombLabel.setVisible(ready && !bombDragging);
    this.bombHint1.setVisible(!ready);
    this.bombHint2.setVisible(!ready);
    if (this.bombIcon.visible) {
      this.bombIcon.setScale(1 + 0.08 * Math.sin(now / 220));
    }
    this.bombDragText.setVisible(bombDragging);
    if (bombDragging && this.drag) {
      this.bombDragText.setPosition(this.drag.px, this.drag.py - this.drag.lift);
    }
  }
}
