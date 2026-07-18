/**
 * Soft-launch кокпит (🚀) — DOM-оверлей, порт UI-части experiments.js
 * (Проход Г) в архитектуре Е. Пять блоков: A/B-эксперименты (варианты +
 * «Сравнить A/B»), панель тюнинга ручек, прогон симулятора (N 100–400, <1 с),
 * результаты (REF vs 05 §4 + MC + KPI-плитки + находки) и гейты
 * go/iterate/kill (09 §4.3) с виджетом чувствительности подписки.
 *
 * Вся математика — в Experiments/src/sim; кокпит только рендерит и слушает.
 * В игру не вмешивается: не трогает ядро/экономику/монетизацию/сейв игры.
 */
import {
  EXPERIMENTS,
  GATES,
  GATE_KEYS,
  KNOBS,
  RET_SCENARIOS,
  type Experiments,
  type GateBand,
  type KnobKey
} from '../experiments/experiments';
import { RET_SCENARIO_IDS, type RetScenarioId } from '../experiments/save';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmt(v: number, d = 2): string {
  return v.toFixed(d);
}
function money(v: number): string {
  const n = v || 0;
  return '$' + n.toFixed(n >= 1 ? 2 : 4);
}

export class CockpitUi {
  constructor(private readonly experiments: Experiments) {}

  private el(id: string): HTMLElement {
    const node = document.getElementById(id);
    if (!node) throw new Error('CockpitUi: нет контейнера #' + id + ' в index.html');
    return node;
  }

  /* ============================ МОНТАЖ ============================ */

  mount(): void {
    this.el('cockpitScreen').innerHTML =
      '<div class="monInner">' +
      '<div class="monHeader">' +
      '<button id="cockpitCloseBtn" type="button" class="mon-close">← В игру</button>' +
      '<div class="cockpitSess" id="cockpitSess"></div>' +
      '</div>' +
      '<h3 class="monTitle">🚀 Soft-launch cockpit <span class="simTag">Проход Е.3</span></h3>' +
      '<p class="monNote">Симулятор экономики (приложение 12) + A/B-фреймворк + панель тюнинга ручек + ' +
      'гейты go/iterate/kill (09 §4.3). Симулятор ДЕТЕРМИНИРОВАН (свой seeded-RNG, INV-S2): тот же ' +
      'расчёт в браузере и в <code>npm run sim</code>. Кокпит — офлайн-инструмент прод-команды, ' +
      'в саму игру он не вмешивается (не трогает ядро/экономику/монетизацию/сейв).</p>' +
      '<div id="cockpitBody"></div>' +
      '</div>';

    this.el('cockpitCloseBtn').addEventListener('click', () => this.close());

    const body = this.el('cockpitBody');

    // Делегирование кликов (кнопки перерисовываются при каждом render()).
    body.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const cmpBtn = t.closest('.ckCompareBtn');
      if (cmpBtn) {
        this.compareAB(cmpBtn.getAttribute('data-exp') ?? '');
        return;
      }
      const resetOne = t.closest('.ckResetOne');
      if (resetOne) {
        this.experiments.resetKnob(resetOne.getAttribute('data-knob') as KnobKey);
        this.render();
        return;
      }
      if (t.closest('#ckResetAll')) {
        this.experiments.resetAll();
        this.render();
        return;
      }
      const runBtn = t.closest('#ckRunBtn');
      if (runBtn) {
        const b = runBtn as HTMLButtonElement;
        b.disabled = true;
        b.textContent = '⏳ считаю…';
        window.setTimeout(() => {
          this.experiments.runBoth();
          this.render();
        }, 20);
        return;
      }
      if (t.closest('#ckIterBtn')) {
        this.experiments.incIterate();
        this.render();
        return;
      }
      if (t.closest('#ckIterReset')) {
        this.experiments.resetIterate();
        this.render();
      }
    });

    // Ручки: range + number (синхронно, без полной перерисовки) и N-слайдер.
    body.addEventListener('input', (e) => {
      const inp = e.target as HTMLInputElement;
      if (inp.id === 'ckN') {
        this.experiments.setSimN(parseInt(inp.value, 10));
        const nVal = document.getElementById('ckNval');
        if (nVal) nVal.textContent = String(this.experiments.getState().simN);
        return;
      }
      const key = inp.getAttribute('data-knob') as KnobKey | null;
      if (key === null) return;
      this.experiments.setKnob(key, inp.value);
      body.querySelectorAll('[data-knob="' + key + '"]').forEach((o) => {
        if (o !== inp) (o as HTMLInputElement).value = inp.value;
      });
      const wrap = inp.closest('.ckKnob');
      if (wrap) {
        wrap.classList.add('edited');
        const rb = wrap.querySelector('.ckResetOne');
        if (rb) (rb as HTMLButtonElement).disabled = false;
      }
      this.refreshSessLine();
    });

    // Гейты/тумблеры: сценарий, CPI, IAP, триал-рейт, applyAB.
    body.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.id === 'ckScenario') {
        const v = t.value;
        if ((RET_SCENARIO_IDS as readonly string[]).includes(v)) {
          this.experiments.setScenario(v as RetScenarioId);
          this.render();
        }
        return;
      }
      if (t.id === 'ckCpi') {
        this.experiments.setCpi(parseFloat(t.value));
        this.render();
        return;
      }
      if (t.id === 'ckIap') {
        this.experiments.setIapArpdau(parseFloat(t.value));
        this.render();
        return;
      }
      if (t.id === 'ckTrial') {
        this.experiments.setTrialRate(parseFloat(t.value));
        this.render();
        return;
      }
      if (t.id === 'ckApplyAB') {
        this.experiments.setApplyAB(t.checked);
        this.experiments.runBoth(); // пересчёт под новый режим
        this.render();
      }
    });
  }

  open(): void {
    this.el('cockpitScreen').classList.remove('hidden');
    if (this.experiments.getLastMC() === null) this.experiments.runBoth(); // первый прогон при открытии
    this.render();
  }

  close(): void {
    this.el('cockpitScreen').classList.add('hidden');
  }

  /* ============================ РЕНДЕР ============================ */

  private refreshSessLine(): void {
    const sess = document.getElementById('cockpitSess');
    if (sess) sess.innerHTML = 'A/B: <code>' + esc(this.experiments.abGroupsString()) + '</code>';
  }

  private render(): void {
    this.refreshSessLine();
    this.el('cockpitBody').innerHTML =
      this.renderAB() + this.renderTuning() + this.renderRunControls() + this.renderResults() + this.renderGates();
  }

  /* ------------------------------ A/B ------------------------------ */

  private renderAB(): string {
    const ex = this.experiments;
    let h = '<div class="ckSection"><h4>1 · A/B-эксперименты <span class="simTag">session ' + esc(ex.sessionId) + '</span></h4>';
    h += '<p class="ckNote">Назначение варианта — детерминировано по хешу session-id (fnv1a32, как в src/sim). ' +
      'Одна и та же сессия всегда получает те же варианты; они видны и в дашборде монетизации (ab_groups, 09 §1). ' +
      'Эти A/B меняют НОМИНАЛ/продукт (цена подсказки, длина триала, INT-кап) — решения экономиста/прода через ' +
      'A/B (05 §10), не калибровку.</p>';
    for (const exp of EXPERIMENTS) {
      const assigned = ex.assignedVariant(exp);
      h += '<div class="ckExp"><div class="ckExpTop"><b>' + esc(exp.name) + '</b><span class="ckExpId">' + esc(exp.id) + '</span></div>';
      h += '<div class="ckExpMeta">Первичная: ' + esc(exp.primary) + ' · Guardrail: ' + esc(exp.guardrail) + '</div>';
      h += '<div class="ckVariants">';
      for (const vr of exp.variants) {
        const on = vr.id === assigned.id;
        h += '<span class="ckVar' + (on ? ' active' : '') + '">' + (on ? '● ' : '○ ') + esc(vr.id) + ': ' + esc(vr.label) + '</span>';
      }
      h += '</div>';
      h += '<button type="button" class="ckCompareBtn ckGhost" data-exp="' + exp.id + '">⚖ Сравнить A/B (гонит оба)</button>';
      h += '<div class="ckCompareOut" id="ckCmp_' + exp.id + '"></div></div>';
    }
    h += '</div>';
    return h;
  }

  /** A/B-сравнение: гоняем оба варианта, показываем дельту первичной метрики. */
  private compareAB(expId: string): void {
    const out = document.getElementById('ckCmp_' + expId);
    if (out) out.innerHTML = '<span class="ckNote">⏳ гоняю оба варианта…</span>';
    window.setTimeout(() => {
      const res = this.experiments.compareExperiment(expId);
      if (!res) return;
      let h = '<table class="ckTable ckCmpTable"><thead><tr><th>вариант</th><th>ad-ARPDAU</th><th>sub-ARPDAU</th>' +
        '<th>ROAS365</th><th>баланс D30</th><th>деф D30</th></tr></thead><tbody>';
      for (const rr of res.rows) {
        h += '<tr><td><b>' + esc(rr.id) + '</b> ' + esc(rr.label) + '</td><td>' + money(rr.adArpdau) + '</td>' +
          '<td>' + money(rr.subArpdau) + '</td><td>' + rr.roas365.toFixed(0) + '%</td><td>' + rr.balD30 +
          '</td><td>' + (rr.deficitD30 * 100).toFixed(0) + '%</td></tr>';
      }
      h += '</tbody></table>';
      const d = res.deltaPrimaryPct;
      h += '<div class="ckMini">Δ первичной (' + esc(res.exp.primary) + ', B−A) = <b>' + (d >= 0 ? '+' : '') + fmt(d, 1) + '%</b> · ' +
        'guardrail: ' + esc(res.exp.guardrail) + '. Детерминировано (свой runId на вариант).</div>';
      const out2 = document.getElementById('ckCmp_' + expId);
      if (out2) out2.innerHTML = h;
    }, 20);
  }

  /* ----------------------------- Тюнинг ----------------------------- */

  private renderTuning(): string {
    const ex = this.experiments;
    let h = '<div class="ckSection"><h4>2 · Панель тюнинга ручек <span class="simTag">localStorage</span></h4>';
    h += '<p class="ckNote">Правки сохраняются локально (ключ <code>wordgrove_softlaunch</code>) и применяются к ' +
      'симулятору. «Книга» — калиброванный baseline (12 §8, трекает 05 §4). Изменённые ручки подсвечены; «↺» ' +
      'возвращает к книге. НОМИНАЛЫ (цены/награды/капы rewarded) панель НЕ тюнит — это решения глав 05/06 (INV-S1); ' +
      'их правят A/B-сценарии выше.</p>';
    const groups = new Map<string, (typeof KNOBS)[number][]>();
    for (const kn of KNOBS) {
      const list = groups.get(kn.group);
      if (list) list.push(kn);
      else groups.set(kn.group, [kn]);
    }
    for (const [gname, list] of groups) {
      h += '<div class="ckGroup"><div class="ckGroupName">' + esc(gname) + '</div>';
      for (const kn of list) {
        const val = ex.knobValue(kn.key);
        const book = ex.bookValue(kn.key);
        const edited = ex.isKnobEdited(kn.key);
        h += '<div class="ckKnob' + (edited ? ' edited' : '') + '">';
        h += '<div class="ckKnobLbl">' + esc(kn.label) + '<span class="ckKnobHint">' + esc(kn.hint) + '</span></div>';
        h += '<div class="ckKnobCtl">';
        h += '<input type="range" class="ckRange" data-knob="' + kn.key + '" min="' + kn.min + '" max="' + kn.max +
          '" step="' + kn.step + '" value="' + val + '">';
        h += '<input type="number" class="ckNum" data-knob="' + kn.key + '" min="' + kn.min + '" max="' + kn.max +
          '" step="' + kn.step + '" value="' + val + '">';
        h += '<span class="ckBook">книга ' + book + '</span>';
        h += '<button type="button" class="ckResetOne" data-knob="' + kn.key + '"' + (edited ? '' : ' disabled') + '>↺</button>';
        h += '</div></div>';
      }
      h += '</div>';
    }
    h += '<button type="button" class="ckGhost" id="ckResetAll">↺ Сбросить все ручки к книге</button>';
    h += '</div>';
    return h;
  }

  /* ------------------------------ Прогон ----------------------------- */

  private renderRunControls(): string {
    const st = this.experiments.getState();
    let h = '<div class="ckSection"><h4>3 · Прогон симулятора</h4>';
    h += '<p class="ckNote">Браузер: N=' + st.simN + ' игроков × 30 дней, &lt;1 c (REF + MC + COHORT). Headless: ' +
      '<code>npm run sim -- [runId] [N]</code> печатает ту же сводку в stdout (один модуль — два входа). ' +
      'runId привязан к session-id — прогон воспроизводим (INV-S2, детерминизм).</p>';
    h += '<div class="ckRunRow">';
    h += '<label class="ckNlabel">N игроков: <input type="range" id="ckN" min="100" max="400" step="50" value="' +
      st.simN + '"><b id="ckNval">' + st.simN + '</b></label>';
    h += '<button type="button" id="ckRunBtn" class="ckRunBtn">▶ Прогнать симуляцию</button>';
    h += '</div>';
    h += '<label class="ckNlabel ckAbToggle"><input type="checkbox" id="ckApplyAB"' + (st.applyAB ? ' checked' : '') +
      '> применять назначенные A/B-варианты к прогону (' + esc(this.experiments.abGroupsString()) + ')</label>';
    h += '</div>';
    return h;
  }

  /* ---------------------------- Результаты --------------------------- */

  private kpi(label: string, val: string, sub: string, cls: string): string {
    return '<div class="ckKpi ' + cls + '"><div class="ckKpiV">' + val + '</div>' +
      '<div class="ckKpiL">' + label + '</div><div class="ckKpiS">' + sub + '</div></div>';
  }

  private renderResults(): string {
    const lastRef = this.experiments.getLastRef();
    const lastMC = this.experiments.getLastMC();
    const lastCohort = this.experiments.getLastCohort();
    if (!lastRef || !lastMC || !lastCohort) {
      return '<div class="ckSection"><h4>4 · Результаты симуляции</h4>' +
        '<p class="ckNote">Нажми «Прогнать симуляцию» — здесь появятся кривая баланса REF vs 05 §4, окно дефицита, ' +
        'подсказки/день (M-5), rewarded/DAU (M-6), ARPDAU и находки.</p></div>';
    }
    const r = lastRef.ref;
    const mc = lastMC.aggregates;
    let h = '<div class="ckSection"><h4>4 · Баланс REF-твина по дням vs таблица 05 §4</h4>';
    h += '<p class="ckNote">REF — детерминированный EV-твин ячейки MEDIAN×CORE (survivor, без RV-доходов/weekly/копилки): ' +
      'воспроизводит таблицу 05 §4 (INV-S4). MEDIAN×CORE MC — та же ячейка при ПОЛНЫХ потоках §4.</p>';
    h += '<div class="ckTableWrap"><table class="ckTable"><thead><tr>' +
      '<th>день</th><th>REF</th><th>05§4</th><th>откл%</th><th>MC медиана</th><th>MC деф&lt;300</th></tr></thead><tbody>';
    for (let i = 0; i < lastRef.byDay.length; i++) {
      const rr = lastRef.byDay[i];
      const mrow = lastMC.byDay[i];
      if (!rr || !mrow) continue;
      const ad = Math.abs(rr.devPct);
      const cls = ad <= 8 ? 'ok' : ad <= 12 ? 'near' : 'off';
      h += '<tr><td>' + rr.day + '</td><td>' + rr.balance + '</td><td>' + rr.target05 + '</td>' +
        '<td class="' + cls + '">' + rr.devPct.toFixed(0) + '%</td>' +
        '<td>' + mrow.balanceMedianCore + '</td><td>' + (mrow.deficitShare * 100).toFixed(0) + '%</td></tr>';
    }
    h += '</tbody></table></div>';

    // KPI-плитки
    h += '<div class="ckKpiGrid">';
    h += this.kpi('T-1 REF earn = 05 §4', r.earnExact ? '✓ точно' : '✗ СБОЙ', 'INV-S4, 0 монет расхождения', r.earnExact ? 'ok' : 'off');
    h += this.kpi('T-2 баланс REF', r.checkpointsWithin12 + '/' + r.checkpointsTotal + ' в ±12%',
      r.checkpointsWithin8 + '/6 в ±8% · D30 ' + r.d30, r.t2Pass ? 'ok' : 'near');
    h += this.kpi('REF первое «дно»', 'D' + (r.firstDeficitDay || '—'), 'цель ~D27–D29 (05 §4)',
      r.firstDeficitDay >= 26 && r.firstDeficitDay <= 30 ? 'ok' : 'near');
    h += this.kpi('MC окно дефицита', mc.windowShifted ? 'за D30' : 'D' + mc.firstDeficitMedian,
      'M-12: сдвиг от полных потоков', mc.windowShifted ? 'off' : 'ok');
    h += this.kpi('MC медиана D30', String(mc.balanceD30Median), 'коридор 400–900 (05 §5)',
      mc.balanceD30Median >= 400 && mc.balanceD30Median <= 900 ? 'ok' : 'off');
    h += this.kpi('earn/spend D14+', fmt(mc.ratioMean, 2), 'коридор 0.95–1.20',
      mc.ratioMean >= 0.95 && mc.ratioMean <= 1.2 ? 'ok' : 'near');
    h += this.kpi('ad-ARPDAU (COHORT)', money(lastCohort.aggregates.adArpdau), 'цель $0.055 (09 §3)',
      lastCohort.aggregates.adArpdau >= 0.055 ? 'ok' : 'near');
    h += this.kpi('Σ rewarded/DAU', fmt(lastCohort.aggregates.rwTotal, 2), 'цель ~1.5 (06 §3.1)', 'near');
    h += '</div>';

    // M-5 / M-6
    h += '<div class="ckMini"><b>M-5 подсказки/день D14+ (MEDIAN×CORE):</b> ' +
      'Лампа ' + fmt(mc.hintsD14.lamp, 2) + ' (цель 1.1) · Прицел ' + fmt(mc.hintsD14.scope, 2) + ' (0.4) · Ракета ' +
      fmt(mc.hintsD14.rocket, 2) + ' (0.15)</div>';
    const rw = mc.rwPerPlacement;
    h += '<div class="ckMini"><b>M-6 rewarded показы/DAU:</b> RV-1 ' + fmt(rw.rv1, 2) + ' · RV-2 ' + fmt(rw.rv2, 2) +
      ' · RV-3 ' + fmt(rw.rv3, 2) + ' · RV-5 ' + fmt(rw.rv5, 2) + ' · Σ ' + fmt(mc.rwTotal, 2) + ' (цель RV .30/.55/.20/.35)</div>';
    h += '<div class="ckMini"><b>M-10/M-11:</b> DAILY earn/день ' + mc.dailyEarnD14.toFixed(0) + ' (цель 100–160) · ' +
      'POWER earn ' + mc.powerEarnD14.toFixed(0) + ' / траты ' + mc.powerSpendD14.toFixed(0) + ' (earn 500+)</div>';

    if (mc.windowShifted || lastMC.flags.length) {
      h += '<div class="ckFlags"><b>⚑ Находки симулятора (12 §7–§8):</b><ul>';
      for (const f of lastMC.flags) h += '<li>' + esc(f) + '</li>';
      h += '</ul></div>';
    } else {
      h += '<div class="ckMini ckOk">✓ Находок-флагов нет.</div>';
    }
    h += '</div>';
    return h;
  }

  /* ------------------------------ Гейты ------------------------------ */

  private renderGates(): string {
    const ex = this.experiments;
    const st = ex.getState();
    let h = '<div class="ckSection"><h4>5 · Гейты go / iterate / kill (09 §4.3)</h4>';
    h += '<p class="ckNote">Вердикт по симулированной когорте (COHORT, ad-ARPDAU) + сценарий удержания 09 §4.2 + ' +
      'подписочная модель 06 §8.3. LTV(365) = LT(365) × (ad + подписка + IAP ARPDAU). Лимит итераций — не более двух ' +
      '(09 §4.3), дальше — решение kill/scale на данных.</p>';
    h += '<div class="ckGateCtl">';
    h += '<label>Сценарий удержания: <select id="ckScenario">';
    for (const skey of RET_SCENARIO_IDS) {
      const o = RET_SCENARIOS[skey];
      h += '<option value="' + skey + '"' + (st.retScenario === skey ? ' selected' : '') + '>' + esc(o.label) +
        ' (D1 ' + o.d1 + ' / D7 ' + o.d7 + ' / LT365 ' + o.lt365 + ')</option>';
    }
    h += '</select></label>';
    h += '<label>CPI $ <input type="number" id="ckCpi" min="0.6" max="1.6" step="0.05" value="' + st.cpi + '"></label>';
    h += '<label>IAP-ARPDAU $ <input type="number" id="ckIap" min="0" max="0.05" step="0.002" value="' + st.iapArpdau + '"></label>';
    h += '<label>Триал-рейт <input type="number" id="ckTrial" min="0" max="0.06" step="0.002" value="' + st.trialRate + '"></label>';
    h += '</div>';

    if (ex.getLastCohort() === null) {
      h += '<p class="ckNote ckWarn">Прогони симуляцию — гейты считаются по COHORT-когорте.</p></div>';
      return h;
    }
    const G = ex.computeGates();
    const bandLabel: Record<GateBand, string> = { kill: 'KILL', iterate: 'ITERATE', scale: 'GO / SCALE' };
    const rows: Array<{ key: (typeof GATE_KEYS)[number]; v: string }> = [
      { key: 'd1', v: G.metrics.d1.toFixed(0) + '%' },
      { key: 'arpdau', v: money(G.metrics.arpdau) },
      { key: 'roas365', v: G.metrics.roas365.toFixed(0) + '%' },
      { key: 'roas7', v: G.metrics.roas7.toFixed(0) + '%' },
      { key: 'subShare', v: G.metrics.subShare.toFixed(0) + '%' }
    ];
    h += '<div class="ckTableWrap"><table class="ckTable ckGateTable"><thead><tr>' +
      '<th>метрика</th><th>значение</th><th>kill &lt;</th><th>scale ≥</th><th>вердикт</th></tr></thead><tbody>';
    for (const row of rows) {
      const g = GATES[row.key];
      const band = G.verdicts[row.key];
      const killV = g.unit === '$' ? money(g.kill) : g.kill + g.unit;
      const scaleV = g.unit === '$' ? money(g.scale) : g.scale + g.unit;
      h += '<tr><td>' + esc(g.label) + '</td><td><b>' + row.v + '</b></td><td>' + killV + '</td><td>' + scaleV +
        '</td><td class="ckBand ' + band + '">' + bandLabel[band] + '</td></tr>';
    }
    h += '</tbody></table></div>';

    // Разбивка ARPDAU / выручки
    h += '<div class="ckMini">ARPDAU: реклама ' + money(G.adArpdau) + ' (' + G.adShare.toFixed(0) + '%) · подписка ' +
      money(G.subArpdau) + ' (' + G.subShare.toFixed(0) + '%) · IAP ' + money(G.iapArpdau) + ' (' + G.iapShare.toFixed(0) +
      '%) → blended ' + money(G.blended) + '. Цель сплита 65/22/13 (06 §1).</div>';
    h += '<div class="ckMini">LT(365) = ' + G.scn.lt365 + ' (сценарий «' + esc(G.scn.label) + '») · LTV(365) = ' + money(G.ltv365) +
      ' · LTV(7) = ' + money(G.ltv7) + ' · CPI = ' + money(G.cpi) + ' · триал→платная = ' + (G.trialConv * 100).toFixed(0) + '%</div>';

    // Виджет чувствительности подписки
    h += '<div class="ckSens"><div class="ckSensTitle">🔬 Чувствительность к подписке (подписка-зависимый LTV)</div>';
    h += '<div class="ckSensNote">Подписка — главный платный продукт (06 §5.1) и держит LTV(365): её net-ARPU в ~2,5× ' +
      'выше blended (05 §6). Проверяем хрупкость: что с ROAS(365), если триал-конверсия обвалится.</div>';
    h += '<table class="ckTable ckSensTable"><thead><tr><th>сценарий подписки</th><th>blended ARPDAU</th><th>ROAS(365)</th>' +
      '<th>вердикт по ROAS365</th></tr></thead><tbody>';
    const sensRows = [
      { label: 'база (триал ' + (G.trialConv * 100).toFixed(0) + '%)', bl: G.blended, roas: G.roas365 },
      { label: 'триал −50%', bl: G.sens.blendedHalf, roas: G.sens.roas365Half },
      { label: 'подписки нет', bl: G.sens.blendedNoSub, roas: G.sens.roas365NoSub }
    ];
    for (const sr of sensRows) {
      const band: GateBand = sr.roas < GATES.roas365.kill ? 'kill' : sr.roas < GATES.roas365.scale ? 'iterate' : 'scale';
      h += '<tr><td>' + esc(sr.label) + '</td><td>' + money(sr.bl) + '</td><td>' + sr.roas.toFixed(0) + '%</td>' +
        '<td class="ckBand ' + band + '">' + (band === 'kill' ? 'KILL' : band === 'iterate' ? 'ITERATE' : 'SCALE') + '</td></tr>';
    }
    h += '</tbody></table>';
    h += '<div class="ckSensNote">Обвал триал-конверсии вдвое роняет ROAS(365) на <b>' + Math.abs(G.sens.killPct).toFixed(0) +
      '%</b>' + (G.sens.roas365Half < GATES.roas365.kill && G.roas365 >= GATES.roas365.kill
        ? ' и переводит проект в <b class="ckKillTxt">KILL</b>'
        : '') +
      '. Вывод: LTV(365) держится на подписке — приоритет soft launch = защитить триал→платную конверсию ' +
      '(пейволл, длина триала A/B).</div>';
    h += '</div>';

    // Итоговый вердикт
    const vlabel: Record<GateBand, string> = {
      kill: 'KILL — остановка проекта с ретро',
      iterate: 'ITERATE — цикл итераций (+4–6 недель)',
      scale: 'GO / SCALE — global launch'
    };
    const reasons: string[] = [];
    for (const key of GATE_KEYS) {
      if (G.verdicts[key] === G.verdict) reasons.push(GATES[key].label.split(' (')[0] as string);
    }
    const iterExhausted = G.verdict === 'iterate' && G.iterateCount >= G.iterateLimit;
    h += '<div class="ckVerdict ' + G.verdict + '"><div class="ckVerdictTop">Вердикт: <b>' + vlabel[G.verdict] + '</b></div>';
    if (G.verdict === 'kill') {
      h += '<div class="ckVerdictWhy">Метрика ниже kill-порога (' + reasons.join(', ') + '). ' +
        'Kill-критерий 09 §4.3: D1 < 37% ИЛИ ARPDAU < $0.055 ИЛИ ROAS D365 < 80% после 3 итераций → не выходим в global.</div>';
    } else if (G.verdict === 'scale') {
      h += '<div class="ckVerdictWhy">Все метрики на scale-порогах — гейт пройден ' +
        '(D1 ≥40, ARPDAU ≥$0.085, ROAS365 ≥151%, ROAS7 ≥18%, подписка ≥22%). Путь в global.</div>';
    } else {
      h += '<div class="ckVerdictWhy">Метрики в «серой зоне» (' + reasons.join(', ') + ')' +
        (G.flags.length ? ' + находки симулятора (M-9/M-12) удерживают от scale' : '') +
        '. Итераций: <b>' + G.iterateCount + ' / ' + G.iterateLimit + '</b>.</div>';
      if (iterExhausted) {
        h += '<div class="ckVerdictWhy ckWarn">⚠ Лимит из ' + G.iterateLimit +
          ' iterate-циклов исчерпан (09 §4.3): дальше — жёсткое kill/scale на данных.</div>';
      }
      h += '<button type="button" class="ckGhost" id="ckIterBtn"' + (iterExhausted ? ' disabled' : '') +
        '>Зафиксировать iterate-цикл (' + G.iterateCount + '→' + (G.iterateCount + 1) + ')</button>';
      h += '<button type="button" class="ckGhost" id="ckIterReset">сбросить счётчик</button>';
    }
    h += '</div></div>';
    return h;
  }
}
