/**
 * DOM-оверлей меты (Проход Е.2, порт UI-части meta.js «в духе прототипа»):
 * топбар с балансом монет и кнопкой «Мета», бустер-бар под канвасом,
 * полноэкранный мета-экран (карта / магазин / миссии / стрик) и тосты.
 *
 * Канвас Phaser остаётся единственным рендером ПАРТИИ; мета — DOM, как в
 * прототипе: длинные скроллируемые списки и кнопки дешевле и доступнее в DOM.
 * Контейнеры (#metaTopbar / #boosterBar / #toast / #metaScreen) и стили
 * объявлены в index.html; класс только наполняет их и слушает клики.
 */
import { ECON, type BoosterId } from '../economy/econ';
import type { Economy } from '../economy/economy';
import type { Meta } from '../meta/meta';
import type { BoosterController } from '../meta/boosters';
import { MAP_NODES, MISSION_BONUS, STREAK_REWARDS, type NodeReward } from '../meta/config';
import { missionDef } from '../meta/missions';

/**
 * Панель rewarded-офферов мета-экрана (Проход Е.2: RW-3/RW-4, 06 §2.2).
 * MetaUi владеет DOM, состояние и действия отдаёт монетизация (main.ts).
 */
export interface MetaAdPanel {
  /** Строка статуса «Сегодня rewarded: RW-3 x/2 · RW-4 y/2 …». */
  statusLine(): string;
  rw3Enabled(): boolean;
  rw4Enabled(): boolean;
  /** RW-3 «Бесплатный бустер (Молот)». */
  onRw3(): void;
  /** RW-4 «×2 награда дня (+100🪙)». */
  onRw4(): void;
  /** Мета-экран открыт: офферы «показаны» (воронка rewarded, 09 §3). */
  onShown(): void;
}

export class MetaUi {
  /** Клик по бустеру в партии — обрабатывает сцена (нужен GameState). */
  onBoosterClick: ((id: BoosterId) => void) | null = null;
  /** Проход Е.2: клики по бейджам топбара (магазин 🛒 / дашборд 📊). */
  onShopClick: (() => void) | null = null;
  onDashClick: (() => void) | null = null;
  /** Проход Е.3: клик по бейджу soft-launch кокпита (🚀). */
  onCockpitClick: (() => void) | null = null;
  /** Проход Е.2: rewarded-панель мета-экрана (null — секция скрыта). */
  adPanel: MetaAdPanel | null = null;

  private toastTimer: number | null = null;

  constructor(
    private readonly economy: Economy,
    private readonly meta: Meta,
    private readonly boosters: BoosterController
  ) {}

  private el(id: string): HTMLElement {
    const node = document.getElementById(id);
    if (!node) throw new Error('MetaUi: нет контейнера #' + id + ' в index.html');
    return node;
  }

  /* ============================ МОНТАЖ ============================ */

  mount(): void {
    // Топбар: баланс монет + бейджи магазина/дашборда (Е.2) + вход в мету.
    this.el('metaTopbar').innerHTML =
      '<div class="coinBox"><span class="coinIcon">🪙</span>' +
      '<span class="value" id="coinBal">0</span></div>' +
      '<div class="topbarBtns">' +
      '<button id="openShopBtn" type="button" class="metaBtn" title="Магазин (СИМУЛЯЦИЯ)">🛒</button>' +
      '<button id="openDashBtn" type="button" class="metaBtn" title="Дашборд монетизации">📊</button>' +
      '<button id="openCockpitBtn" type="button" class="metaBtn" title="Soft-launch кокпит">🚀</button>' +
      '<button id="openMetaBtn" type="button" class="metaBtn">🗺️ Мета</button>' +
      '</div>';
    this.el('openMetaBtn').addEventListener('click', () => this.openMeta());
    this.el('openShopBtn').addEventListener('click', () => this.onShopClick?.());
    this.el('openDashBtn').addEventListener('click', () => this.onDashClick?.());
    this.el('openCockpitBtn').addEventListener('click', () => this.onCockpitClick?.());

    // Бустер-бар: делегирование кликов по кнопкам.
    this.el('boosterBar').addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.boosterBtn');
      if (!btn) return;
      const id = btn.getAttribute('data-boost') as BoosterId | null;
      if (id) this.onBoosterClick?.(id);
    });

    // Скелет мета-экрана (структура секций — 1:1 с прототипом, объём Прохода Б).
    this.el('metaScreen').innerHTML =
      '<div class="metaInner">' +
      '<div class="metaHeader">' +
      '<button id="metaCloseBtn" type="button" class="metaClose">← В игру</button>' +
      '<div class="metaTotals"><span>🪙 <b id="metaCoins">0</b></span>' +
      '<span>★ <b id="metaStars">0</b></span></div>' +
      '</div>' +
      '<section class="metaSection"><h3>🗺️ Карта «Путешествия»</h3>' +
      '<p class="metaNote">Копи ★ за партии (по очкам) — открывай узлы и забирай награды.</p>' +
      '<div id="mapList" class="mapList"></div></section>' +
      '<section class="metaSection"><h3>🛒 Магазин бустеров</h3>' +
      '<p class="metaNote">Трать монеты на инструменты спасения. Их же можно докупать прямо в партии.</p>' +
      '<div id="shopList" class="shopList"></div></section>' +
      '<section class="metaSection"><h3>🎯 Ежедневные миссии</h3>' +
      '<p class="metaNote">3 миссии в день с ротацией. Прогресс считается по ходам партии.</p>' +
      '<div id="missionList" class="missionList"></div></section>' +
      '<section class="metaSection"><h3>🔥 Серия дней</h3>' +
      '<p class="metaNote" id="streakCount">Серия: 0 дн.</p>' +
      '<div id="streakRow" class="streakRow"></div>' +
      '<div class="streakBtns">' +
      '<button id="streakClaimBtn" type="button">Получить награду дня</button>' +
      '<button id="simDayBtn" type="button" class="ghostBtn">⏭ Новый день (тест)</button>' +
      '</div></section>' +
      // Проход Е.2: rewarded-офферы RW-3/RW-4 (06 §2.2) — секция видима,
      // только если подключена панель монетизации (adPanel).
      '<section class="metaSection hidden" id="adSection">' +
      '<h3>📺 Реклама (СИМУЛЯЦИЯ)</h3>' +
      '<p class="metaNote" id="metaAdStatus"></p>' +
      '<div class="streakBtns">' +
      '<button id="rwBoosterBtn" type="button" class="rwBtn">🔨 Бустер за рекламу (RW-3)</button>' +
      '<button id="rwStreakBtn" type="button" class="rwBtn">🔥 ×2 награда дня (RW-4)</button>' +
      '</div></section>' +
      '</div>';

    this.el('metaCloseBtn').addEventListener('click', () => this.closeMeta());
    this.el('streakClaimBtn').addEventListener('click', () => this.meta.claimStreak());
    this.el('simDayBtn').addEventListener('click', () => this.meta.simNextDay());
    this.el('rwBoosterBtn').addEventListener('click', () => this.adPanel?.onRw3());
    this.el('rwStreakBtn').addEventListener('click', () => this.adPanel?.onRw4());

    // Делегирование кликов по спискам меты (забрать узел / купить бустер).
    this.el('metaScreen').addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const nodeBtn = t.closest('[data-node]');
      if (nodeBtn) {
        this.meta.claimNode(parseInt(nodeBtn.getAttribute('data-node') ?? '', 10));
        return;
      }
      const buyBtn = t.closest('[data-buy]');
      if (buyBtn) {
        const id = buyBtn.getAttribute('data-buy') as BoosterId;
        const def = ECON.BOOSTERS[id];
        if (this.economy.buyBooster(id)) this.toast('Куплен «' + def.name + '»');
        else this.toast('Недостаточно монет (' + def.price + '🪙)');
        this.renderMeta();
        this.renderBoosterBar();
      }
    });

    // Подписки на чистую логику.
    this.economy.onChange = () => this.refreshCoinHud();
    this.meta.onToast = (msg) => this.toast(msg);
    this.meta.onChanged = () => {
      this.refreshCoinHud();
      this.renderBoosterBar();
      this.renderMeta();
    };
    this.boosters.onToast = (msg) => this.toast(msg);

    this.refreshCoinHud();
    this.renderBoosterBar();
  }

  /* ============================ ТОСТЫ ============================ */

  toast(msg: string): void {
    const el = this.el('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastTimer = null;
      el.classList.add('hidden');
    }, 2000);
  }

  /* ======================== ВСЕГДА-ВИДИМЫЙ HUD ======================== */

  refreshCoinHud(): void {
    const el = document.getElementById('coinBal');
    if (el) el.textContent = String(this.economy.getCoins());
  }

  /** Бустер-бар в партии: кнопки со счётчиком; при нуле — цена докупки. */
  renderBoosterBar(): void {
    const bar = document.getElementById('boosterBar');
    if (!bar) return;
    let html = '';
    for (const id of ECON.BOOSTER_ORDER) {
      const def = ECON.BOOSTERS[id];
      const cnt = this.economy.getBooster(id);
      const armedCls = id === 'hammer' && this.boosters.isHammerArmed() ? ' armed' : '';
      const zeroCls = cnt <= 0 ? ' zero' : '';
      html +=
        '<button type="button" class="boosterBtn' + armedCls + zeroCls + '" data-boost="' + id + '">' +
        '<span class="bEmoji">' + def.emoji + '</span>' +
        '<span class="bName">' + def.name + '</span>' +
        '<span class="bCount">×' + cnt + '</span>' +
        '<span class="bPrice">' + (cnt <= 0 ? def.price + '🪙' : '') + '</span>' +
        '</button>';
    }
    bar.innerHTML = html;
  }

  /* =========================== МЕТА-ЭКРАН =========================== */

  openMeta(): void {
    if (this.boosters.disarmHammer()) this.renderBoosterBar();
    this.el('metaScreen').classList.remove('hidden');
    this.meta.ensureMissions();
    this.renderMeta();
    // Проход Е.2: офферы RW-3/RW-4 «показаны» (воронка rewarded, 09 §3).
    this.adPanel?.onShown();
  }

  closeMeta(): void {
    this.el('metaScreen').classList.add('hidden');
  }

  private rewardText(r: NodeReward): string {
    const parts: string[] = [];
    if (r.coins) parts.push(r.coins + '🪙');
    if (r.booster) parts.push('1× ' + ECON.BOOSTERS[r.booster].name);
    return parts.join(' + ');
  }

  renderMeta(): void {
    const screen = document.getElementById('metaScreen');
    if (!screen || screen.classList.contains('hidden')) {
      // Экран закрыт — обновляем только всегда-видимый баланс.
      this.refreshCoinHud();
      return;
    }
    this.meta.ensureMissions();
    this.refreshCoinHud();
    const m = this.meta.metaState;

    // Шапка: монеты + звёзды.
    this.el('metaCoins').textContent = String(this.economy.getCoins());
    this.el('metaStars').textContent = String(m.totalStars);

    // --- Карта ---
    let mh = '';
    for (const node of MAP_NODES) {
      const st = this.meta.nodeState(node);
      const cls = 'mapNode ' + st + (node.boss ? ' boss' : '');
      mh +=
        '<div class="' + cls + '">' +
        '<div class="mnHead"><b>Узел ' + node.id + (node.boss ? ' · Босс' : '') + '</b>' +
        '<span class="mnReq">' + node.stars + '★</span></div>' +
        '<div class="mnRew">' + this.rewardText(node.reward) + '</div>';
      if (st === 'ready') {
        mh += '<button type="button" class="mnClaim" data-node="' + node.id + '">Забрать</button>';
      } else if (st === 'claimed') {
        mh += '<div class="mnDone">✓ получено</div>';
      } else {
        mh += '<div class="mnLock">🔒 нужно ' + node.stars + '★</div>';
      }
      mh += '</div>';
    }
    this.el('mapList').innerHTML = mh;

    // --- Магазин бустеров ---
    let sh = '';
    for (const id of ECON.BOOSTER_ORDER) {
      const def = ECON.BOOSTERS[id];
      sh +=
        '<div class="shopItem">' +
        '<span class="siEmoji">' + def.emoji + '</span>' +
        '<div class="siInfo"><b>' + def.name + '</b><span>' + def.hint + '</span></div>' +
        '<span class="siOwned">в наличии: ' + this.economy.getBooster(id) + '</span>' +
        '<button type="button" class="siBuy" data-buy="' + id + '">' + def.price + '🪙</button>' +
        '</div>';
    }
    this.el('shopList').innerHTML = sh;

    // --- Миссии дня ---
    let xh = '';
    for (const mid of m.missions.set) {
      const def = missionDef(mid);
      if (!def) continue;
      const prog = Math.min(m.missions.progress[mid] ?? 0, def.target);
      const done = m.missions.done.indexOf(mid) !== -1;
      const pct = Math.round((prog / def.target) * 100);
      xh +=
        '<div class="mission' + (done ? ' done' : '') + '">' +
        '<div class="msTop"><span>' + def.text + '</span><b>+' + def.reward + '🪙</b></div>' +
        '<div class="msBar"><div class="msFill" style="width:' + pct + '%"></div></div>' +
        '<div class="msProg">' + (done ? '✓ выполнено' : prog + ' / ' + def.target) + '</div>' +
        '</div>';
    }
    const allDone = m.missions.done.length >= m.missions.set.length;
    xh +=
      '<div class="missionBonus' + (allDone ? ' done' : '') + '">Все 3 миссии → бонус-сундук +' +
      MISSION_BONUS + '🪙 ' + (allDone ? '✓' : '') + '</div>';
    this.el('missionList').innerHTML = xh;

    // --- Стрик дней ---
    let kh = '';
    for (let k = 0; k < 7; k++) {
      const rw = STREAK_REWARDS[k];
      const reached = m.streak.day >= k + 1 && m.streak.lastClaim !== '';
      const isToday = m.streak.day === k + 1 && !this.meta.streakClaimable();
      const cls = 'streakDay' + (reached ? ' reached' : '') + (isToday ? ' current' : '');
      const label = (rw.coins ? rw.coins + '🪙' : '') + (rw.booster ? ' 🔨' : '');
      kh +=
        '<div class="' + cls + '"><span class="sdNum">Д' + (k + 1) + '</span>' +
        '<span class="sdRew">' + label + '</span></div>';
    }
    this.el('streakRow').innerHTML = kh;
    this.el('streakCount').textContent = 'Серия: ' + m.streak.count + ' дн.';
    const claimBtn = this.el('streakClaimBtn') as HTMLButtonElement;
    claimBtn.disabled = !this.meta.streakClaimable();
    claimBtn.textContent = this.meta.streakClaimable()
      ? 'Получить награду дня'
      : 'Награда дня получена';

    // --- Rewarded-панель (Проход Е.2) ---
    const adSection = this.el('adSection');
    if (this.adPanel === null) {
      adSection.classList.add('hidden');
    } else {
      adSection.classList.remove('hidden');
      this.el('metaAdStatus').textContent = this.adPanel.statusLine();
      (this.el('rwBoosterBtn') as HTMLButtonElement).disabled = !this.adPanel.rw3Enabled();
      (this.el('rwStreakBtn') as HTMLButtonElement).disabled = !this.adPanel.rw4Enabled();
    }
  }
}
