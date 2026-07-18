/**
 * Рендер стола и сессия раздачи (порт DOM/UI-части prototype/game.js 1:1).
 *
 * РЕШЕНИЕ ПО РЕНДЕРУ (задокументировано и в README): стол — ЧИСТЫЙ DOM, как в
 * прототипе, БЕЗ Phaser. Причина — требования доступности ЦА 45+ из главы 07:
 * крупные карты-кнопки с aria-label, tabindex-навигация с клавиатуры
 * (Enter/Space), aria-live тосты и оверлеи — всё это в DOM «бесплатно», а в
 * канвасе потребовало бы параллельного accessibility-дерева. Прод-стек при
 * этом полный: TypeScript strict + Vite + Capacitor (WebView рендерит DOM
 * нативно). Портированы 1:1: клики/клавиатура, подсветка playable, режим
 * джокера, автоподсказка 12 с, тряска ошибочного тапа, оверлеи итога.
 *
 * Логика партии — core/ (чистая), экономика/мета — economy/ + meta/.
 * Здесь — только DOM и связка слоёв (как GameScene в порте Block Surge).
 */
import { CORE_CFG } from '../core/config';
import { SLOTS, TABLE_SIZE } from '../core/layout';
import { RANK_LABELS, SUITS, isAdjacent, multiplierFor } from '../core/rules';
import { generateLevel } from '../core/generator';
import {
  anyMoves,
  createGame,
  drawStock,
  extendStock,
  firstPlayable,
  isOpen,
  playCard,
  stockLeft,
  undoLast
} from '../core/game';
import { mulberry32, randomSeed } from '../core/rng';
import type { GameState } from '../core/types';
import { ECON } from '../economy/econ';
import type { Analytics } from '../economy/analytics';
import type { Economy } from '../economy/economy';
import type { KeyValueStorage } from '../economy/store';
import { Meta, streakRewardFor } from '../meta/meta';
import { TOTAL_ORDERS } from '../meta/config';
import type { MonetizeController } from '../monetize/monetize';
import { t, tDyn } from '../i18n';
import { sound } from '../audio';
import type { MetaUi } from './MetaUi';

/** Локализованный номинал карты (Т/В/Д/К ↔ A/J/Q/K; ядро остаётся русским). */
function rankLabel(rank: number): string {
  return tDyn('card.rank.' + rank, RANK_LABELS[rank]);
}

/** Данные экрана победы (держим на сессии, чтобы перерисовывать оверлей). */
interface WinInfo {
  n: number;
  stockCards: number;
  stockB: number;
  win: number;
  gained: number;
  /** База удвоения RW2 «×2 награда» (монеты уровня, 06 §6.2). */
  doubleBase: number;
  /** RW2 уже забран в ЭТОМ уровне (1/уровень). */
  rw2Used: boolean;
}

interface LoseInfo {
  pct: number;
  gained: number;
  /** Доля очистки стола — RW1 «Второй шанс» доступен при ≥ 0.60 (06 §6.2). */
  clearRatio: number;
}

/** Сессия раздачи: core-состояние + обвязка экономики/бустеров (поля G прототипа). */
interface Session {
  game: GameState;
  entryLevel: number;
  entryCost: number;
  entryPaid: number;
  jokerArmed: boolean;
  basketActive: boolean;
  harvestCommitted: boolean;
  /** RW1 «Второй шанс» уже использован в ЭТОМ уровне (1/уровень, 06 §6.2). */
  rw1Used: boolean;
  win: WinInfo | null;
  lose: LoseInfo | null;
}

export class TableUi {
  private s: Session | null = null;
  /** DOM-элементы карт стола по id слота. */
  private cardEls: HTMLElement[] = [];
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private hintEl: HTMLElement | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  /* Рекорд/статистика — legacy-ключи Прохода А (совместимость сейва). */
  private bestScore: number;
  private winsCount: number;
  private gamesCount: number;

  /** Последний финал — победа (INT1 запрашивается ТОЛЬКО после победы, 06 §6.3.4). */
  private lastFinishWin = false;

  constructor(
    private readonly economy: Economy,
    private readonly meta: Meta,
    private readonly metaUi: MetaUi,
    private readonly analytics: Analytics,
    private readonly monetize: MonetizeController,
    private readonly storage: KeyValueStorage
  ) {
    this.bestScore = this.lsGet(ECON.LEGACY_BEST, 0);
    this.winsCount = this.lsGet(ECON.LEGACY_WINS, 0);
    this.gamesCount = this.lsGet(ECON.LEGACY_GAMES, 0);
  }

  /* ==================== legacy-ключи (lsGet/lsSet прототипа) ==================== */

  private lsGet(key: string, dflt: number): number {
    try {
      const v = this.storage.getItem(key);
      if (v === null) return dflt;
      const parsed: unknown = JSON.parse(v);
      return typeof parsed === 'number' && isFinite(parsed) ? parsed : dflt;
    } catch {
      return dflt;
    }
  }

  private lsSet(key: string, value: number): void {
    try {
      this.storage.setItem(key, JSON.stringify(value));
    } catch {
      /* приватный режим и т.п. — играем без сохранения */
    }
  }

  /* ============================ ИНИЦИАЛИЗАЦИЯ ============================ */

  init(): void {
    this.economy.subscribe(() => this.syncHud());
    this.metaUi.onClose = () => this.syncHud();

    this.byId('btn-restart').addEventListener('click', () => this.newGame());
    this.byId('btn-garden').addEventListener('click', () => this.openGarden('garden'));

    const stock = this.byId('stock-card');
    stock.addEventListener('click', () => this.onStockClick());
    stock.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
        e.preventDefault();
        this.onStockClick();
      }
    });

    this.byId('bst-undo').addEventListener('click', () => this.doUndo());
    this.byId('bst-joker').addEventListener('click', () => this.toggleJoker());
    this.byId('bst-basket').addEventListener('click', () => this.activateBasket());
    // RW6 «Кошелёк садовода» — контекстная кнопка (видимость в updateBoosterBar).
    const wallet = document.getElementById('bst-wallet');
    if (wallet !== null) {
      wallet.addEventListener(
        'click',
        // показ упал (прод-SDK) → без награды, кнопка живёт дальше
        () => void this.monetize.rwWallet().catch(() => false)
      );
    }

    this.byId('overlay').addEventListener('click', (ev) => this.onOverlayClick(ev));
  }

  private byId(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (el === null) throw new Error('TableUi: нет контейнера #' + id);
    return el;
  }

  /* ============================ НОВАЯ ПАРТИЯ ============================ */

  newGame(): void {
    this.clearHint();
    this.hideOverlay();
    this.disarmJoker();

    // Взнос за старт раздачи (sink монет, 05 §5.2). Не хватает — раздача
    // бесплатна (жёсткой стены нет; дефицит закроют rewarded/IAP в Е.2).
    this.economy.resetEarnedThisLevel();
    const level = this.economy.getLevel();
    const cost = this.economy.entryCost(level);
    const entryPaid = this.economy.spendCoins(cost, 'entry') ? cost : 0;

    const deal = generateLevel(mulberry32(randomSeed()));
    this.s = {
      game: createGame(deal),
      entryLevel: level,
      entryCost: cost,
      entryPaid,
      jokerArmed: false,
      basketActive: false,
      harvestCommitted: false,
      rw1Used: false,
      win: null,
      lose: null
    };
    this.buildTableDom();
    this.render();
    this.updateBoosterBar();
    this.armIdleTimer();
  }

  /* ============================ DOM СТОЛА (ядро) ============================ */

  private buildTableDom(): void {
    const s = this.s;
    if (s === null) return;
    const peaks = this.byId('peaks');
    peaks.innerHTML = '';
    this.cardEls = [];
    for (const slot of SLOTS) {
      const el = document.createElement('div');
      el.className = 'card down';
      el.style.left = `calc(${slot.col} * (var(--card-w) + var(--gap)))`;
      el.style.top = `calc(${slot.row} * var(--row-step))`;
      el.style.zIndex = String(slot.row + 1);
      el.setAttribute('role', 'button');

      const rank = s.game.deal.tableRanks[slot.id];
      const suit = SUITS[s.game.deal.tableSuits[slot.id]];
      const label = rankLabel(rank);
      if (suit.red) el.classList.add('red-suit');
      el.innerHTML =
        `<div class="face">` +
        `<span class="corner tl">${label}</span>` +
        `<span class="suit-center">${suit.sym}</span>` +
        `<span class="corner br">${label}</span>` +
        `</div>` +
        (s.game.deal.harvest.has(slot.id) ? `<span class="apple-badge">🍎</span>` : '');
      el.addEventListener('click', () => this.onCardClick(slot.id));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.onCardClick(slot.id);
        }
      });
      peaks.appendChild(el);
      this.cardEls.push(el);
    }
  }

  /* ============================ РЕНДЕР ============================ */

  private render(): void {
    const s = this.s;
    if (s === null) return;
    const g = s.game;

    // Стол: классы состояния + aria/tabindex (доступность 45+, глава 07).
    for (const slot of SLOTS) {
      const el = this.cardEls[slot.id];
      const removed = g.removed.has(slot.id);
      const open = isOpen(g, slot.id);
      el.classList.toggle('removed', removed);
      el.classList.toggle('down', !removed && !open);
      el.classList.toggle('up', !removed && open);
      const normalPlayable =
        !g.over && !removed && open && isAdjacent(g.deal.tableRanks[slot.id], g.waste);
      // В режиме джокера подсвечиваем как «взаимодействуемую» любую открытую карту.
      el.classList.toggle('playable', normalPlayable || (s.jokerArmed && !g.over && !removed && open));

      if (removed) {
        el.setAttribute('aria-hidden', 'true');
        el.setAttribute('tabindex', '-1');
      } else {
        el.removeAttribute('aria-hidden');
        el.setAttribute(
          'aria-label',
          open
            ? t('card.open.aria', {
                card: `${rankLabel(g.deal.tableRanks[slot.id])}${SUITS[g.deal.tableSuits[slot.id]].sym}`
              })
            : t('card.closed.aria')
        );
        el.setAttribute('tabindex', open && !g.over ? '0' : '-1');
      }
    }

    // Колода
    const left = stockLeft(g);
    this.byId('stock-count').textContent = String(left);
    this.byId('stock-card').classList.toggle('empty', left === 0);

    // Сброс
    const wasteEl = this.byId('waste-card');
    const wl = rankLabel(g.waste);
    const ws = SUITS[g.wasteSuit];
    wasteEl.classList.toggle('red-suit', ws.red);
    wasteEl.classList.toggle('glow', g.chain >= 2);
    wasteEl.innerHTML =
      `<div class="face">` +
      `<span class="corner tl">${wl}</span>` +
      `<span class="suit-center">${ws.sym}</span>` +
      `<span class="corner br">${wl}</span>` +
      `</div>`;

    // Прогресс очистки стола
    this.byId('progress-fill').style.width = `${(g.removed.size / TABLE_SIZE) * 100}%`;

    this.syncHud();
  }

  /** Обновление всех числовых полей HUD (вызывается и после закрытия меты). */
  syncHud(): void {
    this.byId('hud-coins').textContent = this.economy.fmt(this.economy.getCoins());
    this.byId('hud-harvest-bank').textContent = this.economy.fmt(this.economy.getHarvest());
    this.byId('hud-level').textContent = String(this.economy.getLevel());
    const s = this.s;
    if (s !== null) {
      this.byId('hud-score').textContent = String(s.game.score);
      this.byId('hud-chain').textContent =
        s.game.chain > 0 ? `${s.game.chain} (×${multiplierFor(s.game.chain).toFixed(1)})` : '—';
      this.byId('hud-harvest').textContent = `${s.game.harvestGot}/${s.game.deal.harvest.size}`;
    }
    this.updateBoosterBar(); // держим счётчики бустеров/ундо свежими (в т.ч. после лавки)
  }

  private shake(el: HTMLElement): void {
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), 400);
  }

  /* ============================ ХОДЫ ============================ */

  private onCardClick(slotId: number): void {
    const s = this.s;
    if (s === null || s.game.over) return;
    const g = s.game;
    if (g.removed.has(slotId)) return;

    if (!isOpen(g, slotId)) {
      if (s.jokerArmed) this.gToast(t('game.toast.jokerOpenOnly'));
      this.shake(this.cardEls[slotId]);
      this.armIdleTimer();
      return;
    }

    const adjacent = isAdjacent(g.deal.tableRanks[slotId], g.waste);

    if (s.jokerArmed) {
      if (adjacent) {
        // Соседняя карта — обычный ход, джокер сохраняем.
        this.disarmJoker();
        this.applyMove(slotId, false);
      } else {
        // Не соседняя — тратим джокер как «дикую карту».
        if (!this.economy.consumeBooster('joker', 'in')) {
          this.disarmJoker();
          return;
        }
        this.disarmJoker();
        this.gToast(t('game.toast.jokerUsed'));
        this.applyMove(slotId, true);
      }
      return;
    }

    if (!adjacent) {
      this.shake(this.cardEls[slotId]);
      this.armIdleTimer();
      return;
    }
    this.applyMove(slotId, false);
  }

  /** Уборка карты со стола (общий путь обычного хода и джокера). */
  private applyMove(slotId: number, viaJoker: boolean): void {
    const s = this.s;
    if (s === null) return;
    const res = playCard(s.game, slotId, viaJoker);
    if (res === null) return;

    if (res.harvest) this.meta.track('harvest', 1); // миссия «собрать урожай»
    if (res.chain === CORE_CFG.CHAIN_MISSION) this.meta.track('chain5', 1);

    if (res.finished === 'win') {
      this.finishWin();
      return;
    }
    if (res.finished === 'lose') {
      this.finishLose();
      return;
    }
    // Проход З: звук хода. Финалы звучат своей темой (finishWin/finishLose);
    // 🍎 — тёплый двузвук, обычная карта — нота, растущая с длиной серии.
    sound.play(res.harvest ? { kind: 'harvest' } : { kind: 'cardRemoved', chain: res.chain });
    this.render();
    this.armIdleTimer();
  }

  private onStockClick(): void {
    const s = this.s;
    if (s === null || s.game.over) return;
    if (s.jokerArmed) this.disarmJoker(); // тап по колоде отменяет режим джокера
    const res = drawStock(s.game);
    if (res === null) {
      this.shake(this.byId('stock-card'));
      this.armIdleTimer();
      return;
    }
    if (res.finished === 'lose') {
      this.finishLose();
      return;
    }
    sound.play({ kind: 'stockDraw' }); // Проход З: обрыв серии — низкая мягкая нота
    this.render();
    this.armIdleTimer();
  }

  /* ==================== БУСТЕРЫ В РАЗДАЧЕ (05 §5.6) ==================== */

  /** Отмена хода. Бесплатные ундо (инвентарь) → затем 150 монет (05 §5.2). */
  private doUndo(): void {
    const s = this.s;
    if (s === null || s.game.over) return;
    if (s.game.history.length === 0) {
      this.gToast(t('game.toast.nothingToUndo'));
      return;
    }
    const kind = this.economy.useUndo();
    if (kind === null) {
      this.gToast(t('game.toast.noCoinsUndo', { price: ECON.UNDO_PRICE }));
      return;
    }

    const undone = undoLast(s.game);
    if (undone !== null && undone.jokerRefund) {
      this.economy.addBooster('joker', 1, 'undo_refund'); // вернуть потраченный джокер
    }

    this.gToast(
      kind === 'free' ? t('game.toast.undoFree') : t('game.toast.undoPaid', { price: ECON.UNDO_PRICE })
    );
    this.render();
    this.updateBoosterBar();
    this.armIdleTimer();
  }

  private armJoker(): void {
    const s = this.s;
    if (s === null || s.game.over) return;
    if (this.economy.getBooster('joker') <= 0) {
      this.openGarden('shop');
      return;
    }
    s.jokerArmed = true;
    document.body.classList.add('joker-mode');
    this.gToast(t('game.toast.jokerChoose'));
    this.render();
    this.updateBoosterBar();
  }

  private disarmJoker(): void {
    const s = this.s;
    if (s === null) return;
    if (s.jokerArmed) {
      s.jokerArmed = false;
      document.body.classList.remove('joker-mode');
      this.updateBoosterBar();
    }
  }

  private toggleJoker(): void {
    const s = this.s;
    if (s === null || s.game.over) return;
    if (s.jokerArmed) {
      this.disarmJoker();
      this.render();
    } else {
      this.armJoker();
    }
  }

  private activateBasket(): void {
    const s = this.s;
    if (s === null || s.game.over) return;
    if (s.basketActive) {
      this.gToast(t('game.toast.basketAlready'));
      return;
    }
    if (this.economy.getBooster('basket') <= 0) {
      this.openGarden('shop');
      return;
    }
    if (!this.economy.consumeBooster('basket', 'in')) return;
    s.basketActive = true;
    this.gToast(t('game.toast.basketOn', { mult: ECON.BASKET_MULT }));
    this.updateBoosterBar();
  }

  private updateBoosterBar(): void {
    const s = this.s;
    const over = s === null || s.game.over;
    const free = this.economy.getFreeUndos();

    const undoBtn = document.getElementById('bst-undo') as HTMLButtonElement | null;
    if (undoBtn !== null) {
      undoBtn.textContent =
        free > 0
          ? t('booster.undo.free', { n: free })
          : t('booster.undo.paid', { price: ECON.UNDO_PRICE });
      undoBtn.disabled = s === null || s.game.over || s.game.history.length === 0;
    }
    const jokerBtn = document.getElementById('bst-joker') as HTMLButtonElement | null;
    if (jokerBtn !== null) {
      jokerBtn.textContent = t('booster.joker.count', { n: this.economy.getBooster('joker') });
      jokerBtn.classList.toggle('armed', s !== null && s.jokerArmed);
      jokerBtn.disabled = over;
    }
    const basketBtn = document.getElementById('bst-basket') as HTMLButtonElement | null;
    if (basketBtn !== null) {
      basketBtn.textContent =
        s !== null && s.basketActive
          ? t('booster.basket.active')
          : t('booster.basket.count', { n: this.economy.getBooster('basket') });
      basketBtn.classList.toggle('armed', s !== null && s.basketActive);
      basketBtn.disabled = over || (s !== null && s.basketActive);
    }
    // RW6 «Кошелёк садовода»: видна только при «нужде» (баланс < 2·E(n)) и
    // свободном дневном капе (порт updateBarButtons прототипа).
    const walletBtn = document.getElementById('bst-wallet') as HTMLButtonElement | null;
    if (walletBtn !== null) {
      walletBtn.style.display = this.monetize.walletOfferVisible() ? '' : 'none';
    }
  }

  /* ============================ ФИНАЛЫ ============================ */

  /** Банковка урожая (×2 лукошко); при поражении урожай тоже сохраняется (03 п. 3.6). */
  private commitHarvest(): number {
    const s = this.s;
    if (s === null || s.harvestCommitted) return 0;
    const mult = s.basketActive ? ECON.BASKET_MULT : 1;
    // Проход Е.2: подписка «Клуб садовода» даёт +50% урожая (06 §6.5).
    const clubMult = this.monetize.harvestMultiplier();
    const gained = Math.round(s.game.harvestGot * ECON.HARVEST_PER_CARD * mult * clubMult);
    if (gained > 0) this.economy.addHarvest(gained, s.basketActive ? 'basket' : 'cards');
    s.harvestCommitted = true;
    return gained;
  }

  private finishWin(): void {
    const s = this.s;
    if (s === null) return;
    this.clearHint();
    this.disarmJoker();
    sound.play({ kind: 'win' }); // Проход З: восходящее арпеджио победы

    const n = s.entryLevel; // уровень только что сыгранной раздачи
    const stockCards = stockLeft(s.game);
    const stockB = this.economy.stockBonus(stockCards);
    const win = this.economy.winReward(n);

    this.economy.addCoins(win, 'win', true);
    if (stockB > 0) this.economy.addCoins(stockB, 'stock_bonus', true);
    const gained = this.commitHarvest();
    this.economy.nextLevel(); // прогресс к n+1
    this.meta.track('wins', 1); // недельная миссия «выиграй N уровней»

    // Проход Е.2: копилка копит 5% выигрышей; счётчик уровней для правил INT
    // (06 §6.3); INT1 возможен только на возврате в сад после победы.
    this.monetize.onCoinsWon(win + stockB);
    this.monetize.onLevelFinished();
    this.lastFinishWin = true;

    this.winsCount++;
    this.gamesCount++;
    this.lsSet(ECON.LEGACY_WINS, this.winsCount);
    this.lsSet(ECON.LEGACY_GAMES, this.gamesCount);
    if (s.game.score > this.bestScore) {
      this.bestScore = s.game.score;
      this.lsSet(ECON.LEGACY_BEST, this.bestScore);
    }

    this.analytics.track('level_finish', {
      result: 'win',
      level: n,
      coins_won: win + stockB,
      harvest_earned: gained
    });

    s.win = { n, stockCards, stockB, win, gained, doubleBase: win + stockB, rw2Used: false };
    this.syncHud();
    this.updateBoosterBar();
    this.showOverlay(this.winOverlayHtml());
  }

  private winOverlayHtml(): string {
    const s = this.s;
    if (s === null || s.win === null) return '';
    const w = s.win;
    const earned = this.economy.getEarnedThisLevel();
    const net = earned - s.entryPaid;
    const E = this.economy;

    // Rewarded-CTA (06 §6.2): RW2 «×2 награда» + RW5 в ивент-уикенд.
    // Rewarded не убирается remove-ads/подпиской.
    let adCta = '';
    if (!w.rw2Used) {
      adCta += `<button class="btn-ad" data-ov="rw2" type="button">${t('ad.rw2.cta')} <span class="sim-tag">${t('ad.simTag')}</span></button>`;
    } else {
      adCta += `<div class="ad-done">${t('ad.rw2.done')}</div>`;
    }
    if (this.monetize.isEventWeekend()) {
      adCta += `<button class="btn-ad" data-ov="rw5" type="button">${t('ad.rw5.cta')} <span class="sim-tag">${t('ad.simTag')}</span></button>`;
    }
    adCta = `<div class="ad-cta">${adCta}</div>`;

    return (
      `<div class="emoji">🎉🍎</div>` +
      `<h2>${t('win.title')}</h2>` +
      `<p>${t('win.subtitle', { n: w.n })}</p>` +
      `<table class="reward">` +
      `<tr><td>${t('win.row.entry')}</td><td>${s.entryPaid > 0 ? '−' + E.fmt(s.entryPaid) : t('win.entry.free')}</td></tr>` +
      `<tr><td>${t('win.row.reward', { n: w.n })}</td><td>+${E.fmt(w.win)}</td></tr>` +
      `<tr><td>${t('win.row.stockBonus', { n: w.stockCards })}</td><td>+${E.fmt(w.stockB)}</td></tr>` +
      (w.rw2Used ? `<tr><td>${t('win.row.rw2')}</td><td>+${E.fmt(w.doubleBase)}</td></tr>` : '') +
      `<tr class="total"><td>${t('win.row.total')}</td><td>${net >= 0 ? '+' : ''}${E.fmt(net)}</td></tr>` +
      `<tr><td>${t('win.row.harvest', { n: s.game.harvestGot, x2: s.basketActive ? ' ×2' : '' })}</td><td>+${E.fmt(w.gained)} 🍎</td></tr>` +
      `<tr><td>${t('win.row.balance')}</td><td>💰 ${E.fmt(E.getCoins())}</td></tr>` +
      `<tr><td>${t('win.row.harvestBank')}</td><td>🍎 ${E.fmt(E.getHarvest())}</td></tr>` +
      `</table>` +
      adCta +
      this.metaCtaWin() +
      `<div class="btn-row">` +
      `<button class="btn-main" data-ov="garden" type="button">${t('btn.toGarden')}</button>` +
      `<button class="btn-main" data-ov="again" type="button">${t('btn.playAgain')}</button>` +
      `</div>`
    );
  }

  /** Мотиватор петли: пока сад не пройден целиком — зовём продвинуть заказ. */
  private metaCtaWin(): string {
    if (this.meta.gardenCompleted() < TOTAL_ORDERS) {
      return `<p class="kept">${t('win.metaCta')}</p>`;
    }
    return '';
  }

  private finishLose(): void {
    const s = this.s;
    if (s === null) return;
    this.clearHint();
    this.disarmJoker();
    sound.play({ kind: 'lose' }); // Проход З: две мягкие ноты вниз (утешительно)

    this.gamesCount++;
    this.lsSet(ECON.LEGACY_GAMES, this.gamesCount);
    const gained = this.commitHarvest(); // урожай сохраняется даже при поражении (п. 3.6)

    // Проход Е.2: INT никогда после поражения (06 §6.3.4).
    this.monetize.onLevelFinished();
    this.lastFinishWin = false;

    this.analytics.track('level_finish', {
      result: 'lose',
      level: s.entryLevel,
      harvest_earned: gained
    });

    const clearRatio = s.game.removed.size / TABLE_SIZE;
    s.lose = { pct: Math.round(clearRatio * 100), gained, clearRatio };
    this.syncHud();
    this.updateBoosterBar();
    this.showOverlay(this.loseOverlayHtml());
  }

  private loseOverlayHtml(): string {
    const s = this.s;
    if (s === null || s.lose === null) return '';
    const L = s.lose;
    const E = this.economy;
    // RW1 «Второй шанс» (06 §6.2): rewarded, только если стол ≥ 60% чист и ещё
    // не брали в ЭТОМ уровне (флаг на сессии — 1/уровень даже после добора).
    let adCta = '';
    if (L.clearRatio >= 0.6 && !s.rw1Used) {
      adCta =
        `<div class="ad-cta">` +
        `<button class="btn-ad" data-ov="rw1" type="button">${t('ad.rw1.cta')} <span class="sim-tag">${t('ad.simTag')}</span></button>` +
        `</div>`;
    }
    return (
      `<div class="emoji">🐶</div>` +
      `<h2>${t('lose.title')}</h2>` +
      `<p>${t('lose.subtitle', { pct: L.pct })}</p>` +
      (L.gained > 0
        ? `<p class="kept">${t('lose.harvestKept', { n: E.fmt(L.gained) })}</p>`
        : `<p class="kept">${t('lose.harvestNone')}</p>`) +
      `<p>${t('lose.balance', { coins: E.fmt(E.getCoins()), harvest: E.fmt(E.getHarvest()) })}</p>` +
      adCta +
      `<div class="btn-row">` +
      `<button class="btn-main" data-ov="garden" type="button">${t('btn.toGarden')}</button>` +
      `<button class="btn-main" data-ov="again" type="button">${t('btn.tryAgain')}</button>` +
      `</div>`
    );
  }

  /* ==================== ОВЕРЛЕЙ / МЕТА-ПЕРЕХОДЫ ==================== */

  private showOverlay(html: string): void {
    const overlay = this.byId('overlay');
    const panel = overlay.querySelector('.panel');
    if (panel !== null) panel.innerHTML = html;
    overlay.classList.remove('hidden');
  }

  private hideOverlay(): void {
    this.byId('overlay').classList.add('hidden');
  }

  private openGarden(tab: 'garden' | 'tasks' | 'shop'): void {
    this.metaUi.open(tab);
  }

  /** Делегированная обработка кнопок оверлея (data-ov). */
  private onOverlayClick(ev: Event): void {
    const b = (ev.target as HTMLElement).closest('[data-ov]');
    if (b === null) return;
    const act = b.getAttribute('data-ov');
    if (act === 'again') this.newGame();
    else if (act === 'garden') this.goGardenFromOverlay(); // возможен INT1 после победы
    else if (act === 'close') this.hideOverlay();
    else if (act === 'rw2') this.onRewardedDoubleWin();
    else if (act === 'rw5') this.onRewardedEventTokens();
    else if (act === 'rw1') this.onRewardedSecondChance();
  }

  /**
   * Возврат на карту сада после победы: правила 06 §6.3 решают, показать ли
   * INT1. После поражения (lastFinishWin=false) interstitial не запрашивается.
   */
  private goGardenFromOverlay(): void {
    if (this.lastFinishWin) {
      void this.monetize
        .maybeInterstitial(() => this.openGarden('garden'))
        // показ упал (прод-SDK) → onDone не вызван, сад открываем всё равно
        .catch(() => this.openGarden('garden'));
    } else {
      this.openGarden('garden');
    }
  }

  /** RW2 «Удвоить награду» (06 §6.2): rewarded на экране победы → ×2 монет уровня. */
  private onRewardedDoubleWin(): void {
    const s = this.s;
    if (s === null || s.win === null || s.win.rw2Used) return;
    const w = s.win;
    void this.monetize
      .showRewarded('RW2', () => {
        this.economy.addCoins(w.doubleBase, 'rw2_double', true);
        w.rw2Used = true;
        this.syncHud();
        this.showOverlay(this.winOverlayHtml()); // перерисовать итог с удвоением
      })
      .catch(() => false); // показ упал (прод-SDK) → без удвоения, экран итога на месте
  }

  /** RW5 «×2 жетоны ярмарки» (06 §6.2): rewarded на победе во время ивента пт–вс. */
  private onRewardedEventTokens(): void {
    void this.monetize
      .rwEventTokens()
      .catch(() => false) // показ упал (прод-SDK) → без бонуса, оверлей актуализируем
      .then(() => {
        this.syncHud();
        if (this.s?.win != null) this.showOverlay(this.winOverlayHtml());
      });
  }

  /**
   * RW1 «Второй шанс» (06 §6.2): rewarded из тупика (стол ≥ 60%) → +5 карт в
   * колоду и продолжение уровня вместо поражения.
   */
  private onRewardedSecondChance(): void {
    const s = this.s;
    if (s === null || s.lose === null || s.rw1Used) return;
    void this.monetize
      .showRewarded('RW1', () => {
        const cards: { rank: number; suit: number }[] = [];
        for (let i = 0; i < 5; i++) {
          cards.push({
            rank: 1 + Math.floor(Math.random() * 13),
            suit: Math.floor(Math.random() * 4)
          });
        }
        extendStock(s.game, cards); // снимает флаг поражения (core/game.ts)
        s.rw1Used = true;
        s.lose = null;
        this.hideOverlay();
        this.gToast(t('game.toast.secondChance'));
        this.render();
        this.updateBoosterBar();
        this.armIdleTimer();
      })
      .catch(() => false); // показ упал (прод-SDK) → экран поражения остаётся
  }

  /** Стрик-модалка на входе (ежедневный ритуал, 04 §4.4). */
  maybeShowStreakModal(): void {
    const s = this.meta.streakStatus();
    if (!s.claimable) return;
    const rw = streakRewardFor(s.day);
    const extra =
      (rw.undo ? t('streak.extra.undo') : '') +
      (rw.joker ? t('streak.extra.joker') : '') +
      (rw.basket ? t('streak.extra.basket') : '');
    this.showOverlay(
      `<div class="emoji">🌅</div>` +
      `<h2>${t('streak.title')}</h2>` +
      `<p>${t('streak.subtitle', { d: s.day })}</p>` +
      `<p class="kept">${t('streak.reward', { coins: rw.coins, extra })}</p>` +
      `<div class="btn-row">` +
      `<button class="btn-main ghost" data-ov="close" type="button">${t('btn.later')}</button>` +
      `<button class="btn-main" data-streak="1" type="button">${t('btn.claim')}</button>` +
      `</div>`
    );
    // Отдельная привязка кнопки «Забрать» (грант + перерисовка HUD).
    const claimBtn = this.byId('overlay').querySelector('[data-streak]');
    if (claimBtn !== null) {
      claimBtn.addEventListener('click', () => {
        if (this.meta.claimStreak()) {
          sound.play({ kind: 'reward' }); // Проход З: двузвук награды стрика
          this.gToast(t('game.toast.streakClaimed'));
        }
        this.hideOverlay();
        this.syncHud();
      });
    }
  }

  /* ==================== АВТОПОДСКАЗКА (12 с) ==================== */

  private clearHint(): void {
    if (this.hintEl !== null) {
      this.hintEl.classList.remove('hint');
      this.hintEl = null;
    }
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private armIdleTimer(): void {
    this.clearHint();
    this.idleTimer = setTimeout(() => this.showIdleHint(), CORE_CFG.IDLE_HINT_MS);
  }

  private showIdleHint(): void {
    const s = this.s;
    if (s === null || s.game.over) return;
    const p = firstPlayable(s.game);
    if (p !== null) {
      this.hintEl = this.cardEls[p];
    } else if (stockLeft(s.game) > 0) {
      this.hintEl = this.byId('stock-card');
    }
    if (this.hintEl !== null) this.hintEl.classList.add('hint');
  }

  /* ==================== ЛЁГКИЙ ИГРОВОЙ ТОСТ ==================== */

  private gToast(msg: string): void {
    const t = document.getElementById('game-toast');
    if (t === null) return;
    t.textContent = msg;
    t.classList.add('show');
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 1900);
  }

  /** Есть ли ходы (для будущих подсказок/отладки). */
  hasMoves(): boolean {
    return this.s !== null && anyMoves(this.s.game);
  }
}
