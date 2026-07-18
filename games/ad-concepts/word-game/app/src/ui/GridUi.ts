/**
 * GridUi — DOM-рендер кроссвордной сетки, HUD и оверлеев (Проход Е.1).
 * Порт DOM-части prototype/game.js: сетка с анимацией открытия клеток,
 * HUD (уровень/монеты/жёлуди/бонусы), крупный дисплей слова, тосты,
 * оверлеи победы/финала/бонус-списка, дневной режим.
 *
 * Обоснование DOM (как в прототипе): качественный рендер кириллицы и
 * CSS-анимации клеток бесплатны; колесо — Phaser (WheelScene).
 * Контейнеры и стили — index.html; класс только наполняет их.
 */
import {
  HINT_COST,
  MAX_CELL_PX,
  MIN_CELL_PX,
  MIN_WORD_LEN,
  PERFECT_BONUS,
  TOAST_MS,
  WIN_DELAY_MS,
  WIN_REWARD,
  WORD_FLASH_MS
} from '../core/config';
import type { CoreGame, WinInfo } from '../core/game';
import { ECON } from '../economy/econ';
import type { Economy } from '../economy/economy';
import type { Meta } from '../meta/meta';

/** Управление колесом (реализует WheelScene). */
export interface WheelControl {
  setLetters(letters: readonly string[]): void;
  shuffle(): void;
  cancelDrag(): void;
}

/**
 * Рекламные хуки оверлея победы (Проход Е.2, назначает main.ts):
 * инъекция кнопки RV-2 «×2 монеты» и interstitial I-1 перед «Дальше».
 * null — Е.1-поведение без рекламы.
 */
export interface WinAdHooks {
  /** Построить кнопку RV-2 для оверлея победы (null — не показывать). */
  buildDoubleButton(reward: number): HTMLElement | null;
  /** Interstitial перед переходом (резолв после показа или отказа по капам). */
  beforeNext(): Promise<void>;
}

type FlashCls = 'ok' | 'bonus' | 'bad' | 'dup';

export class GridUi {
  /** Сцена колеса; назначается в main после создания Phaser.Game. */
  wheel: WheelControl | null = null;
  /** Открыть мета-экран (MetaUi). */
  onMetaOpen: ((tab?: string) => void) | null = null;
  /** Рекламные хуки оверлея победы (Проход Е.2). */
  adHooks: WinAdHooks | null = null;
  /** Клубный безлимит подсказок: true — Лампа этому игроку бесплатна (06 §5.1). */
  freeHint: (() => boolean) | null = null;
  /** Уровень перерисован (переход/рестарт/дневной) — для баннера/RV-1 (Е.2). */
  onAfterRebuild: (() => void) | null = null;

  private readonly cellEls = new Map<string, HTMLElement>();
  private toastTimer: number | null = null;
  private flashTimer: number | null = null;
  private firstRunToastShown = false;

  constructor(
    private readonly game: CoreGame,
    private readonly economy: Economy,
    private readonly meta: Meta
  ) {}

  private el(id: string): HTMLElement {
    const node = document.getElementById(id);
    if (node === null) throw new Error('GridUi: нет контейнера #' + id + ' в index.html');
    return node;
  }

  /* ============================ МОНТАЖ ============================ */

  mount(): void {
    this.el('btn-shuffle').addEventListener('click', () => this.wheel?.shuffle());
    this.el('btn-hint').addEventListener('click', () => this.useHint());
    this.el('btn-restart').addEventListener('click', () => this.restartLevel());
    this.el('btn-bonus').addEventListener('click', () => this.showBonusOverlay());
    this.el('btn-meta').addEventListener('click', () => this.onMetaOpen?.('atlas'));

    // Пульс HUD при любом сдвиге монет (порт addCoins ядра).
    this.game.onCoinsChanged = () => {
      this.updateHud();
      const hudCoins = this.el('hud-coins');
      hudCoins.classList.add('pulse');
      window.setTimeout(() => hudCoins.classList.remove('pulse'), 200);
    };
    this.economy.onChange = () => this.updateHud();

    let resizeRaf: number | null = null;
    window.addEventListener('resize', () => {
      if (resizeRaf !== null) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        this.renderGrid();
      });
    });
  }

  /** Начальный экран: сейв уже загружен ядром (порт хвоста game.js). */
  start(): void {
    this.rebuild();
    if (this.game.isFinished()) {
      this.showFinalOverlay();
    } else if (this.game.allCompleted()) {
      // Перезагрузка на решённом уровне: награда уже выдана (rewardGiven),
      // показываем экран победы без повторного начисления.
      const win = this.game.currentWin();
      if (win !== null) this.scheduleWin(win);
    }
  }

  /** Полная перерисовка уровня (переходы, рестарт, дневной). */
  rebuild(): void {
    this.renderGrid();
    this.wheel?.setLetters(this.game.getWheel());
    this.updateWordDisplay('');
    this.updateHud();
    if (
      this.game.getLevelIndex() === 0 &&
      !this.game.isDailyMode() &&
      !this.firstRunToastShown &&
      this.game.getGrid().cellKeys.every((k) => !this.game.isRevealed(k))
    ) {
      this.firstRunToastShown = true;
      this.toast('Зажми букву и веди по буквам, отпусти — проверка');
    }
    this.onAfterRebuild?.();
  }

  /* ============================ СЕТКА (DOM) ============================ */

  renderGrid(): void {
    const grid = this.el('grid');
    const area = this.el('grid-area');
    const level = this.game.getLevelData();
    grid.innerHTML = '';
    this.cellEls.clear();

    const areaW = area.clientWidth - 20;
    const areaH = area.clientHeight - 12;
    let cellPx = Math.floor(Math.min(areaW / level.size.w, areaH / level.size.h, MAX_CELL_PX));
    if (cellPx < MIN_CELL_PX) cellPx = MIN_CELL_PX;

    grid.style.width = level.size.w * cellPx + 'px';
    grid.style.height = level.size.h * cellPx + 'px';

    const model = this.game.getGrid();
    for (const key of model.cellKeys) {
      const cell = model.cells.get(key);
      if (cell === undefined) continue;
      const el = document.createElement('div');
      el.className = 'cell';
      el.style.left = cell.c * cellPx + 2 + 'px';
      el.style.top = cell.r * cellPx + 2 + 'px';
      el.style.width = cellPx - 4 + 'px';
      el.style.height = cellPx - 4 + 'px';
      el.style.fontSize = Math.round(cellPx * 0.55) + 'px';
      el.textContent = cell.letter;
      const rev = this.game.getRevealed()[key];
      if (rev !== undefined) {
        el.classList.add('revealed');
        if (rev === 2) el.classList.add('hint-revealed');
        el.style.animation = 'none'; // уже открытые — без повторной анимации
      }
      this.cellEls.set(key, el);
      grid.appendChild(el);
    }
  }

  /** Открыть клетку в DOM. byHint — золотая; delay — стаггер букв слова. */
  private revealCellEl(key: string, byHint: boolean, delay: number): void {
    const el = this.cellEls.get(key);
    if (el === undefined || el.classList.contains('revealed')) return;
    const apply = (): void => {
      el.classList.add('revealed');
      if (byHint) el.classList.add('hint-revealed');
    };
    if (delay > 0) window.setTimeout(apply, delay);
    else apply();
  }

  /* ============================ ПРОВЕРКА СЛОВА ============================ */

  /** Роутер результата протяжки (порт submitPath): вызывается WheelScene. */
  submitWord(word: string): void {
    const res = this.game.submitWord(word);
    switch (res.kind) {
      case 'empty':
        this.updateWordDisplay('');
        break;
      case 'tooShort':
        if (word.length >= 2) this.toast('Слово — минимум ' + MIN_WORD_LEN + ' буквы');
        this.updateWordDisplay('');
        break;
      case 'gridHit': {
        let i = 0;
        for (const key of res.keys) this.revealCellEl(key, false, i++ * 60);
        this.flashWord(word, 'ok');
        if (res.win !== null) this.scheduleWin(res.win);
        break;
      }
      case 'duplicate':
        this.flashWord(word, 'dup'); // DUPLICATE: нейтрально, без наград (03 §2.1)
        this.toast('Уже найдено');
        break;
      case 'bonus':
        this.flashWord(word, 'bonus');
        if (res.acorns.burned > 0) this.toast('⭐ Копилка полна — жёлуди сгорают! Открой копилку 🐿️');
        else this.toast('⭐ Бонусное слово! +' + ECON.ACORN_PER_BONUS + ' 🌰');
        this.updateHud();
        break;
      case 'invalid':
        this.flashWord(word, 'bad'); // INVALID: мягкая тряска, без штрафа (03 §1)
        this.shakeWheel();
        break;
    }
  }

  /** Живое слово в протяжке (WheelScene.onWordChange). */
  setCurrentWord(word: string): void {
    if (this.flashTimer !== null) {
      window.clearTimeout(this.flashTimer);
      this.flashTimer = null;
    }
    this.updateWordDisplay(word);
  }

  /* ============================ ПОДСКАЗКА / РЕСТАРТ ============================ */

  private useHint(): void {
    // Клубный безлимит (Проход Е.2): подписчику Лампа бесплатна (06 §5.1).
    if (this.freeHint !== null && this.freeHint()) {
      if (!this.revealFreeLetterFromAd()) this.toast('Открывать нечего');
      else this.toast('👑 Клубная подсказка (безлимит)');
      return;
    }
    const res = this.game.useHint();
    if (!res.ok) {
      if (res.reason === 'noCoins') this.toast('Не хватает монет — открой копилку 🐿️ или пройди уровень');
      return;
    }
    this.revealCellEl(res.key, true, 0);
    this.toast('💡 Буква открыта');
    this.updateHud();
    if (res.win !== null) this.scheduleWin(res.win);
  }

  /**
   * Открыть случайную букву бесплатно С РЕНДЕРОМ (RV-1 / клубный безлимит,
   * Проход Е.2): мост монетизации зовёт этот метод, а не ядро напрямую —
   * иначе клетка открылась бы в сейве, но не на экране. false — нечего открыть.
   */
  revealFreeLetterFromAd(): boolean {
    const res = this.game.revealFreeLetter();
    if (res === null) return false;
    this.revealCellEl(res.key, true, 0);
    this.updateHud();
    if (res.win !== null) this.scheduleWin(res.win);
    return true;
  }

  private restartLevel(): void {
    if (!this.game.restartLevel()) return;
    this.hideOverlay();
    this.rebuild();
    this.toast('Уровень начат заново');
  }

  /* ============================ ПОБЕДА / ПЕРЕХОДЫ ============================ */

  /** Пауза перед экраном победы (анимация клеток), с защитой от смены состояния. */
  private scheduleWin(win: WinInfo): void {
    const levelAtWin = this.game.getLevelIndex();
    window.setTimeout(() => {
      if (win.daily) {
        if (this.game.isDailyMode() && this.game.allCompleted()) this.showDailyWinOverlay();
      } else if (
        !this.game.isDailyMode() &&
        this.game.getLevelIndex() === levelAtWin &&
        this.game.allCompleted()
      ) {
        this.showWinOverlay(win);
      }
    }, WIN_DELAY_MS);
  }

  private showWinOverlay(win: WinInfo): void {
    const level = this.game.getLevelData();
    const bonusFound = this.game.getFoundBonus().length;
    const html =
      '<h2>Уровень ' + (this.game.getLevelIndex() + 1) + ' пройден! 🌿</h2>' +
      '<p class="reward-line">+' + WIN_REWARD + ' 🪙</p>' +
      (win.perfect ? '<p class="reward-line">✨ Блестящий проход: +' + PERFECT_BONUS + ' 🪙</p>' : '') +
      (bonusFound > 0
        ? '<p>Бонусных слов найдено: ' + bonusFound + ' из ' + level.bonus.length + '</p>'
        : '<p>Бонусных слов на уровне было: ' + level.bonus.length + '</p>') +
      '<button class="primary" id="ov-next">Дальше ▶</button>';
    this.showOverlay(html);
    const nextBtn = this.el('ov-next');
    // Инъекция RV-2 «×2 монеты» ПЕРЕД кнопкой «Дальше» (порт maybeInjectDouble).
    if (this.adHooks !== null) {
      const rv2 = this.adHooks.buildDoubleButton(win.baseReward);
      if (rv2 !== null) nextBtn.parentNode?.insertBefore(rv2, nextBtn);
    }
    nextBtn.addEventListener('click', () => {
      void this.goNext();
    });
  }

  /** «Дальше»: сперва interstitial I-1 (если хуки Е.2 назначены), затем переход. */
  private async goNext(): Promise<void> {
    if (this.adHooks !== null) {
      try {
        await this.adHooks.beforeNext();
      } catch {
        /* сбой показа не должен блокировать переход */
      }
    }
    this.nextLevel();
  }

  private nextLevel(): void {
    this.hideOverlay();
    const res = this.game.nextLevel();
    this.rebuild();
    if (res === 'finished') this.showFinalOverlay();
  }

  private showFinalOverlay(): void {
    const html =
      '<h2>🌳 Роща пройдена!</h2>' +
      '<p>Все ' + this.game.getTotalLevels() + ' уровней позади. Монет накоплено: ' +
      this.game.getCoins() + ' 🪙</p>' +
      '<p>Открой 🗺️ Мету: атлас регионов, дневной кроссворд со стриком, копилка жёлудей и миссии.</p>' +
      '<button class="primary" id="ov-replay">Играть с начала</button>' +
      '<button class="secondary" id="ov-wipe">Сбросить всё</button>';
    this.showOverlay(html);
    this.el('ov-replay').addEventListener('click', () => {
      this.hideOverlay();
      this.game.replayFromStart(); // монеты сохраняются
      this.rebuild();
    });
    this.el('ov-wipe').addEventListener('click', () => {
      this.hideOverlay();
      this.game.wipe();
      this.economy.reset(); // жёлуди/копилка
      this.meta.reset(); // атлас/дневной/миссии/стрик
      this.rebuild();
      this.toast('Прогресс сброшен');
    });
  }

  /* ==================== ДНЕВНОЙ КРОССВОРД (Проход Б, 04 §3.3) ==================== */

  /** Запуск дневного из меты (кнопка «Играть дневной кроссворд»). */
  startDaily(): void {
    if (!this.game.startDaily(this.meta.dailySeedIndex())) return;
    this.hideOverlay();
    this.wheel?.cancelDrag();
    this.rebuild();
    this.toast('📅 Дневной кроссворд: тема «' + this.meta.todayTheme() + '»');
  }

  private showDailyWinOverlay(): void {
    // Награда (монеты дня + веха стрика) — Meta, идемпотентно в пределах дня.
    const res = this.meta.onDailyComplete();
    const bonusFound = this.game.getFoundBonus().length;
    let html = '<h2>📅 Дневной кроссворд пройден!</h2>';
    if (res.already) {
      html +=
        '<p>Сегодня ты его уже проходил — награда даётся раз в день.</p>' +
        '<p>Текущий стрик: 🔥 ' + res.streak + '</p>';
    } else {
      html += '<p class="reward-line">+' + ECON.DAILY_COINS + ' 🪙 за день</p>';
      if (res.milestone > 0) {
        html += '<p class="reward-line">🔥 Веха стрика ' + res.streak + ' дн.: +' + res.milestone + ' 🪙</p>';
      }
      html += '<p>Стрик: 🔥 ' + res.streak + ' подряд</p>';
    }
    if (bonusFound > 0) html += '<p>Бонусных слов: ' + bonusFound + ' → жёлуди в копилке 🌰</p>';
    html += '<button class="primary" id="ov-daily-done">В меню меты</button>';
    this.showOverlay(html);
    this.el('ov-daily-done').addEventListener('click', () => {
      this.hideOverlay();
      this.game.exitDaily();
      this.rebuild();
      if (this.game.isFinished()) this.showFinalOverlay();
      else this.onMetaOpen?.('daily');
    });
  }

  /* ============================ БОНУС-КОПИЛКА ============================ */

  private showBonusOverlay(): void {
    const found = this.game.getFoundBonus();
    const level = this.game.getLevelData();
    const listHtml =
      found.length > 0
        ? '<div class="bonus-list">' + found.map((w) => '<span>' + w + '</span>').join('') + '</div>'
        : '<p>Пока пусто. Составляй валидные слова, которых нет в сетке, — за каждое +' +
          ECON.ACORN_PER_BONUS + ' 🌰 в копилку</p>';
    const html =
      '<h2>⭐ Бонусные слова</h2>' +
      '<p>Найдено на уровне: ' + found.length + ' из ' + level.bonus.length + '</p>' +
      listHtml +
      '<button class="primary" id="ov-close">Понятно</button>';
    this.showOverlay(html);
    this.el('ov-close').addEventListener('click', () => this.hideOverlay());
  }

  /* ============================ UI-МЕЛОЧИ ============================ */

  updateHud(): void {
    const total = this.game.getTotalLevels();
    this.el('hud-level').textContent = this.game.isDailyMode()
      ? '📅 Дневной кроссворд'
      : this.game.getCampaignLevel() < total
        ? 'Уровень ' + (this.game.getLevelIndex() + 1) + '/' + total
        : 'Роща пройдена';
    this.el('coins-value').textContent = String(this.game.getCoins());
    this.el('acorns-value').textContent = String(this.economy.getAcorns());
    this.el('bonus-count').textContent = String(this.game.getFoundBonus().length);
    this.el('hint-cost').textContent = String(HINT_COST);
    this.el('btn-hint').classList.toggle('poor', this.game.getCoins() < HINT_COST);
  }

  private updateWordDisplay(text: string): void {
    const el = this.el('current-word');
    el.className = '';
    if (text) el.textContent = text;
    else el.innerHTML = '&nbsp;';
  }

  /** Показать введённое слово с цветом результата, потом очистить. */
  private flashWord(word: string, cls: FlashCls): void {
    if (this.flashTimer !== null) window.clearTimeout(this.flashTimer);
    const el = this.el('current-word');
    el.textContent = word;
    el.className = cls;
    this.flashTimer = window.setTimeout(() => {
      this.flashTimer = null;
      this.updateWordDisplay('');
    }, WORD_FLASH_MS);
  }

  private shakeWheel(): void {
    const area = this.el('wheel-area');
    area.classList.remove('shake');
    void area.offsetWidth; // перезапуск CSS-анимации
    area.classList.add('shake');
  }

  toast(msg: string): void {
    const el = this.el('toast');
    el.textContent = msg;
    el.classList.add('show');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      el.classList.remove('show');
      this.toastTimer = null;
    }, TOAST_MS);
  }

  private showOverlay(html: string): void {
    this.wheel?.cancelDrag();
    this.el('overlay-panel').innerHTML = html;
    this.el('overlay').classList.remove('hidden');
  }

  private hideOverlay(): void {
    this.el('overlay').classList.add('hidden');
    this.el('overlay-panel').innerHTML = '';
  }
}
