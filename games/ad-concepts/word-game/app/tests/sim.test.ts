/**
 * Тесты симулятора экономики и soft-launch кокпита (Проход Е.3) — чистая
 * логика без Phaser/DOM. Проверяются: детерминизм прогона (INV-S2, один runId
 * → бит-в-бит один результат, включая сериализованный текст), эквивалентность
 * порту (значения REF/MC/COHORT для seed42 = выводу prototype/sim.js),
 * доли сегментов Σ=1 (12 §2.1), детерминизм A/B-назначений, гейты 09 §4.3
 * (нулевой прогон не даёт ложный GO; чувствительность подписки), санитайзинг
 * сейва wordgrove_softlaunch (схема прототипа experiments.js).
 */
import { describe, expect, it } from 'vitest';
import type { KeyValueStorage } from '../src/core/storage';
import {
  BOOK_TUNE,
  CHECKPOINTS,
  FREQ_ORDER,
  SHARES,
  SKILL_ORDER,
  assertShares,
  mergeTune,
  retentionAt,
  runSim,
  segmentTable,
  toText,
  type McSummary,
  type RefSummary
} from '../src/sim/sim';
import {
  EXPERIMENTS,
  Experiments,
  GATES,
  MAX_ITERATE,
  RET_SCENARIOS,
  SUB_MODEL,
  evaluateGates,
  subArpdauFor,
  variantIndexFor
} from '../src/experiments/experiments';
import { SOFTLAUNCH_KEY, sanitizeSoftlaunch, softlaunchDefaults } from '../src/experiments/save';

/* ============================ ХЕЛПЕРЫ ============================ */

class MemStorage implements KeyValueStorage {
  private readonly m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
}

/** Кокпит с in-memory сейвом и детерминированным session-id. */
function makeExperiments(sessionId = 'test-session', storage = new MemStorage()) {
  return { storage, ex: new Experiments(storage, () => sessionId) };
}

/* ==================== ДЕТЕРМИНИЗМ СИМУЛЯТОРА (INV-S2) ==================== */

describe('симулятор: детерминизм (INV-S2)', () => {
  it('один runId → бит-в-бит идентичный результат (включая текст)', () => {
    const a = runSim({ N: 150, days: 30, runId: 'seed42', mode: 'MC' });
    const b = runSim({ N: 150, days: 30, runId: 'seed42', mode: 'MC' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(toText(a)).toBe(toText(b));
  });

  it('другой runId → другая траектория (сид действительно влияет)', () => {
    const a = runSim({ N: 150, days: 30, runId: 'seed42' });
    const b = runSim({ N: 150, days: 30, runId: 'seed43' });
    expect(toText(a)).not.toBe(toText(b));
  });

  it('COHORT-режим детерминирован и даёт метрики на DAU', () => {
    const a = runSim({ N: 150, days: 30, runId: 'seed42', mode: 'COHORT' }) as McSummary;
    const b = runSim({ N: 150, days: 30, runId: 'seed42', mode: 'COHORT' }) as McSummary;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.aggregates.adArpdau).toBeGreaterThan(0);
    expect(a.aggregates.rwTotal).toBeGreaterThan(0);
  });
});

/* =============== ЭКВИВАЛЕНТНОСТЬ ПОРТУ (vs prototype/sim.js) ============= */

describe('порт 1:1: значения совпадают с node prototype/sim.js seed42 200', () => {
  it('REF: T-1 точный, чекпоинты и первое «дно» — как у прототипа', () => {
    const ref = runSim({ days: 30, runId: 'seed42', mode: 'REF' }) as RefSummary;
    expect(ref.ref.t1Pass).toBe(true);
    expect(ref.ref.earnExact).toBe(true);
    expect(ref.ref.checkpoints.map((c) => c.sim)).toEqual([564, 1719, 1903, 1264, 378, 641]);
    expect(ref.ref.checkpointsWithin8).toBe(4);
    expect(ref.ref.checkpointsWithin12).toBe(6);
    expect(ref.ref.d30).toBe(641);
    expect(ref.ref.d30Ok).toBe(true);
    expect(ref.ref.firstDeficitDay).toBe(28);
    expect(ref.ref.t2Pass).toBe(true);
  });

  it('MC N=200: агрегаты бит-в-бит с прототипом', () => {
    const mc = runSim({ N: 200, days: 30, runId: 'seed42', mode: 'MC' }) as McSummary;
    const ag = mc.aggregates;
    expect(ag.balanceD30Median).toBe(6286);
    expect(ag.firstDeficitMedian).toBe(31);
    expect(ag.windowShifted).toBe(true);
    expect(ag.ratioMean.toFixed(3)).toBe('1.396');
    expect(ag.adArpdau.toFixed(4)).toBe('0.0618');
    expect(ag.rwTotal.toFixed(2)).toBe('2.02');
    expect(ag.hintsD14.lamp.toFixed(2)).toBe('0.97');
    expect(ag.hintsD14.scope.toFixed(2)).toBe('0.34');
    expect(ag.hintsD14.rocket.toFixed(2)).toBe('0.30');
    expect(mc.flags).toHaveLength(4); // КНИГА + ratio>1.20 + M-9 + M-12
  });

  it('COHORT N=200: строка CLI бит-в-бит с прототипом', () => {
    const coh = runSim({ N: 200, days: 30, runId: 'seed42', mode: 'COHORT' }) as McSummary;
    const ag = coh.aggregates;
    expect(ag.rwTotal.toFixed(2)).toBe('2.62');
    expect(ag.adArpdau.toFixed(4)).toBe('0.0696');
    expect(ag.ratioMean.toFixed(3)).toBe('1.174');
    expect(ag.balanceD30Median).toBe(6276);
  });

  it('структура сводки: 30 дней, чекпоинты 1/7/14/21/27/30, конечные числа', () => {
    const s = runSim({ N: 120, days: 30, runId: 'seed42' }) as McSummary;
    expect(s.byDay).toHaveLength(30);
    expect([...CHECKPOINTS]).toEqual([1, 7, 14, 21, 27, 30]);
    for (const r of s.byDay) {
      expect(Number.isFinite(r.balanceMedianCore)).toBe(true);
      expect(Number.isFinite(r.earnMean)).toBe(true);
      expect(Number.isFinite(r.spendMean)).toBe(true);
    }
  });
});

/* ==================== СЕГМЕНТЫ И ОПОРНЫЕ КРИВЫЕ ========================= */

describe('сегменты беглость×вовлечённость (12 §2)', () => {
  it('Σ долей популяции = 1.00 (12 §2.1)', () => {
    expect(assertShares()).toBe(true);
    let sum = 0;
    for (const sk of SKILL_ORDER) for (const fq of FREQ_ORDER) sum += SHARES[sk][fq];
    expect(sum).toBeCloseTo(1.0, 9);
    const s = runSim({ N: 120, days: 5, runId: 'shares' });
    expect(s.meta.sharesOk).toBe(true);
  });

  it('таблица сегментов: 9 ячеек, MEDIAN×CORE = 0.30', () => {
    const rows = segmentTable();
    expect(rows).toHaveLength(9);
    const medianCore = rows.find((r) => r.skill === 'MEDIAN' && r.freq === 'CORE');
    expect(medianCore?.share).toBe(0.3);
  });

  it('кривая удержания 09 §4.2: R(1)=0.42, монотонно убывает', () => {
    expect(retentionAt(1)).toBeCloseTo(0.42, 9);
    expect(retentionAt(7)).toBeLessThan(retentionAt(2));
    expect(retentionAt(30)).toBeLessThan(retentionAt(7));
  });

  it('mergeTune: переопределения применяются, частичный ecpm дополняется книгой', () => {
    const t = mergeTune({ spendScale: 6, ecpm: { rw: 17.8 } });
    expect(t.spendScale).toBe(6);
    expect(t.ecpm.rw).toBe(17.8);
    expect(t.ecpm.int).toBe(BOOK_TUNE.ecpm.int);
    expect(t.ecpm.banner).toBe(BOOK_TUNE.ecpm.banner);
    expect(mergeTune().lampPrice).toBe(100); // номиналы книги на месте
  });
});

/* ======================= A/B-ФРЕЙМВОРК (09 §1.2) ======================== */

describe('A/B: детерминированное назначение по session-id', () => {
  it('variantIndexFor стабилен и зависит и от сессии, и от эксперимента', () => {
    expect(variantIndexFor('s1', 'hint_price', 2)).toBe(variantIndexFor('s1', 'hint_price', 2));
    const perExp = EXPERIMENTS.map((e) => variantIndexFor('s1', e.id, e.variants.length));
    expect(perExp).toHaveLength(3);
  });

  it('пул прототипа 1:1: цена Лампы / триал / INT-кап', () => {
    expect(EXPERIMENTS.map((e) => e.id)).toEqual(['hint_price', 'sub_trial', 'int_cap']);
    expect(EXPERIMENTS[0]?.variants.map((v) => v.over.lampPrice)).toEqual([100, 80]);
    expect(EXPERIMENTS[1]?.variants.map((v) => v.over.trialDays)).toEqual([7, 3]);
    expect(EXPERIMENTS[2]?.variants.map((v) => v.over.intPerDau)).toEqual([3.2, 4.0]);
  });

  it('одна сессия всегда получает те же варианты; строка ab_groups стабильна', () => {
    const { ex } = makeExperiments('stable-session');
    const a = ex.getAssignments();
    const b = ex.getAssignments();
    expect(a).toEqual(b);
    expect(ex.abGroupsString()).toBe(a.map((x) => x.exp + '=' + x.variant).join(', '));
  });

  it('applyAB: overrides назначенных вариантов попадают в прогон', () => {
    const { ex } = makeExperiments('ab-session');
    expect(ex.buildOverrides()).toEqual({}); // по умолчанию — чистый baseline
    ex.setApplyAB(true);
    const over = ex.buildOverrides();
    expect(over.lampPrice === 100 || over.lampPrice === 80).toBe(true);
    expect(over.trialDays === 7 || over.trialDays === 3).toBe(true);
    // Ручной тюнинг важнее A/B.
    ex.setKnob('intPerDau', 4.6);
    expect(ex.buildOverrides().intPerDau).toBe(4.6);
  });

  it('session-id персистится при первом минте (стабильность бакета)', () => {
    const storage = new MemStorage();
    const first = new Experiments(storage, () => 'minted-once');
    expect(first.sessionId).toBe('minted-once');
    // Повторная загрузка с тем же storage, но другим генератором — id прежний.
    const second = new Experiments(storage, () => 'would-be-new');
    expect(second.sessionId).toBe('minted-once');
    const raw = JSON.parse(storage.getItem(SOFTLAUNCH_KEY) as string) as { sessionId: string };
    expect(raw.sessionId).toBe('minted-once');
  });
});

/* =========================== ГЕЙТЫ (09 §4.3) ============================ */

describe('гейты go/iterate/kill (09 §4.3) + подписочная модель', () => {
  const base = RET_SCENARIOS.base;

  it('sub-ARPDAU: формула 06 §8.3 (книга ≈ $0.019)', () => {
    const v = subArpdauFor(base, SUB_MODEL.trialConv, SUB_MODEL.trialRate);
    expect(v).toBeCloseTo(0.0188, 3); // ≈ цель 06 §8.3 ($0.019)
  });

  it('когорта на цели → «серая зона» держится на подписочной доле', () => {
    const G = evaluateGates({
      scn: base,
      adArpdau: 0.0696, // COHORT seed42/200
      trialConv: 0.55,
      trialRate: 0.026,
      iapArpdau: 0.011,
      cpi: 1.2,
      flags: [],
      iterateCount: 0
    });
    expect(G.verdicts.d1).toBe('scale');
    expect(G.verdicts.arpdau).toBe('scale'); // blended ≈ $0.099 ≥ $0.085
    expect(G.verdicts.roas365).toBe('scale');
    expect(G.verdicts.roas7).toBe('scale');
    expect(G.verdicts.subShare).toBe('iterate'); // ≈19% < цели 22%
    expect(G.verdict).toBe('iterate');
  });

  it('нулевой прогон НЕ даёт ложный GO: ARPDAU ниже kill-порога → kill', () => {
    const G = evaluateGates({
      scn: base,
      adArpdau: 0, // симуляцию не гоняли
      trialConv: 0.55,
      trialRate: 0.026,
      iapArpdau: 0.011,
      cpi: 1.2,
      flags: [],
      iterateCount: 0
    });
    expect(G.blended).toBeLessThan(GATES.arpdau.kill);
    expect(G.verdicts.arpdau).toBe('kill');
    expect(G.verdict).toBe('kill');
  });

  it('находки-дизайн симулятора удерживают от scale (12 §8.4)', () => {
    const clean = evaluateGates({
      scn: RET_SCENARIOS.optim,
      adArpdau: 0.09,
      trialConv: 0.55,
      trialRate: 0.06, // подписочная доля ≥22% → все гейты на scale
      iapArpdau: 0.011,
      cpi: 0.6,
      flags: [],
      iterateCount: 0
    });
    expect(clean.verdict).toBe('scale');
    const flagged = evaluateGates({
      scn: RET_SCENARIOS.optim,
      adArpdau: 0.09,
      trialConv: 0.55,
      trialRate: 0.06,
      iapArpdau: 0.011,
      cpi: 0.6,
      flags: ['НАХОДКА-ДИЗАЙН (M-12)…'],
      iterateCount: 0
    });
    expect(flagged.verdict).toBe('iterate');
  });

  it('чувствительность подписки: обвал триала вдвое роняет ROAS(365)', () => {
    const G = evaluateGates({
      scn: base,
      adArpdau: 0.0696,
      trialConv: 0.55,
      trialRate: 0.026,
      iapArpdau: 0.011,
      cpi: 1.2,
      flags: [],
      iterateCount: 0
    });
    expect(G.sens.roas365Half).toBeLessThan(G.roas365);
    expect(G.sens.roas365NoSub).toBeLessThan(G.sens.roas365Half);
    expect(G.sens.killPct).toBeGreaterThan(0);
  });

  it('кокпит: runBoth → COHORT-когорта питает гейты, вердикт определён', () => {
    const { ex } = makeExperiments('gate-session');
    ex.setSimN(100);
    ex.runBoth();
    const G = ex.computeGates();
    expect(G.adArpdau).toBeGreaterThan(0);
    expect(['kill', 'iterate', 'scale']).toContain(G.verdict);
    expect(G.iterateLimit).toBe(MAX_ITERATE);
    // Прогон детерминирован: тот же session-id → тот же ad-ARPDAU.
    const again = makeExperiments('gate-session').ex;
    again.setSimN(100);
    again.runBoth();
    expect(again.computeGates().adArpdau).toBe(G.adArpdau);
  });

  it('A/B-сравнение: детерминировано, у sub_trial первичная — sub-ARPDAU', () => {
    const { ex } = makeExperiments('cmp-session');
    ex.setSimN(100);
    const res = ex.compareExperiment('sub_trial');
    expect(res).not.toBeNull();
    if (res === null) return;
    expect(res.rows).toHaveLength(2);
    // Триал 3 дня конвертит выше (0.62 vs 0.55) → sub-ARPDAU варианта B выше.
    expect(res.rows[1]?.subArpdau).toBeGreaterThan(res.rows[0]?.subArpdau ?? 0);
    expect(res.deltaPrimaryPct).toBeGreaterThan(0);
    const res2 = ex.compareExperiment('sub_trial');
    expect(JSON.stringify(res2)).toBe(JSON.stringify(res));
  });
});

/* ==================== САНИТАЙЗИНГ wordgrove_softlaunch ==================== */

describe('сейв wordgrove_softlaunch: схема и санитайзинг (порт experiments.js)', () => {
  it('null/мусор → дефолты (cpi 1.20, iapArpdau 0.011, trialRate 0.026)', () => {
    expect(sanitizeSoftlaunch(null)).toEqual(softlaunchDefaults());
    expect(sanitizeSoftlaunch('junk')).toEqual(softlaunchDefaults());
    const d = softlaunchDefaults();
    expect(d.cpi).toBe(1.2);
    expect(d.iapArpdau).toBe(0.011);
    expect(d.trialRate).toBe(0.026);
    expect(d.simN).toBe(300);
  });

  it('битые значения клипуются; чужие tune-ключи отбрасываются (INV-S1)', () => {
    const s = sanitizeSoftlaunch({
      v: 'x',
      sessionId: 42,
      tune: { spendScale: '6.5', lampPrice: 50, hackKey: 1, ecpm: { rw: '15', mars: 9 } },
      retScenario: 'weird',
      cpi: 'abc',
      iapArpdau: -5,
      trialRate: 'x',
      iterateCount: -3,
      simN: 5000,
      applyAB: 'yes'
    });
    expect(s.sessionId).toBe('');
    expect(s.tune).toEqual({ spendScale: 6.5, ecpm: { rw: 15 } }); // lampPrice/hackKey — отброс
    expect(s.retScenario).toBe('base');
    expect(s.cpi).toBe(1.2);
    expect(s.iapArpdau).toBe(0);
    expect(s.trialRate).toBe(0.026);
    expect(s.iterateCount).toBe(0);
    expect(s.simN).toBe(400); // клип 100–400
    expect(s.applyAB).toBe(false); // только строгий true
  });

  it('битый JSON в ключе → кокпит стартует с дефолтов', () => {
    const storage = new MemStorage();
    storage.setItem(SOFTLAUNCH_KEY, '{"v":1, СЛОМАНО');
    const ex = new Experiments(storage, () => 'fresh');
    expect(ex.sessionId).toBe('fresh');
    expect(ex.getState().tune).toEqual({});
  });

  it('ручки: правка/сброс/подсветка; iterate-счётчик с лимитом 2', () => {
    const { ex } = makeExperiments('knob-session');
    expect(ex.isKnobEdited('spendScale')).toBe(false);
    ex.setKnob('spendScale', 6.25);
    expect(ex.knobValue('spendScale')).toBe(6.25);
    expect(ex.isKnobEdited('spendScale')).toBe(true);
    ex.setKnob('ecpm.rw', 17.8);
    expect(ex.knobValue('ecpm.rw')).toBe(17.8);
    ex.resetKnob('spendScale');
    expect(ex.knobValue('spendScale')).toBe(BOOK_TUNE.spendScale);
    ex.resetAll();
    expect(ex.knobValue('ecpm.rw')).toBe(BOOK_TUNE.ecpm.rw);
    ex.incIterate();
    ex.incIterate();
    ex.incIterate(); // сверх лимита — не растёт
    expect(ex.getState().iterateCount).toBe(MAX_ITERATE);
    ex.resetIterate();
    expect(ex.getState().iterateCount).toBe(0);
  });
});
