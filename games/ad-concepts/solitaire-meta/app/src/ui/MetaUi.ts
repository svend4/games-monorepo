/**
 * Мета-экран (порт UI-части prototype/meta.js 1:1): вкладки Сад / Задания /
 * Лавка, зоны с эмодзи-сценами, стрик-полоса, миссии, лавка бустеров и панель
 * «План экономики» (05 §5.4). DOM-контейнеры и стили — index.html/style.css
 * прототипа; класс только наполняет их и слушает клики ДЕЛЕГИРОВАНИЕМ —
 * обработчики переживают перерисовку без «повисших» слушателей.
 * Логика (заказы/стрик/миссии) — в meta/meta.ts; здесь только рендер.
 */
import { ECON, type MissionDef } from '../economy/econ';
import type { Economy } from '../economy/economy';
import { Meta, streakRewardFor } from '../meta/meta';
import { TOTAL_ORDERS, ZONES } from '../meta/config';

export type MetaTab = 'garden' | 'tasks' | 'shop';

export class MetaUi {
  /** Возврат в игру (TableUi обновляет HUD, как Game.syncHud в прототипе). */
  onClose: (() => void) | null = null;

  private tab: MetaTab = 'garden';
  private elScreen!: HTMLElement;
  private elBody!: HTMLElement;
  private elCoins!: HTMLElement;
  private elHarvest!: HTMLElement;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly economy: Economy,
    private readonly meta: Meta
  ) {}

  /* ============================ ИНИЦИАЛИЗАЦИЯ ============================ */

  init(): void {
    this.elScreen = this.mustGet('meta-screen');
    this.elBody = this.mustGet('meta-body');
    this.elCoins = this.mustGet('meta-coins');
    this.elHarvest = this.mustGet('meta-harvest');

    this.meta.refreshMissions();
    this.economy.subscribe(() => {
      if (this.isOpen()) this.syncBalances();
    });
    this.meta.onMissionsChanged = () => {
      if (this.isOpen() && this.tab === 'tasks') this.render();
    };

    // Навигация по вкладкам.
    this.mustGet('meta-tabs').addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest('button[data-tab]');
      if (b !== null) this.setTab(b.getAttribute('data-tab') as MetaTab);
    });

    // Кнопка «← Играть».
    this.mustGet('meta-back').addEventListener('click', () => this.close());

    // Делегированные действия внутри тела экрана.
    this.elBody.addEventListener('click', (ev) => this.onBodyClick(ev));
  }

  private mustGet(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (el === null) throw new Error('MetaUi: нет контейнера #' + id);
    return el;
  }

  private onBodyClick(ev: Event): void {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
    if (b === null || b.disabled) return;
    const act = b.getAttribute('data-action');
    if (act === 'order') {
      const res = this.meta.completeActiveOrder();
      if (res !== null) {
        this.render();
        this.flashToast(
          res.zoneCompleted !== null
            ? '🎉 Зона «' + res.zoneCompleted.name + '» готова! +💰 ' + res.zoneCompleted.bonus
            : 'Заказ выполнен! Сад подрос.'
        );
      }
    } else if (act === 'buy') {
      const id = b.getAttribute('data-id');
      if (id === 'joker' || id === 'basket') {
        if (this.economy.buyBooster(id)) {
          this.render();
          this.flashToast('Куплено: ' + ECON.BOOSTERS[id].name);
        }
      }
    } else if (act === 'claim-mission') {
      const id = b.getAttribute('data-id') ?? '';
      if (this.meta.claimMission(id)) {
        this.render();
        this.flashToast('Награда за миссию получена!');
      }
    } else if (act === 'claim-streak') {
      if (this.meta.claimStreak()) {
        this.render();
        this.flashToast('Стрик засчитан! Лейка полна.');
      }
    } else if (act === 'newday') {
      this.meta.newDay();
      this.render();
      this.flashToast('Наступил новый день (тест).');
    }
  }

  /* ============================ ЭКРАН ============================ */

  isOpen(): boolean {
    return !this.elScreen.classList.contains('hidden');
  }

  open(startTab: MetaTab = 'garden'): void {
    this.meta.refreshMissions();
    this.tab = startTab;
    this.elScreen.classList.remove('hidden');
    document.body.classList.add('meta-open');
    this.setActiveTabButton();
    this.render();
  }

  close(): void {
    this.elScreen.classList.add('hidden');
    document.body.classList.remove('meta-open');
    this.onClose?.();
  }

  private setTab(name: MetaTab): void {
    this.tab = name;
    this.setActiveTabButton();
    this.render();
  }

  private setActiveTabButton(): void {
    const btns = document.querySelectorAll('#meta-tabs button');
    btns.forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === this.tab));
  }

  private syncBalances(): void {
    this.elCoins.textContent = this.economy.fmt(this.economy.getCoins());
    this.elHarvest.textContent = this.economy.fmt(this.economy.getHarvest());
  }

  /** Экранирование (заголовки заказов статичны, но на всякий — как в прототипе). */
  private esc(s: string): string {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
  }

  render(): void {
    this.syncBalances();
    if (this.tab === 'garden') this.elBody.innerHTML = this.renderGarden();
    else if (this.tab === 'tasks') this.elBody.innerHTML = this.renderTasks();
    else this.elBody.innerHTML = this.renderShop();
    this.elBody.scrollTop = 0;
  }

  /* ---------- Вкладка «Сад»: зоны, сцены, заказы ---------- */

  private renderGarden(): string {
    const done = this.meta.gardenCompleted();
    const curZone = this.meta.currentZoneIdx();
    let html = '';

    if (done >= TOTAL_ORDERS) {
      html +=
        '<div class="meta-hero">🎉 Весь сад расцвёл!</div>' +
        '<p class="meta-sub">Вы прошли все зоны прототипа. В полной игре — 12 зон и 240 уровней.</p>';
    } else {
      html +=
        '<p class="meta-sub">Заказы тратят 🍎 урожай (и иногда 💰 монеты), продвигают зону и открывают новую цель. ' +
        'Не хватает урожая — сыграйте ещё раздачу.</p>';
    }

    for (let zi = 0; zi <= Math.min(curZone, ZONES.length - 1); zi++) {
      html += this.renderZone(zi);
    }
    // Тизер следующей запертой зоны.
    if (curZone + 1 < ZONES.length && done < TOTAL_ORDERS) {
      const nz = ZONES[curZone + 1];
      html +=
        '<div class="zone locked"><div class="zone-head"><span class="zone-emoji">🔒</span>' +
        '<span class="zone-name">' + this.esc(nz.name) + '</span></div>' +
        '<div class="zone-teaser">Откроется, когда закончите «' + this.esc(ZONES[curZone].name) + '»</div></div>';
    }
    return html;
  }

  private renderZone(zi: number): string {
    const z = ZONES[zi];
    const done = this.meta.gardenCompleted();
    const doneInZone = Math.max(0, Math.min(z.orders.length, done - z.startIndex));
    const pct = Math.round((doneInZone / z.orders.length) * 100);

    let scene = '';
    for (let i = 0; i < z.orders.length; i++) {
      scene +=
        '<span class="decor ' + (i < doneInZone ? 'on' : 'off') + '">' +
        (i < doneInZone ? z.orders[i].decor : '·') + '</span>';
    }

    let html = '<div class="zone">';
    html +=
      '<div class="zone-head"><span class="zone-emoji">' + z.emoji + '</span>' +
      '<span class="zone-name">' + this.esc(z.name) + '</span>' +
      '<span class="zone-pct">' + pct + '%</span></div>';
    html += '<div class="zone-scene" title="' + this.esc(z.scene) + '">' + scene + '</div>';
    html += '<div class="zone-bar"><div class="zone-fill" style="width:' + pct + '%"></div></div>';

    // Активный заказ этой зоны (если он тут).
    const ao = this.meta.activeOrder();
    if (ao !== null && ao.zoneIdx === zi) {
      const o = ao.order;
      const okH = this.economy.getHarvest() >= o.costH;
      const okC = this.economy.getCoins() >= o.costC;
      const can = okH && okC;
      html += '<div class="order active">';
      html += '<div class="order-title">📋 ' + this.esc(o.title) + ' ' + o.decor + '</div>';
      html +=
        '<div class="order-cost">Нужно: ' +
        '<b class="' + (okH ? '' : 'lack') + '">🍎 ' + o.costH + '</b>' +
        (o.costC > 0 ? ' + <b class="' + (okC ? '' : 'lack') + '">💰 ' + o.costC + '</b>' : '') +
        ' → награда <b>💰 ' + o.rc + '</b></div>';
      html +=
        '<button class="order-btn" data-action="order" ' + (can ? '' : 'disabled') + '>' +
        (can ? 'Выполнить заказ' : okH ? 'Не хватает монет' : 'Не хватает урожая') + '</button>';
      html += '</div>';
    } else if (done >= z.endIndex) {
      html += '<div class="order zone-done">✓ Зона готова — сад благодарит вас!</div>';
    }
    html += '</div>';
    return html;
  }

  /* ---------- Вкладка «Задания»: стрик + миссии ---------- */

  private renderTasks(): string {
    let html = '';
    // Стрик.
    const s = this.meta.streakStatus();
    const rw = streakRewardFor(s.day);
    html += '<div class="card-panel">';
    html += '<div class="panel-title">🌅 Утренняя лейка — стрик</div>';
    html += '<div class="streak-row">';
    for (let d = 1; d <= 7; d++) {
      const isNow = s.claimable && d === s.day;
      const isPast = (!s.claimable && d <= s.day) || (s.claimable && d < s.day);
      const cls = 'streak-day' + (isPast ? ' past' : '') + (isNow ? ' now' : '');
      html +=
        '<div class="' + cls + '"><div class="sd-n">' + (d === 7 ? '7+' : d) + '</div>' +
        '<div class="sd-r">' + streakRewardFor(d).coins + '</div></div>';
    }
    html += '</div>';
    if (s.claimable) {
      const extra = (rw.undo ? ' +↩' : '') + (rw.joker ? ' +🃏' : '') + (rw.basket ? ' +🧺' : '');
      html +=
        '<button class="claim-btn" data-action="claim-streak">Забрать день ' + s.day +
        ': 💰 ' + rw.coins + extra + '</button>';
    } else {
      html += '<div class="claimed-note">Награда дня забрана. Возвращайтесь завтра — стрик продолжится.</div>';
    }
    html += '</div>';

    // Миссии — дневные и недельная.
    html += this.renderMissionGroup('Дневные миссии', ECON.DAILY_MISSIONS);
    html += this.renderMissionGroup('Миссия недели', ECON.WEEKLY_MISSIONS);

    // Тест-кнопка виртуального дня.
    html +=
      '<div class="card-panel test-panel">' +
      '<div class="panel-title">🧪 Проверка петли</div>' +
      '<div class="claimed-note">Сдвиньте «сегодня» на день вперёд, чтобы увидеть стрик и сброс миссий.</div>' +
      '<button class="ghost-btn" data-action="newday">Новый день (тест)</button></div>';
    return html;
  }

  private renderMissionGroup(title: string, defs: readonly MissionDef[]): string {
    let html = '<div class="card-panel"><div class="panel-title">🎯 ' + title + '</div>';
    for (const def of defs) {
      const prog = Math.min(def.target, this.meta.missionProgress(def.id));
      const pct = Math.round((prog / def.target) * 100);
      const claimed = this.meta.missionClaimed(def.id);
      const ready = prog >= def.target && !claimed;
      html += '<div class="mission">';
      html += '<div class="mission-text">' + this.esc(def.text) + '</div>';
      html +=
        '<div class="mission-bar"><div class="mission-fill" style="width:' + pct + '%"></div>' +
        '<span class="mission-frac">' + prog + '/' + def.target + '</span></div>';
      if (claimed) {
        html += '<div class="mission-reward done">✓ Забрано (💰 ' + def.coins + ')</div>';
      } else if (ready) {
        html +=
          '<button class="claim-btn small" data-action="claim-mission" data-id="' + def.id + '">' +
          'Забрать 💰 ' + def.coins + (def.card === true ? ' + карточка' : '') + '</button>';
      } else {
        html +=
          '<div class="mission-reward">Награда: 💰 ' + def.coins +
          (def.card === true ? ' + карточка' : '') + '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  /* ---------- Вкладка «Лавка»: бустеры + план экономики ---------- */

  private renderShop(): string {
    let html = '<p class="meta-sub">Бустеры покупаются за монеты и помогают в раскладах (05 §5.6).</p>';
    for (const id of ECON.BOOSTER_ORDER) {
      const def = ECON.BOOSTERS[id];
      const owned = this.economy.getBooster(id);
      const full = owned >= def.cap;
      const afford = this.economy.getCoins() >= def.price;
      html += '<div class="shop-item">';
      html += '<div class="shop-emoji">' + def.emoji + '</div>';
      html +=
        '<div class="shop-info"><div class="shop-name">' + this.esc(def.name) +
        ' <span class="owned">×' + owned + '</span></div>' +
        '<div class="shop-hint">' + this.esc(def.hint) + '</div></div>';
      html +=
        '<button class="buy-btn" data-action="buy" data-id="' + id + '" ' +
        (full || !afford ? 'disabled' : '') + '>' +
        (full ? 'Максимум' : '💰 ' + def.price) + '</button>';
      html += '</div>';
    }
    html +=
      '<div class="shop-item info-item"><div class="shop-emoji">↩</div>' +
      '<div class="shop-info"><div class="shop-name">Отмена хода</div>' +
      '<div class="shop-hint">Бесплатных: ' + this.economy.getFreeUndos() +
      '. Далее — 💰 ' + ECON.UNDO_PRICE + ' за отмену прямо в раздаче.</div></div></div>';

    html += this.renderEconomyPlan();
    return html;
  }

  /** Панель «План экономики» — переход профицит→дефицит (05 §5.4) и полоса игрока. */
  private renderEconomyPlan(): string {
    const n = this.economy.getLevel();
    const e = this.economy.entryCost(n);
    const w = this.economy.winReward(n);
    const m = this.economy.winMult(n);
    const plan = ECON.PLAN_5_4;
    // Ближайшая по уровню строка плана.
    let nearest = 0;
    let bestD = Infinity;
    for (let i = 0; i < plan.length; i++) {
      const d = Math.abs(plan[i].level - n);
      if (d < bestD) {
        bestD = d;
        nearest = i;
      }
    }
    let html = '<div class="card-panel plan-panel">';
    html += '<div class="panel-title">📊 Экономика: где вы на кривой</div>';
    html +=
      '<div class="plan-now">Уровень <b>' + n + '</b> · взнос <b>💰 ' + this.economy.fmt(e) +
      '</b> · выигрыш <b>💰 ' + this.economy.fmt(w) + '</b> · множитель <b>×' + m.toFixed(2) + '</b></div>';
    html +=
      '<div class="plan-note">Спроектированный путь баланса медианного игрока (05 §5.4): ' +
      'дни 1–4 — профицит («медовый месяц»), день 5+ — плановое сползание в дефицит, ' +
      'день 12–16 — точка первого денежного решения.</div>';
    html +=
      '<div class="plan-table-wrap"><table class="plan-table"><thead><tr>' +
      '<th>День</th><th>Ур.</th><th>Сальдо/день</th><th>Баланс</th></tr></thead><tbody>';
    for (let j = 0; j < plan.length; j++) {
      const row = plan[j];
      const pos = row.saldo >= 0;
      html +=
        '<tr class="' + (j === nearest ? 'plan-here' : '') + '">' +
        '<td>' + row.day + '</td><td>' + row.level + '</td>' +
        '<td class="' + (pos ? 'pos' : 'neg') + '">' + (pos ? '+' : '') + this.economy.fmt(row.saldo) + '</td>' +
        '<td>' + this.economy.fmt(row.balance) + '</td></tr>';
    }
    html += '</tbody></table></div>';
    html += '<div class="plan-note">▲ строка ближе всего к вашему уровню (' + this.esc(plan[nearest].note) + ').</div>';
    html += '</div>';
    return html;
  }

  /* ---------- Тост поверх мета-экрана ---------- */

  flashToast(msg: string): void {
    const t = document.getElementById('meta-toast');
    if (t === null) return;
    t.textContent = msg;
    t.classList.add('show');
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }
}
