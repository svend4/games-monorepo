/**
 * ВНУТРЕННИЙ ИНСТРУМЕНТ, НЕ ДЛЯ ИГРОКОВ (Проход Ж.1): кокпит — рабочее место
 * прод-команды, поэтому он СОЗНАТЕЛЬНО остаётся русским и НЕ переведён через
 * i18n (t()). Игровой UI локализован отдельно (src/i18n).
 *
 * Soft-launch кокпит 🚀 (Проход Е.3) — DOM-оверлей, порт UI-части
 * experiments.js (Проход Г) 1:1. Три вкладки:
 *   1) СИМУЛЯТОР   — прогон когорты (кап N ~400 в браузере, < 1 c) с рендером
 *                    монетного контура по дням, точки «Кошелька» и гейтов
 *                    К1–К8 (§12.6);
 *   2) A/B + ТЮНИНГ— детерминированное назначение варианта по хешу session-id
 *                    ([09] §9.6); панель ручек с сохранением в localStorage и
 *                    сбросом «к значениям книги»;
 *   3) ГЕЙТЫ       — вердикт go/iterate/kill по трём сценариям [09] §9.5.
 *
 * Вся математика — в Experiments/src/sim; кокпит только рендерит и слушает.
 * В игру не вмешивается: пишет только ключи orchardPeaks.tuning/abSession/
 * softScen (те же, что у прототипа).
 */
import {
  EXPERIMENTS,
  KNOBS,
  SCENARIOS,
  SCENARIO_IDS,
  activeDays,
  bFromRet,
  ltv,
  paybackDay,
  type Experiments,
  type KnobKey,
  type ScenarioId
} from '../experiments/experiments';
import { checkGates, type SimRunResult } from '../sim/sim';

type Tab = 'sim' | 'ab' | 'gates';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

function fin(v: number, d: number): number {
  return isFinite(v) ? v : d;
}

function usd(v: number): string {
  return '$' + (Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4));
}

function pct(v: number): string {
  return (v * 100).toFixed(0) + '%';
}

function fmtCoins(n: number): string {
  n = Math.round(n);
  const s = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a < 10000) return s + a;
  if (a < 1000000) return s + (a / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return s + (a / 1000000).toFixed(2) + 'M';
}

interface GateItem {
  status: string;
  id?: string;
  name: string;
  target: string;
  fact: string;
}

export class CockpitUi {
  /** Возврат в игру. */
  onClose: (() => void) | null = null;

  private screenEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private tab: Tab = 'sim';
  private simN = 300;
  private simSeed = 1000;

  constructor(private readonly experiments: Experiments) {}

  /* ============================ DOM ============================ */

  mount(): void {
    if (this.screenEl !== null || typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.id = 'soft-screen';
    el.className = 'hidden';
    el.innerHTML =
      '<header id="soft-top">' +
      '<button id="soft-back" type="button">← Играть</button>' +
      '<div class="soft-title">🚀 Soft Launch · Проход Е.3</div>' +
      '<div class="soft-sid" id="soft-sid"></div>' +
      '</header>' +
      '<nav id="soft-tabs">' +
      '<button data-t="sim" class="active" type="button">🧮 Симулятор</button>' +
      '<button data-t="ab" type="button">🧪 A/B + тюнинг</button>' +
      '<button data-t="gates" type="button">🚦 Гейты go/no-go</button>' +
      '</nav>' +
      '<main id="soft-body"></main>';
    document.body.appendChild(el);
    this.screenEl = el;
    this.bodyEl = document.getElementById('soft-body');

    const back = document.getElementById('soft-back');
    if (back !== null) back.addEventListener('click', () => this.close());
    const tabs = document.getElementById('soft-tabs');
    if (tabs !== null) {
      tabs.addEventListener('click', (ev) => {
        const b = (ev.target as HTMLElement).closest('button[data-t]');
        if (b !== null) this.setTab(b.getAttribute('data-t') as Tab);
      });
    }
    this.bodyEl?.addEventListener('click', (ev) => this.onBodyClick(ev));
    this.experiments.getSessionId(); // гарантируем session-id при первом заходе
  }

  private setTab(name: Tab): void {
    this.tab = name;
    const btns = document.querySelectorAll('#soft-tabs button');
    btns.forEach((b) => b.classList.toggle('active', b.getAttribute('data-t') === this.tab));
    this.render();
  }

  isOpen(): boolean {
    return this.screenEl !== null && !this.screenEl.classList.contains('hidden');
  }

  open(): void {
    this.mount();
    if (this.screenEl === null) return;
    this.screenEl.classList.remove('hidden');
    document.body.classList.add('meta-open');
    this.render();
  }

  close(): void {
    if (this.screenEl === null) return;
    this.screenEl.classList.add('hidden');
    document.body.classList.remove('meta-open');
    this.onClose?.();
  }

  /* ============================ СОБЫТИЯ ============================ */

  private onBodyClick(ev: Event): void {
    const b = (ev.target as HTMLElement).closest('[data-act]');
    if (b === null) return;
    const act = b.getAttribute('data-act');

    if (act === 'run-sim' || act === 'run-gates') {
      const nEl = document.getElementById('sim-n') as HTMLInputElement | null;
      const sEl = document.getElementById('sim-seed') as HTMLInputElement | null;
      if (nEl !== null) this.simN = Math.max(50, Math.min(400, Math.round(fin(parseFloat(nEl.value), 300))));
      if (sEl !== null) this.simSeed = Math.round(fin(parseFloat(sEl.value), 1000));
      this.experiments.runSim(this.simN, this.simSeed);
      this.render();
    } else if (act === 'tune-save') {
      this.saveKnobsFromDom();
      this.render();
    } else if (act === 'tune-reset') {
      this.experiments.resetTuning();
      this.render();
    } else if (act === 'ab-apply-sid') {
      const el = document.getElementById('ab-sid') as HTMLInputElement | null;
      if (el !== null && el.value.trim() !== '') {
        this.experiments.setSessionId(el.value.trim());
        this.render();
      }
    } else if (act === 'ab-new-sid') {
      this.experiments.newSessionId();
      this.render();
    } else if (act === 'scen') {
      const id = b.getAttribute('data-scen');
      if (id !== null && (SCENARIO_IDS as readonly string[]).includes(id)) {
        this.experiments.setScenario(id as ScenarioId);
        this.render();
      }
    } else if (act === 'cycles') {
      this.experiments.setCycles(parseInt(b.getAttribute('data-cy') ?? '0', 10));
      this.render();
    }
  }

  /** Сбор значений ручек из DOM (порт saveKnobsFromDom прототипа). */
  private saveKnobsFromDom(): void {
    const values: Partial<Record<KnobKey, number>> = {};
    const inputs = document.querySelectorAll<HTMLInputElement>('.knob-inp');
    inputs.forEach((inp) => {
      const key = inp.getAttribute('data-knob') as KnobKey | null;
      if (key === null) return;
      const v = parseFloat(inp.value);
      if (isFinite(v)) values[key] = v;
    });
    this.experiments.saveTuning(values);
  }

  /* ============================ РЕНДЕР ============================ */

  private render(): void {
    const sidEl = document.getElementById('soft-sid');
    if (sidEl !== null) sidEl.innerHTML = '🆔 ' + esc(this.experiments.getSessionId());
    if (this.bodyEl === null) return;
    if (this.tab === 'sim') this.bodyEl.innerHTML = this.renderSimTab();
    else if (this.tab === 'ab') this.bodyEl.innerHTML = this.renderAbTab();
    else this.bodyEl.innerHTML = this.renderGatesTab();
    this.bodyEl.scrollTop = 0;
  }

  /* ---------------------------- ВКЛАДКА: СИМУЛЯТОР ---------------------------- */

  private renderSimTab(): string {
    let html = '';
    html +=
      '<div class="sim-banner">🧮 Детерминированный симулятор экономики (приложение 12): ' +
      'N игроков × 30 дней монетного контура. Тот же seed → тот же результат бит-в-бит (I-E1). ' +
      'Запускается и здесь, и headless (<code>npm run sim -- [seed] [N]</code>).</div>';

    html += '<div class="soft-ctrl">';
    html +=
      '<div class="ctrl-group"><span class="ctrl-lab">👥 Игроков N:</span>' +
      '<input id="sim-n" class="soft-num" type="number" min="50" max="400" step="50" value="' + this.simN + '"> ' +
      '<span class="dash-small">(кап 400 — прогон &lt; 1 c)</span></div>';
    html +=
      '<div class="ctrl-group"><span class="ctrl-lab">🌱 Seed:</span>' +
      '<input id="sim-seed" class="soft-num" type="number" step="1" value="' + this.simSeed + '"></div>';
    html += '<div class="ctrl-group"><button class="soft-run" data-act="run-sim">▶ Прогнать когорту</button></div>';
    html += '</div>';

    html += this.renderActiveOverrides();

    const r = this.experiments.lastRun;
    if (r === null) {
      html +=
        '<div class="soft-card"><p class="dash-note">Нажмите «▶ Прогнать когорту» — появятся монетный контур по дням, ' +
        'точка «Кошелька» и контрольные точки К1–К8.</p></div>';
      return html;
    }

    // Крупные плитки итога.
    html += '<div class="dash-tiles">';
    html += this.tile(r.wallet.inWindow ? 'sum' : 'warn', 'Точка «Кошелька»', 'день ' + r.wallet.median, r.wallet.inWindow ? 'в окне 12–16 ✓' : 'вне окна 12–16');
    html += this.tile('ad', 'Пик баланса', 'день ' + r.peak.day, fmtCoins(r.peak.balance) + ' монет');
    html += this.tile(r.sinkSourceD14 >= 1.05 && r.sinkSourceD14 <= 1.15 ? 'sum' : 'warn', 'Sink/Source D14+', r.sinkSourceD14.toFixed(2), 'коридор 1.05–1.15');
    html += this.tile('iap', 'Ad-ARPDAU (сим)', usd(r.ad.adArpdau), r.ad.rewardedPerDau.toFixed(1) + ' rw + ' + r.ad.intPerDau.toFixed(1) + ' int /DAU');
    html += '</div>';

    html += this.renderBalanceChart(r);

    // Таблица монетного контура.
    html += '<div class="soft-card"><div class="dash-h">💰 Монетный контур по дням (медианы когорты)</div>';
    html +=
      '<div class="kpi-table-wrap"><table class="kpi-table"><thead><tr>' +
      '<th>День</th><th>Ур.</th><th>Баланс</th><th>Сальдо/день</th><th>Бал/E</th><th>Взнос E(n)</th></tr></thead><tbody>';
    const show: Record<number, boolean> = { 1: true, 2: true, 3: true, 4: true, 5: true, 7: true, 10: true, 12: true, 14: true, 16: true, 21: true, 30: true };
    for (const d of r.byDay) {
      if (show[d.day] !== true) continue;
      const win = d.day >= 12 && d.day <= 16;
      html +=
        '<tr' + (win ? ' class="wallet-win"' : '') + '><td>' + d.day + (win ? ' 🎯' : '') + '</td><td>' + d.medLevel + '</td>' +
        '<td class="kpi-fact">' + fmtCoins(d.medBalance) + '</td>' +
        '<td class="kpi-fact ' + (d.medSaldo >= 0 ? 'pos' : 'neg') + '">' + (d.medSaldo >= 0 ? '+' : '') + fmtCoins(d.medSaldo) + '</td>' +
        '<td class="kpi-fact">' + d.balInEntries.toFixed(1) + '</td><td class="kpi-tgt">' + fmtCoins(d.entry) + '</td></tr>';
    }
    html += '</tbody></table></div>';
    html +=
      '<p class="dash-small">🎯 окно дня 12–16 — плановое первое денежное решение ([05] §5.4/§5.7). ' +
      'Сад: заказов/день <b>' + r.garden.ordersPerDay.toFixed(2) + '</b> · зона 1 к D7 у <b>' + pct(r.garden.zone1ByD7Pct) +
      '</b> когорты · реализация урожая <b>' + pct(r.harvestRealization) + '</b> номинала.</p>';
    html += '</div>';

    html += this.renderGateChecks(r);

    html +=
      '<p class="dash-foot">Прогон N=' + r.meta.N + ' · seed=' + r.meta.seed +
      (this.experiments.lastElapsedMs > 0 ? ' · ' + Math.round(this.experiments.lastElapsedMs) + ' мс' : '') +
      ' · приложение 12 (§12.3 монетный контур, §12.6 валидация).</p>';
    return html;
  }

  private renderActiveOverrides(): string {
    const over = this.experiments.effectiveParams(true);
    const keys = Object.keys(over) as KnobKey[];
    if (keys.length === 0) return '<div class="soft-note">Активны параметры книги (без A/B-патча и тюнинга).</div>';
    const chips = keys.map((k) => {
      const src = this.experiments.overrideSource(k);
      const v = (over as Record<string, number>)[k];
      return '<span class="ov-chip ' + (src === 'тюнинг' ? 'tune' : 'ab') + '">' + esc(k) + ' = ' + v + ' <i>(' + src + ')</i></span>';
    });
    return '<div class="soft-note"><b>Активные оверрайды:</b> ' + chips.join(' ') + '</div>';
  }

  private renderGateChecks(r: SimRunResult): string {
    const gates = checkGates(r);
    let passed = 0;
    const items: GateItem[] = [];
    for (const g of gates) {
      if (g.ok) passed++;
      items.push({ status: g.ok ? 'ok' : 'bad', id: g.id, name: g.name, target: g.target, fact: g.fact });
    }
    let html = '<div class="soft-card"><div class="dash-h">✅ Контрольные точки приёмки К1–К8 (§12.6)</div>';
    html += this.gateList(items);
    html +=
      '<p class="dash-small">Пройдено <b>' + passed + '/' + gates.length + '</b>. ' +
      'К7 (высота карусели) и К8 (заказы) — известные находки Ф2/Ф4 приложения 12: их адресует тюнинг ' +
      '(миссии −15% ⇒ К7, стоимость заказов −20% ⇒ К8). Меняйте ручки во вкладке «A/B + тюнинг» и прогоняйте снова.</p>';
    html += '</div>';
    return html;
  }

  /** Список гейтов — устойчивый к узкому экрану (порт gateList). */
  private gateList(items: GateItem[]): string {
    let h = '<div class="gate-list">';
    for (const g of items) {
      h +=
        '<div class="gate-row ' + g.status + '">' +
        '<div class="gate-dot"></div>' +
        '<div class="gate-main"><div class="gate-name">' + (g.id !== undefined ? '<b>' + esc(g.id) + '</b> ' : '') + esc(g.name) + '</div>' +
        '<div class="gate-tgt">цель: ' + esc(g.target) + '</div></div>' +
        '<div class="gate-fact">' + esc(g.fact) + '</div></div>';
    }
    return h + '</div>';
  }

  /** График медианного баланса по дням (порт renderBalanceChart). */
  private renderBalanceChart(r: SimRunResult): string {
    let maxBal = 1;
    for (const d of r.byDay) maxBal = Math.max(maxBal, d.medBalance);
    let bars = '';
    for (const d of r.byDay) {
      const h = Math.max(2, Math.round((d.medBalance / maxBal) * 150));
      const win = d.day >= 12 && d.day <= 16;
      const cls = 'bal-bar' + (d.medSaldo >= 0 ? ' up' : ' down') + (win ? ' win' : '') + (d.day === r.wallet.median ? ' wp' : '');
      const lab = d.day === 1 || d.day % 5 === 0 || d.day === r.wallet.median ? String(d.day) : '';
      bars +=
        '<div class="bal-col" title="день ' + d.day + ': ' + fmtCoins(d.medBalance) + ' (' + (d.medSaldo >= 0 ? '+' : '') + fmtCoins(d.medSaldo) + '/день)">' +
        '<div class="' + cls + '" style="height:' + h + 'px"></div>' +
        '<div class="bal-lab">' + lab + '</div></div>';
    }
    return (
      '<div class="soft-card"><div class="dash-h">📉 Медианный баланс монет по дням (профицит → дефицит)</div>' +
      '<div class="bal-chart-wrap"><div class="bal-chart">' + bars + '</div></div>' +
      '<div class="chart-legend"><span class="lg up">▮ профицит дня</span>' +
      '<span class="lg down">▮ дефицит дня</span>' +
      '<span class="lg win">▮ окно «Кошелька» 12–16</span>' +
      '<span class="lg wp">▮ медианная точка «Кошелька» (день ' + r.wallet.median + ')</span></div></div>'
    );
  }

  /* ---------------------------- ВКЛАДКА: A/B + ТЮНИНГ ---------------------------- */

  private renderAbTab(): string {
    const sid = this.experiments.getSessionId();
    const a = this.experiments.currentAssignment();
    let html = '';

    html += '<div class="soft-card"><div class="dash-h">🧪 A/B: назначение по хешу session-id ([09] §9.6)</div>';
    html +=
      '<p class="dash-small">Вариант выбирается детерминированно: <code>arm = hash(session-id + «:» + эксперимент) mod число_арм</code>. ' +
      'Один игрок — стабильно один вариант; вариант виден в дашборде. Не более 3 непересекающихся тестов ([09] §9.6).</p>';
    html +=
      '<div class="ctrl-group"><span class="ctrl-lab">🆔 session-id:</span>' +
      '<input id="ab-sid" class="soft-num wide" type="text" value="' + esc(sid) + '">' +
      '<button class="ctrl-btn" data-act="ab-apply-sid">Применить</button>' +
      '<button class="ctrl-btn" data-act="ab-new-sid">🎲 Новый</button></div>';
    html += '<div class="kpi-table-wrap"><table class="kpi-table"><thead><tr><th>Эксперимент</th><th>Армы</th><th>Назначен</th><th>Метрика / гардрейл</th></tr></thead><tbody>';
    for (const exp of EXPERIMENTS) {
      const asn = a.arms[exp.key];
      const arms = exp.arms
        .map((arm, idx) => '<span class="arm-chip' + (idx === asn.idx ? ' on' : '') + '">' + esc(arm.label) + '</span>')
        .join(' ');
      html +=
        '<tr><td><b>' + esc(exp.name) + '</b><br><span class="dash-small">' + esc(exp.ref) + '</span></td>' +
        '<td>' + arms + '</td><td class="kpi-fact">' + esc(asn.arm.label) + '</td>' +
        '<td class="dash-small">' + esc(exp.metric) + '<br>гардрейл: ' + esc(exp.guard) + '</td></tr>';
    }
    html += '</tbody></table></div>';
    html += '<p class="dash-small">Патч выбранного варианта накладывается на прогон симулятора и гейтов (ручной тюнинг ниже — побеждает).</p>';
    html += '</div>';

    // Тюнинг-панель.
    html += '<div class="soft-card"><div class="dash-h">🎛 Панель тюнинга (remote config)</div>';
    html +=
      '<p class="dash-small">Ручки сохраняются в localStorage (префикс <code>orchardPeaks.</code>) и переопределяют книгу и A/B. ' +
      'Кнопка «сброс к книге» возвращает значения приложения 12 / глав 05–06.</p>';
    html += '<div class="knob-grid">';
    for (const kn of KNOBS) {
      const bookV = this.experiments.bookValue(kn.key);
      const curV = this.experiments.knobValue(kn.key);
      const changed = this.experiments.isKnobEdited(kn.key);
      html +=
        '<div class="knob' + (changed ? ' changed' : '') + '">' +
        '<label class="knob-lab" for="knob-' + kn.key + '">' + esc(kn.label) + (changed ? ' <span class="knob-dot">●</span>' : '') + '</label>' +
        '<input id="knob-' + kn.key + '" class="knob-inp" data-knob="' + kn.key + '" type="number" ' +
        'step="' + kn.step + '" min="' + kn.min + '" max="' + kn.max + '" value="' + curV + '">' +
        '<div class="knob-help">' + esc(kn.help) + ' · книга: <b>' + bookV + '</b></div>' +
        '</div>';
    }
    html += '</div>';
    html +=
      '<div class="ctrl-group knob-actions">' +
      '<button class="soft-run" data-act="tune-save">💾 Сохранить тюнинг</button>' +
      '<button class="ctrl-btn" data-act="tune-reset">↺ Сброс к значениям книги</button></div>';
    html += '</div>';
    return html;
  }

  /* ---------------------------- ВКЛАДКА: ГЕЙТЫ ---------------------------- */

  private renderGatesTab(): string {
    const scen = this.experiments.getScenario();
    const sc = SCENARIOS[scen];
    const cycles = this.experiments.cyclesSpent;

    let html = '';
    html +=
      '<div class="sim-banner">🚦 Гейты soft launch ([09] §9.5): вердикт <b>go / iterate / kill</b> по трём сценариям. ' +
      'Симулятор проверяет экономическую готовность (точка дефицита в срок, коридоры), сценарий — юнит-экономику (ARPDAU/LTV/ROAS).</div>';

    // Выбор сценария.
    html += '<div class="soft-ctrl"><div class="ctrl-group"><span class="ctrl-lab">📈 Сценарий 180 дней:</span>';
    for (const key of SCENARIO_IDS) {
      html += '<button class="ctrl-btn ' + (key === scen ? 'on' : '') + '" data-act="scen" data-scen="' + key + '">' + esc(SCENARIOS[key].name) + '</button>';
    }
    html += '</div>';
    html += '<div class="ctrl-group"><span class="ctrl-lab">🔁 Циклов пройдено:</span>';
    for (let cy = 0; cy <= 3; cy++) {
      html += '<button class="ctrl-btn ' + (cy === cycles ? 'on' : '') + '" data-act="cycles" data-cy="' + cy + '">' + cy + '</button>';
    }
    html += '</div>';
    html += '<div class="ctrl-group"><button class="soft-run" data-act="run-gates">▶ Оценить когорту</button></div></div>';

    // Юнит-экономика сценария ([09] §9.4/§9.5).
    const b = bFromRet(sc.d1, sc.d7);
    const a180 = activeDays(180, sc.d1, sc.d7);
    const ltv180 = ltv(180, sc);
    const ltv30 = ltv(30, sc);
    const roasD7 = ltv(7, sc) / sc.cpi;
    const roasD30 = ltv30 / sc.cpi;
    const roasD180 = ltv180 / sc.cpi;
    const payback = paybackDay(sc);
    const adShare = sc.adArpdau / (sc.adArpdau + sc.iapArpdau);

    html += '<div class="soft-card"><div class="dash-h">💵 Юнит-экономика · сценарий «' + esc(sc.name) + '» (горизонт 180 дней)</div>';
    html += '<div class="kpi-table-wrap"><table class="kpi-table"><tbody>';
    html += this.ueRow('D1 / D7 / D30 retention', pct(sc.d1) + ' / ' + pct(sc.d7) + ' / ' + pct(sc.d30));
    html += this.ueRow('b (степень кривой)', b.toFixed(3));
    html += this.ueRow('A(180), активных дней', a180.toFixed(1));
    html += this.ueRow('ARPDAU blended', usd(sc.arpdau) + '  (ad ' + usd(sc.adArpdau) + ' + IAP ' + usd(sc.iapArpdau) + ')');
    html += this.ueRow('LTV(30) / LTV(180)', usd(ltv30) + ' / ' + usd(ltv180));
    html += this.ueRow('LTV/CPI (CPI ' + usd(sc.cpi) + ')', (ltv180 / sc.cpi).toFixed(2));
    html += this.ueRow('ROAS D7 / D30 / D180', pct(roasD7) + ' / ' + pct(roasD30) + ' / ' + pct(roasD180));
    html += this.ueRow('Payback day', payback !== null ? '~D' + payback : 'нет (стоп UA)');
    html += '</tbody></table></div></div>';

    html += this.renderReadiness(adShare);
    html += this.renderVerdict(sc.name, roasD30, adShare);

    html +=
      '<div class="soft-card"><div class="dash-h">📖 Решающие правила ([09] §9.5)</div>' +
      '<div class="rule go">GO global: D1 ≥ 40% · D7 ≥ 16% · ARPDAU ≥ $0.17 · ROAS D30 ≥ 45% → масштабируем UA</div>' +
      '<div class="rule iter">ITERATE: D7 12–16% или ARPDAU $0.12–0.17 → 2–3 балансных цикла, ре-тест</div>' +
      '<div class="rule kill">KILL/pivot: D7 &lt; 12% при ARPDAU &lt; $0.12 после 3 циклов → не масштабируем</div>' +
      '</div>';
    return html;
  }

  private ueRow(k: string, v: string): string {
    return '<tr><td>' + esc(k) + '</td><td class="kpi-fact">' + v + '</td></tr>';
  }

  private renderReadiness(adShare: number): string {
    const r = this.experiments.lastRun;
    let html = '<div class="soft-card"><div class="dash-h">🧮 Экономическая готовность (симкогорта)</div>';
    if (r === null) {
      html += '<p class="dash-note">Нажмите «▶ Оценить когорту» — симулятор проверит точку дефицита и коридоры.</p></div>';
      return html;
    }
    const checks: GateItem[] = [
      { status: r.wallet.inWindow ? 'ok' : 'warn', name: 'Точка дефицита («Кошелёк») в окне 12–16', target: 'день 12–16', fact: 'день ' + r.wallet.median },
      { status: r.sinkSourceD14 >= 1.05 && r.sinkSourceD14 <= 1.15 ? 'ok' : 'warn', name: 'Sink/Source D14+ (без RW)', target: '1.05–1.15', fact: r.sinkSourceD14.toFixed(2) },
      { status: r.balD7Entries >= 8 && r.balD7Entries <= 15 ? 'ok' : 'warn', name: 'Баланс D7 во взносах', target: '8–15', fact: r.balD7Entries.toFixed(1) },
      { status: adShare >= 0.42 && adShare <= 0.52 ? 'ok' : 'warn', name: 'Ad-доля в выручке ~ гибрид', target: '42–52%', fact: pct(adShare) },
      { status: r.ad.adArpdau >= 0.05 ? 'ok' : 'warn', name: 'Ad-ARPDAU сим ≥ пол (медианный неплательщик)', target: '≥ $0.05', fact: usd(r.ad.adArpdau) }
    ];
    html += this.gateList(checks);
    html +=
      '<p class="dash-small">Ad-ARPDAU симулятора ($' + r.ad.adArpdau.toFixed(3) + ') — консервативный пол медианного неплательщика; ' +
      'целевой ad-ARPDAU когорты $0.10 включает все 6 плейсментов, ивенты и вовлечённых игроков ([09] §9.3, находка Ф1).</p></div>';
    return html;
  }

  private renderVerdict(scName: string, roasD30: number, adShare: number): string {
    const r = this.experiments.lastRun;
    const sc = SCENARIOS[this.experiments.getScenario()];
    const v = this.experiments.verdict();

    let html = '<div class="verdict ' + v.cls + '">';
    html += '<div class="verdict-badge">' + v.verdict + '</div>';
    html += '<div class="verdict-head">Сценарий «' + esc(scName) + '»: ' + esc(v.headline) + '</div>';
    html +=
      '<div class="verdict-grid">' +
      this.vcell('D1', pct(sc.d1), sc.d1 >= 0.4) +
      this.vcell('D7', pct(sc.d7), sc.d7 >= 0.16) +
      this.vcell('ARPDAU', usd(sc.arpdau), sc.arpdau >= 0.17) +
      this.vcell('ROAS D30', pct(roasD30), roasD30 >= 0.45) +
      this.vcell('ad-доля', pct(adShare), adShare >= 0.42 && adShare <= 0.52) +
      this.vcell('дефицит в срок', r !== null ? 'D' + r.wallet.median : '—', r !== null ? r.wallet.inWindow : false) +
      '</div>';
    if (v.reasons.length > 0) html += '<div class="verdict-note">⚠ ' + v.reasons.map(esc).join(' · ') + '</div>';
    html += '</div>';
    return html;
  }

  private vcell(k: string, v: string, ok: boolean): string {
    return '<div class="vcell ' + (ok ? 'ok' : 'no') + '"><div class="vc-k">' + esc(k) + '</div><div class="vc-v">' + esc(v) + '</div></div>';
  }

  /* ============================ ВИДЖЕТЫ ============================ */

  private tile(cls: string, label: string, value: string, sub: string): string {
    return (
      '<div class="dash-tile ' + cls + '"><div class="tile-val">' + value + '</div>' +
      '<div class="tile-lab">' + esc(label) + '</div><div class="tile-sub">' + esc(sub) + '</div></div>'
    );
  }
}
