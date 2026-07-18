/**
 * WheelScene — Phaser-рендер колеса букв (Проход Е.1).
 * Порт Canvas-колеса прототипа: подложка, линия-след через выбранные буквы,
 * плашки букв; pointer-ввод ПРОТЯЖКОЙ с откатом на предыдущую букву и
 * pointerId-замком (мультитач-защита) — 1:1 с prototype/game.js.
 *
 * Сцена — ТОЛЬКО рендер и ввод: слово на проверку уходит в callbacks.onSubmit,
 * вся логика — в src/core/game.ts. Геометрия 1:1: радиус плашки
 * s*(0.105|0.12), радиус захвата 1.3x визуального (07 §3).
 */
import Phaser from 'phaser';
import { HIT_RADIUS_FACTOR } from '../core/config';

/** Логический размер сцены (Scale.FIT вписывает в контейнер #wheel-host). */
export const WHEEL_SIZE = 330;

export interface WheelCallbacks {
  /** Слово в протяжке изменилось (крупный дисплей над колесом). */
  onWordChange(word: string): void;
  /** Палец отпущен — слово на проверку. */
  onSubmit(word: string): void;
  /** false — уровень решён, ввод заблокирован (ждём оверлей). */
  canInteract(): boolean;
}

interface Tile {
  letter: string;
  x: number;
  y: number;
}

export class WheelScene extends Phaser.Scene {
  private letters: string[] = [];
  private tiles: Tile[] = [];
  private path: number[] = [];
  private dragging = false;
  private activePointerId: number | null = null;
  private pointerPos: { x: number; y: number } | null = null;
  private tileR = 0;

  private gfx: Phaser.GameObjects.Graphics | null = null;
  private labels: Phaser.GameObjects.Text[] = [];

  constructor(private readonly callbacks: WheelCallbacks) {
    super({ key: 'wheel' });
  }

  create(): void {
    this.gfx = this.add.graphics();
    this.layoutWheel();
    this.drawWheel();

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onUp(p));
    // Отпускание вне канваса — тоже проверка слова (порт фолбэка прототипа).
    this.input.on('pointerupoutside', (p: Phaser.Input.Pointer) => this.onUp(p));
  }

  /* ============================ ПУБЛИЧНОЕ API ============================ */

  /** Новый уровень: обновить буквы колеса. */
  setLetters(letters: readonly string[]): void {
    this.letters = letters.slice();
    this.path = [];
    this.dragging = false;
    this.activePointerId = null;
    this.pointerPos = null;
    if (this.gfx !== null) {
      this.layoutWheel();
      this.drawWheel();
    }
  }

  /** Fisher–Yates; «перемешать» — бесплатно и без лимита (03 §2.2). */
  shuffle(): void {
    if (this.dragging) return; // нельзя менять раскладку под активной протяжкой
    for (let i = this.letters.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = this.letters[i];
      this.letters[i] = this.letters[j];
      this.letters[j] = tmp;
    }
    this.path = [];
    this.callbacks.onWordChange('');
    if (this.gfx !== null) {
      this.layoutWheel();
      this.drawWheel();
    }
  }

  /** Принудительно сбросить протяжку (открытие оверлея и т.п.). */
  cancelDrag(): void {
    this.dragging = false;
    this.activePointerId = null;
    this.pointerPos = null;
    this.path = [];
    this.callbacks.onWordChange('');
    if (this.gfx !== null) this.drawWheel();
  }

  /* ============================ ВВОД ============================ */

  private onDown(p: Phaser.Input.Pointer): void {
    if (!this.callbacks.canInteract()) return; // уровень решён — ждём оверлей
    // Второй палец во время протяжки — игнор; повторный down того же указателя
    // (потерян up) — перезапуск жеста, не блокировка.
    if (this.dragging && p.id !== this.activePointerId) return;
    if (!p.wasTouch && p.button !== 0) return; // только левая кнопка мыши
    this.dragging = true;
    this.activePointerId = p.id;
    this.path = []; // защита от «хвоста» при потерянном up
    this.handlePointer(p.x, p.y);
  }

  private onMove(p: Phaser.Input.Pointer): void {
    if (!this.dragging || p.id !== this.activePointerId) return;
    this.handlePointer(p.x, p.y);
  }

  private onUp(p: Phaser.Input.Pointer): void {
    if (!this.dragging || p.id !== this.activePointerId) return;
    this.dragging = false;
    this.activePointerId = null;
    this.pointerPos = null;
    this.submitPath();
  }

  /** Ближайшая буква в радиусе захвата 1.3x (07 §3), иначе -1. */
  private hitTile(x: number, y: number): number {
    let best = -1;
    let bestD = Infinity;
    const maxD = this.tileR * HIT_RADIUS_FACTOR;
    for (let i = 0; i < this.tiles.length; i++) {
      const dx = x - this.tiles[i].x;
      const dy = y - this.tiles[i].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= maxD && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private handlePointer(x: number, y: number): void {
    this.pointerPos = { x, y };
    const idx = this.hitTile(x, y);
    if (idx >= 0) {
      const last = this.path.length - 1;
      if (this.path.length === 0) {
        this.path.push(idx);
      } else if (idx === this.path[last]) {
        // стоим на той же букве — ничего
      } else if (this.path.length >= 2 && idx === this.path[last - 1]) {
        this.path.pop(); // откат: вернулись на предыдущую букву
      } else if (this.path.indexOf(idx) === -1) {
        this.path.push(idx);
      }
      this.callbacks.onWordChange(this.currentWord());
    }
    this.drawWheel();
  }

  private currentWord(): string {
    return this.path.map((i) => this.tiles[i].letter).join('');
  }

  private submitPath(): void {
    const word = this.currentWord();
    this.path = [];
    this.drawWheel();
    this.callbacks.onSubmit(word);
  }

  /* ============================ РЕНДЕР ============================ */

  private layoutWheel(): void {
    const s = WHEEL_SIZE;
    const n = this.letters.length;
    this.tileR = Math.round(s * (n >= 7 ? 0.105 : 0.12));
    const radius = s / 2 - this.tileR - 6;
    this.tiles = [];
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      this.tiles.push({
        letter: this.letters[i],
        x: s / 2 + radius * Math.cos(ang),
        y: s / 2 + radius * Math.sin(ang)
      });
    }
    // Пересоздать подписи букв (число/размер могли смениться).
    for (const t of this.labels) t.destroy();
    this.labels = [];
    for (const tile of this.tiles) {
      const label = this.add.text(tile.x, tile.y + 1, tile.letter, {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: Math.round(this.tileR * 1.05) + 'px',
        fontStyle: 'bold',
        color: '#1b5e20'
      });
      label.setOrigin(0.5);
      this.labels.push(label);
    }
  }

  private drawWheel(): void {
    const g = this.gfx;
    if (g === null) return;
    const s = WHEEL_SIZE;
    g.clear();

    // подложка колеса
    g.fillStyle(0xffffff, 0.35);
    g.fillCircle(s / 2, s / 2, s / 2 - 2);

    // линия-след через выбранные буквы (+ текущая точка указателя)
    if (this.path.length > 0) {
      const w = Math.max(6, this.tileR * 0.34);
      g.lineStyle(w, 0x43a047, 0.6);
      g.beginPath();
      const first = this.tiles[this.path[0]];
      g.moveTo(first.x, first.y);
      for (let i = 1; i < this.path.length; i++) {
        g.lineTo(this.tiles[this.path[i]].x, this.tiles[this.path[i]].y);
      }
      if (this.dragging && this.pointerPos !== null) g.lineTo(this.pointerPos.x, this.pointerPos.y);
      g.strokePath();
      // скругления в узлах следа
      g.fillStyle(0x43a047, 0.6);
      for (const idx of this.path) {
        g.fillCircle(this.tiles[idx].x, this.tiles[idx].y, w / 2);
      }
    }

    // плашки букв
    const inPath = new Set(this.path);
    for (let t = 0; t < this.tiles.length; t++) {
      const tile = this.tiles[t];
      const active = inPath.has(t);
      g.fillStyle(active ? 0x43a047 : 0xffffff, 1);
      g.fillCircle(tile.x, tile.y, this.tileR);
      g.lineStyle(2, active ? 0x2e7d32 : 0x66bb6a, active ? 1 : 0.9);
      g.strokeCircle(tile.x, tile.y, this.tileR);
      const label = this.labels[t];
      if (label !== undefined) label.setColor(active ? '#ffffff' : '#1b5e20');
    }
  }
}
