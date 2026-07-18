/**
 * ДЕВ-ИНСТРУМЕНТ (Проход Ж.1): внутренний кокпит прод-команды, НЕ для
 * игроков — сознательно не локализован и остаётся русским (i18n-слой t()
 * сюда не заводим; в прод-сборке экран выключается фичефлагом).
 *
 * Soft-launch кокпит (🚀) — DOM-оверлей, порт UI-части experiments.js
 * (Проход Г) в архитектуре Е.1. Четыре блока: A/B-эксперименты (варианты +
 * «Сравнить A/B»), панель тюнинга ручек, прогон симулятора (N 100–400, <1 с,
 * таблица с цветовой разметкой vs 05 §4) и гейты go/iterate/kill с вердиктом.
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
      '<div class="metaInner">' +
      '<div class="metaHeader">' +
      '<button id="cockpitCloseBtn" type="button" class="metaClose">← В игру</button>' +
      '<span class="ckSess" id="cockpitSess"></span>' +
      '</div>' +
      '<section class="metaSection"><h3>🚀 Soft-launch кокпит (Проход Г)</h3>' +
      '<p class="metaNote">Офлайн-инструмент прод-команды: A/B, тюнинг ручек, симулятор экономики ' +
      '(приложение 12), гейты 09 §5.4. В игру не вмешивается; свой ключ сейва blocksurge_softlaunch.</p>' +
      '<div id="cockpitBody"></div>' +
      '</section></div>';

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

    // Гейты/тумблеры: сценарий, CPI, IAP, applyAB.
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
      if (t.id === 'ckApplyAB') {
        this.experiments.setApplyAB(t.checked);
        this.experiments.runBoth(); // пересчёт под новый режим
        this.render();
      }
    });
  }

  open(): void {
    this.el('cockpitScreen').classList.remove('hidden');
    if (this.experiments.getLastSurvivor() === null) this.experiments.runBoth(); // первый прогон при открытии
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
    let h = '<div class="ckSection"><h4>A/B-эксперименты · session <code>' + esc(ex.sessionId) + '</code></h4>';
    h += '<p class="ckNote">Назначение варианта — детерминировано по хешу session-id (fnv1a32). ' +
      'Одна и та же сессия всегда получает те же варианты; они видны и в дашборде монетизации.</p>';
    for (const exp of EXPERIMENTS) {
      const assigned = ex.assignedVariant(exp);
      h += '<div class="ckExp">';
      h += '<div class="ckExpTop"><b>' + esc(exp.name) + '</b><span class="ckExpId">' + esc(exp.id) + '</span></div>';
      h += '<div class="ckExpMeta">Первичная: ' + esc(exp.primary) + ' · Guardrail: ' + esc(exp.guardrail) + '</div>';
      h += '<div class="ckVariants">';
      for (const vr of exp.variants) {
        const on = vr.id === assigned.id;
        h += '<span class="ckVar' + (on ? ' active' : '') + '">' + (on ? '● ' : '○ ') +
          esc(vr.id) + ': ' + esc(vr.label) + '</span>';
      }
      h += '</div>';
      h += '<button type="button" class="ghostBtn ckCompareBtn" data-exp="' + exp.id + '">⚖ Сравнить A/B (гонит оба)</button>';
      h += '<div class="ckCompareOut" id="ckCmp_' + exp.id + '"></div>';
      h += '</div>';
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
      let h = '<table class="ckTable ckCmpTable"><thead><tr><th>вариант</th><th>ad-ARPDAU</th><th>rw/DAU</th>' +
        '<th>earn/spend</th><th>баланс D30</th><th>деф D30</th></tr></thead><tbody>';
      for (const r of res.rows) {
        h += '<tr><td><b>' + esc(r.id) + '</b> ' + esc(r.label) + '</td><td>$' + fmt(r.adArpdau, 4) + '</td>' +
          '<td>' + fmt(r.rwPerDau, 2) + '</td><td>' + fmt(r.ratio, 3) + '</td><td>' + r.balD30 +
          '</td><td>' + (r.deficitD30 * 100).toFixed(0) + '%</td></tr>';
      }
      h += '</tbody></table>';
      const d = res.deltaArpdauPct;
      h += '<div class="ckMini">Δ ad-ARPDAU (B−A) = <b>' + (d >= 0 ? '+' : '') + fmt(d, 1) + '%</b> · ' +
        'первичная метрика: ' + esc(res.exp.primary) + ' · guardrail: ' + esc(res.exp.guardrail) +
        '. Детерминировано (свой runId на вариант).</div>';
      const out2 = document.getElementById('ckCmp_' + expId);
      if (out2) out2.innerHTML = h;
    }, 20);
  }

  /* ----------------------------- Тюнинг ----------------------------- */

  private renderTuning(): string {
    const ex = this.experiments;
    let h = '<div class="ckSection"><h4>Панель тюнинга ручек <span class="simTag">localStorage</span></h4>';
    h += '<p class="ckNote">Правки сохраняются локально и применяются к симулятору. «Книга» — калиброванный ' +
      'baseline (12 §8). Изменённые ручки подсвечены; «сброс» возвращает к книге. Номиналы (цены, награды, ' +
      'капы rewarded) НЕ тюнятся — это решения глав 05/06 (INV-E1).</p>';
    const groups = new Map<string, typeof KNOBS[number][]>();
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
    h += '<button type="button" class="ghostBtn" id="ckResetAll">↺ Сбросить все ручки к книге</button>';
    h += '</div>';
    return h;
  }

  /* ------------------------------ Прогон ----------------------------- */

  private renderRunControls(): string {
    const st = this.experiments.getState();
    let h = '<div class="ckSection"><h4>Прогон симулятора</h4>';
    h += '<p class="ckNote">Браузер: N=' + st.simN + ' игроков × 30 дней, &lt;1 c. Headless: ' +
      '<code>npm run sim -- [runId] [N]</code> печатает ту же сводку в stdout (один модуль — два входа). ' +
      'runId привязан к session-id — прогон воспроизводим.</p>';
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
    const s = this.experiments.getLastSurvivor();
    if (!s) {
      return '<div class="ckSection"><h4>Результаты симуляции</h4>' +
        '<p class="ckNote">Нажми «Прогнать симуляцию» — здесь появится кривая баланса против 05 §4, ' +
        'точки дефицита, ARPDAU и доля sinks.</p></div>';
    }
    const ag = s.aggregates;
    const cal = s.calibration;
    let h = '<div class="ckSection"><h4>Баланс BASE×CORE по дням vs таблица 05 §4</h4>';
    h += '<div class="ckTableWrap"><table class="ckTable"><thead><tr>' +
      '<th>день</th><th>sim</th><th>05§4</th><th>откл%</th><th>earn</th><th>spend</th><th>деф&lt;200</th></tr></thead><tbody>';
    for (const r of s.byDay) {
      const cls = Math.abs(r.devPct) <= 10 ? 'ok' : Math.abs(r.devPct) <= 25 ? 'near' : 'off';
      h += '<tr><td>' + r.day + '</td><td>' + r.balanceMedianBaseCore + '</td><td>' + r.target05 + '</td>' +
        '<td class="' + cls + '">' + r.devPct.toFixed(0) + '%</td>' +
        '<td>' + r.earnMean.toFixed(0) + '</td><td>' + r.spendMean.toFixed(0) + '</td>' +
        '<td>' + (r.deficitShare * 100).toFixed(0) + '%</td></tr>';
    }
    h += '</tbody></table></div>';
    h += '<div class="ckKpiGrid">';
    h += this.kpi('Калибровка M1', cal.checkpointsWithin10 + '/' + cal.checkpointsTotal + ' в ±10%',
      'max|откл| ' + cal.maxAbsDevPct.toFixed(0) + '%', cal.pass ? 'ok' : 'near');
    h += this.kpi('earn/spend (D14–30)', fmt(ag.ratioMean, 3), 'коридор 0.95–1.15',
      ag.ratioMean >= 0.95 && ag.ratioMean <= 1.15 ? 'ok' : 'near');
    h += this.kpi('Прилив M7 (кристалл)', (ag.surgeGamesPct * 100).toFixed(0) + '%', 'цель ≥60%',
      ag.surgeGamesPct >= 0.6 ? 'ok' : 'off');
    h += this.kpi('rewarded / DAU', fmt(ag.rwPerDauMean, 2), 'цель ≈1.8', ag.rwPerDauMean >= 1.5 ? 'ok' : 'near');
    h += this.kpi('Дефицит D30 (<200)', (ag.deficitShareD30 * 100).toFixed(0) + '%', 'M8 ≥40%',
      ag.deficitShareD30 >= 0.4 ? 'ok' : 'near');
    h += this.kpi('Глубокий деф. (<400)', (ag.deepDeficitShareD30 * 100).toFixed(0) + '%', 'M9 растёт', 'near');
    h += this.kpi('Накопители (>5000)', (ag.hoardShareD30 * 100).toFixed(1) + '%', 'M10 ≤3%',
      ag.hoardShareD30 <= 0.03 ? 'ok' : 'off');
    h += this.kpi('ad-ARPDAU', '$' + fmt(ag.adArpdau, 4), 'eCPM тюнинга', 'ok');
    h += '</div>';
    // fail-коридоры
    h += '<div class="ckMini"><b>Fail-коридоры (03 §5.2):</b> ';
    const parts: string[] = [];
    for (const sn of Object.keys(ag.failCorridors) as Array<keyof typeof ag.failCorridors>) {
      const cor = ag.failCorridors[sn];
      const fr = ag.failRate[sn] * 100;
      const inC = fr >= cor[0] * 100 - 1 && fr <= cor[1] * 100 + 1;
      parts.push(sn + ' ' + fr.toFixed(0) + '% ' + (inC ? '✓' : '✗'));
    }
    h += parts.join(' · ') + '</div>';
    // sinks breakdown (последний день)
    const last = s.byDay[s.byDay.length - 1];
    if (last) {
      let sinkTot = 0;
      for (const sk of Object.keys(last.spendBySink)) sinkTot += last.spendBySink[sk] as number;
      const sparts: string[] = [];
      for (const sk of Object.keys(last.spendBySink)) {
        sparts.push(esc(sk) + ' ' + (((last.spendBySink[sk] as number) / sinkTot) * 100).toFixed(0) + '%');
      }
      h += '<div class="ckMini"><b>Доля sinks (D30):</b> ' + (sparts.length ? sparts.join(' · ') : '—') + '</div>';
    }
    // красные флаги
    if (s.flags.length) {
      h += '<div class="ckFlags"><b>⚑ Красные флаги дизайна (12 §8.4):</b><ul>';
      for (const f of s.flags) h += '<li>' + esc(f) + '</li>';
      h += '</ul></div>';
    } else {
      h += '<div class="ckMini ckOk">✓ Красных флагов дизайна нет (12 §8.4).</div>';
    }
    h += '</div>';
    return h;
  }

  /* ------------------------------ Гейты ------------------------------ */

  private renderGates(): string {
    const ex = this.experiments;
    const st = ex.getState();
    let h = '<div class="ckSection"><h4>Гейты go / iterate / kill (09 §5.4)</h4>';
    h += '<p class="ckNote">Вердикт по симулированной когорте + сценарий удержания. D7 ROAS = LT7 × ' +
      '(ad-ARPDAU симулятора + IAP-ARPDAU) / CPI. Лимит итераций — не более двух (10 P7), дальше ' +
      'решение kill/scale на данных.</p>';
    // controls
    h += '<div class="ckGateCtl">';
    h += '<label>Сценарий удержания: <select id="ckScenario">';
    for (const skey of RET_SCENARIO_IDS) {
      const opt = RET_SCENARIOS[skey];
      h += '<option value="' + skey + '"' + (st.retScenario === skey ? ' selected' : '') + '>' +
        esc(opt.label) + ' (D1 ' + opt.d1 + ' / D7 ' + opt.d7 + ')</option>';
    }
    h += '</select></label>';
    h += '<label>CPI $ <input type="number" id="ckCpi" min="0.5" max="1.6" step="0.05" value="' + st.cpi + '"></label>';
    h += '<label>IAP-ARPDAU $ <input type="number" id="ckIap" min="0" max="0.2" step="0.005" value="' + st.iapArpdau + '"></label>';
    h += '</div>';

    if (ex.getLastCohort() === null) {
      h += '<p class="ckNote ckWarn">Прогони симуляцию — гейты считаются по COHORT-когорте (метрики на DAU).</p></div>';
      return h;
    }
    const G = ex.computeGates();
    const bandLabel: Record<GateBand, string> = { kill: 'KILL', iterate: 'ITERATE', scale: 'GO / SCALE' };
    h += '<div class="ckTableWrap"><table class="ckTable ckGateTable"><thead><tr>' +
      '<th>метрика</th><th>значение</th><th>kill &lt;</th><th>scale ≥</th><th>вердикт</th></tr></thead><tbody>';
    for (const key of GATE_KEYS) {
      const g = GATES[key];
      const band = G.verdicts[key];
      const v = key === 'adArpdau' ? '$' + G.metrics[key].toFixed(4) : G.metrics[key].toFixed(0) + '%';
      const killV = g.unit === '$' ? '$' + g.kill.toFixed(2) : g.kill + g.unit;
      const scaleV = g.unit === '$' ? '$' + g.scale.toFixed(2) : g.scale + g.unit;
      h += '<tr><td>' + esc(g.label) + '</td><td><b>' + v + '</b></td><td>' + killV + '</td><td>' + scaleV +
        '</td><td class="ckBand ' + band + '">' + bandLabel[band] + '</td></tr>';
    }
    h += '</tbody></table></div>';
    // производные
    h += '<div class="ckMini">LT7 = ' + G.lt7.toFixed(2) + ' (сценарий «' + esc(G.scenario.label) + '») · ' +
      'blended ARPDAU = $' + G.blended.toFixed(4) + ' · LTV7 = $' + G.ltv7.toFixed(3) + ' · CPI = $' + G.cpi.toFixed(2) + '</div>';

    // общий вердикт
    const vlabel: Record<GateBand, string> = {
      kill: 'KILL — остановка проекта с ретро',
      iterate: 'ITERATE — цикл итераций (+4–6 недель)',
      scale: 'GO / SCALE — global launch'
    };
    const reasons: string[] = [];
    for (const key of GATE_KEYS) {
      if (G.verdicts[key] === G.verdict) reasons.push(GATES[key].label);
    }
    const iterExhausted = G.verdict === 'iterate' && G.iterateCount >= G.iterateLimit;
    h += '<div class="ckVerdict ' + G.verdict + '">';
    h += '<div class="ckVerdictTop">Вердикт: <b>' + vlabel[G.verdict] + '</b></div>';
    if (G.verdict === 'kill') {
      h += '<div class="ckVerdictWhy">Одна из метрик ниже kill-порога (' + reasons.join(', ') + '). ' +
        'Ниже kill — остановка с ретро (10 Проход Г DoD).</div>';
    } else if (G.verdict === 'scale') {
      h += '<div class="ckVerdictWhy">Все метрики на scale-порогах — гейт Прохода Г пройден ' +
        '(D1 ≥38, D7 ≥15, ad-ARPDAU ≥$0.10, D7 ROAS ≥40%). Путь на Проход Д (global).</div>';
    } else {
      h += '<div class="ckVerdictWhy">Метрики в «серой зоне» (' + reasons.join(', ') + ')' +
        (G.flags.length ? ' + красные флаги симулятора удерживают от scale' : '') + '. ' +
        'Итераций пройдено: <b>' + G.iterateCount + ' / ' + G.iterateLimit + '</b>.</div>';
      if (iterExhausted) {
        h += '<div class="ckVerdictWhy ckWarn">⚠ Лимит из ' + G.iterateLimit +
          ' iterate-циклов исчерпан (10 P7): дальше — жёсткое решение kill/scale на данных, без бесконечного iterate.</div>';
      }
      h += '<button type="button" class="ghostBtn" id="ckIterBtn"' + (iterExhausted ? ' disabled' : '') +
        '>Зафиксировать iterate-цикл (' + G.iterateCount + '→' + (G.iterateCount + 1) + ')</button> ';
      h += '<button type="button" class="ghostBtn" id="ckIterReset">сбросить счётчик</button>';
    }
    h += '</div>';
    h += '</div>';
    return h;
  }
}
