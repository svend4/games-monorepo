/**
 * Тесты симулятора экономики и soft-launch кокпита (Проход Е.3) — чистая
 * логика без DOM. Проверяются: детерминизм прогона (I-E1, один seed →
 * бит-в-бит один результат), ЭКВИВАЛЕНТНОСТЬ ПРОТОТИПУ (formatSummary
 * сравнивается ПОБАЙТОВО с prototype/sim.js — главный критерий верности
 * порта), гейты К1–К8, A/B-назначение по хешу session-id, тюнинг с белым
 * списком и сбросом к книге, гейты go/iterate/kill без ложного GO,
 * совместимость ключей orchardPeaks.tuning/abSession/softScen.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { BOOK, checkGates, formatSummary, mergeParams, run, E, M, W, isStone } from '../src/sim/sim';
import {
  EXPERIMENTS,
  Experiments,
  GO_RULE,
  K_SCENARIO,
  K_SESSION,
  K_TUNING,
  SCENARIOS,
  armIndex,
  assignment,
  evaluateVerdict,
  ltv,
  paybackDay,
  sanitizeTuning
} from '../src/experiments/experiments';
import { MemStorage } from './helpers';

/* Прототип-источник: тот же CommonJS-модуль, что гоняет `node sim.js`. */
interface ProtoSim {
  run(opts: { N: number; days: number; seed: number; params?: Record<string, unknown> }): unknown;
  formatSummary(res: unknown): string;
}
const requireCjs = createRequire(import.meta.url);
const proto = requireCjs('../../prototype/sim.js') as ProtoSim;

function makeExperiments(sessionId = 'sess-test'): { storage: MemStorage; ex: Experiments } {
  const storage = new MemStorage();
  return { storage, ex: new Experiments(storage, () => sessionId) };
}

/* ==================== ДЕТЕРМИНИЗМ (I-E1) ==================== */

describe('симулятор: детерминизм (I-E1)', () => {
  it('один seed → бит-в-бит идентичный результат (включая сводку)', () => {
    const a = run({ N: 150, days: 30, seed: 42 });
    const b = run({ N: 150, days: 30, seed: 42 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(formatSummary(a)).toBe(formatSummary(b));
  });

  it('другой seed → другая траектория (сид действительно влияет)', () => {
    const a = run({ N: 150, days: 30, seed: 42 });
    const b = run({ N: 150, days: 30, seed: 43 });
    expect(formatSummary(a)).not.toBe(formatSummary(b));
  });

  it('структура сводки: 30 дней, конечные числа', () => {
    const s = run({ N: 120, days: 30, seed: 1000 });
    expect(s.byDay).toHaveLength(30);
    for (const r of s.byDay) {
      expect(Number.isFinite(r.medBalance)).toBe(true);
      expect(Number.isFinite(r.medSaldo)).toBe(true);
      expect(Number.isFinite(r.balInEntries)).toBe(true);
    }
    expect(s.ad.adArpdau).toBeGreaterThan(0);
    expect(s.ad.rewardedPerDau).toBeGreaterThan(0);
  });
});

/* ==================== ЭКВИВАЛЕНТНОСТЬ ПРОТОТИПУ ==================== */

describe('порт = прототип: вывод БИТ-В-БИТ (главный критерий Е.3)', () => {
  it('seed42 · N=200: сводка идентична prototype/sim.js побайтово', () => {
    const ours = formatSummary(run({ N: 200, days: 30, seed: 42 }));
    const theirs = proto.formatSummary(proto.run({ N: 200, days: 30, seed: 42 }));
    expect(ours).toBe(theirs);
  });

  it('дефолты CLI (seed=1000, N=120 для скорости): идентичны прототипу', () => {
    const ours = formatSummary(run({ N: 120, days: 30, seed: 1000 }));
    const theirs = proto.formatSummary(proto.run({ N: 120, days: 30, seed: 1000 }));
    expect(ours).toBe(theirs);
  });

  it('оверрайды параметров (A/B-патч) тоже идентичны прототипу', () => {
    const over = { entryGrowth: 1.01, orderCostMult: 0.8, rw3HarvestMult: 1 };
    const ours = formatSummary(run({ N: 150, days: 30, seed: 7, params: over }));
    const theirs = proto.formatSummary(proto.run({ N: 150, days: 30, seed: 7, params: over }));
    expect(ours).toBe(theirs);
  });

  it('формулы книги: E/M/W/камни — контрольные точки [11] §11.5 / [05] §5.2', () => {
    expect(E(1, BOOK)).toBe(350);
    expect(E(100, BOOK)).toBe(1150);
    expect(M(60, BOOK)).toBeCloseTo(1.5, 9);
    expect(W(101, BOOK)).toBeCloseTo(0.55 + 0.35 * Math.exp(-101 / 25), 9); // плато ~55.6%
    expect(isStone(10)).toBe(true);
    expect(isStone(15)).toBe(false);
    expect(W(100, BOOK)).toBeCloseTo(0.55 + 0.35 * Math.exp(-4) - 0.15, 9); // n=100 — «камень»
    expect(W(20, BOOK)).toBeCloseTo(0.55 + 0.35 * Math.exp(-0.8) - 0.15, 9); // камень
  });

  it('mergeParams: оверрайд не мутирует BOOK', () => {
    const P = mergeParams({ entryBase: 999 });
    expect(P.entryBase).toBe(999);
    expect(BOOK.entryBase).toBe(350);
    P.zoneOrderCosts[0][0] = -1; // глубокая копия
    expect(BOOK.zoneOrderCosts[0][0]).toBe(40);
  });
});

/* ==================== ГЕЙТЫ К1–К8 (§12.6) ==================== */

describe('контрольные точки К1–К8', () => {
  it('8 гейтов в порядке прототипа; К3 согласован с wallet.inWindow', () => {
    const res = run({ N: 200, days: 30, seed: 1000 });
    const gates = checkGates(res);
    expect(gates.map((g) => g.id)).toEqual(['К1', 'К2', 'К3', 'К4', 'К5', 'К6', 'К7', 'К8']);
    const k3 = gates[2];
    expect(k3.ok).toBe(res.wallet.inWindow);
    for (const g of gates) {
      expect(typeof g.fact).toBe('string');
      expect(g.fact.length).toBeGreaterThan(0);
    }
  });

  it('книга на большой когорте: точка «Кошелька» в окне 12–16 (гейт К3)', () => {
    const res = run({ N: 400, days: 30, seed: 1000 });
    expect(res.wallet.inWindow).toBe(true);
    expect(res.sinkSourceD14).toBeGreaterThanOrEqual(1.0);
    expect(res.sinkSourceD14).toBeLessThanOrEqual(1.2);
  });
});

/* ==================== A/B-НАЗНАЧЕНИЕ ([09] §9.6) ==================== */

describe('A/B: детерминированное назначение по хешу session-id', () => {
  it('один session-id → стабильные армы; патч собирается из назначенных', () => {
    const a1 = assignment('sess-abc');
    const a2 = assignment('sess-abc');
    expect(JSON.stringify(a1)).toBe(JSON.stringify(a2));
    // Патч содержит по одному значению каждого эксперимента.
    expect(a1.patch.entryGrowth).toBeDefined();
    expect(a1.patch.orderCostMult).toBeDefined();
    expect(a1.patch.rw3HarvestMult).toBeDefined();
    for (const exp of EXPERIMENTS) {
      const idx = armIndex('sess-abc', exp);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(exp.arms.length);
    }
  });

  it('разные session-id покрывают разные армы (распределение работает)', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) seen.add(armIndex('sess-' + i, EXPERIMENTS[1]));
    expect(seen.size).toBe(EXPERIMENTS[1].arms.length); // все 3 арма встречаются
  });

  it('session-id хранится СЫРОЙ строкой в orchardPeaks.abSession (как прототип)', () => {
    const { storage, ex } = makeExperiments('sess-fixed');
    expect(ex.getSessionId()).toBe('sess-fixed');
    expect(storage.getItem(K_SESSION)).toBe('sess-fixed'); // не JSON
    ex.setSessionId('sess-manual');
    expect(storage.getItem(K_SESSION)).toBe('sess-manual');
  });
});

/* ==================== ТЮНИНГ (orchardPeaks.tuning) ==================== */

describe('тюнинг: белый список ручек, сброс к книге, совместимость', () => {
  it('фикстура прототипа: свои ключи читаются, чужие отбрасываются', () => {
    const { storage, ex } = makeExperiments();
    storage.setItem(K_TUNING, JSON.stringify({ entryBase: 400, junk: 9, wrPlateau: 'bad', ecpmInt: 10 }));
    expect(ex.loadTuning()).toEqual({ entryBase: 400, ecpmInt: 10 });
    expect(ex.knobValue('entryBase')).toBe(400);
    expect(ex.knobValue('wrPlateau')).toBe(BOOK.wrPlateau); // битое значение → книга
  });

  it('значение, равное книге, не хранится; сброс возвращает книгу', () => {
    const { storage, ex } = makeExperiments();
    ex.saveTuning({ entryBase: 400, entryGrowth: BOOK.entryGrowth });
    expect(JSON.parse(storage.getItem(K_TUNING) ?? '{}')).toEqual({ entryBase: 400 });
    expect(ex.isKnobEdited('entryBase')).toBe(true);
    expect(ex.isKnobEdited('entryGrowth')).toBe(false);
    ex.resetTuning();
    expect(ex.loadTuning()).toEqual({});
    expect(ex.knobValue('entryBase')).toBe(BOOK.entryBase);
  });

  it('приоритет: ручной тюнинг ПОБЕЖДАЕТ вариант A/B', () => {
    const { ex } = makeExperiments('sess-abc');
    const abValue = ex.currentAssignment().patch.entryGrowth;
    expect(abValue).toBeDefined();
    ex.saveTuning({ entryGrowth: 1.015 });
    const over = ex.effectiveParams(true);
    expect(over.entryGrowth).toBe(1.015); // не A/B-значение
    expect(over.orderCostMult).toBe(ex.currentAssignment().patch.orderCostMult); // A/B остался
  });

  it('sanitizeTuning: не-объекты и мусор не роняют кокпит', () => {
    expect(sanitizeTuning(null)).toEqual({});
    expect(sanitizeTuning([1, 2])).toEqual({});
    expect(sanitizeTuning({ entryBase: Infinity, rw6Grant: 0.6 })).toEqual({ rw6Grant: 0.6 });
  });

  it('прогон кокпита детерминирован и попадает в кэш lastRun', () => {
    const { ex } = makeExperiments('sess-abc');
    const r1 = ex.runSim(120, 1000);
    const r2 = ex.runSim(120, 1000);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    expect(ex.lastRun).not.toBeNull();
    // Патч A/B действительно применён к параметрам прогона.
    const patch = ex.currentAssignment().patch;
    expect(r1.meta.params.entryGrowth).toBe(patch.entryGrowth);
  });
});

/* ==================== ГЕЙТЫ GO / ITERATE / KILL ([09] §9.5) ==================== */

describe('гейты go/no-go: без ложного GO', () => {
  it('юнит-экономика: база проходит GO-пороги по ROAS D30', () => {
    const base = SCENARIOS.base;
    const roasD30 = ltv(30, base) / base.cpi;
    expect(roasD30).toBeGreaterThanOrEqual(GO_RULE.roasD30);
    expect(paybackDay(base)).not.toBeNull();
  });

  it('БЕЗ прогона симулятора GO невозможен даже на оптимисте (нет ложного GO)', () => {
    const opt = SCENARIOS.opt;
    const roasD30 = ltv(30, opt) / opt.cpi;
    const v = evaluateVerdict(opt, roasD30, null, 0);
    expect(v.goMet).toBe(true); // пороги сценария пройдены…
    expect(v.econOk).toBe(false); // …но экономика не подтверждена
    expect(v.verdict).toBe('ITERATE');
    expect(v.reasons.join(' ')).toContain('не прогнан');
  });

  it('база + здоровый прогон книги → GO GLOBAL', () => {
    const { ex } = makeExperiments('sess-go');
    ex.resetTuning();
    // Чистый прогон книги (без A/B): здоровая экономика из §12.6.
    const run0 = run({ N: 300, days: 30, seed: 1000 });
    const base = SCENARIOS.base;
    const roasD30 = ltv(30, base) / base.cpi;
    const v = evaluateVerdict(base, roasD30, run0, 0);
    expect(v.econOk).toBe(true);
    expect(v.verdict).toBe('GO GLOBAL');
  });

  it('пессимист: ITERATE в цикле 0, KILL/PIVOT после 3 циклов', () => {
    const pess = SCENARIOS.pess;
    const roasD30 = ltv(30, pess) / pess.cpi;
    const run0 = run({ N: 200, days: 30, seed: 1000 });
    expect(evaluateVerdict(pess, roasD30, run0, 0).verdict).toBe('ITERATE');
    expect(evaluateVerdict(pess, roasD30, run0, 3).verdict).toBe('KILL / PIVOT');
  });

  it('сценарий хранится сырой строкой в orchardPeaks.softScen; мусор → база', () => {
    const { storage, ex } = makeExperiments();
    expect(ex.getScenario()).toBe('base');
    ex.setScenario('opt');
    expect(storage.getItem(K_SCENARIO)).toBe('opt'); // не JSON
    storage.setItem(K_SCENARIO, 'weird');
    expect(ex.getScenario()).toBe('base');
  });

  it('Experiments.verdict(): полный цикл через контроллер кокпита', () => {
    const { ex } = makeExperiments('sess-verdict');
    ex.setScenario('base');
    expect(ex.verdict().verdict).toBe('ITERATE'); // прогона ещё нет
    ex.resetTuning();
    ex.runSim(300, 1000);
    // Патч A/B может слегка сдвинуть экономику — вердикт остаётся валидным
    // ('GO GLOBAL' | 'ITERATE'), но никогда не GO при непройденной экономике.
    const v = ex.verdict();
    if (v.verdict === 'GO GLOBAL') expect(v.econOk).toBe(true);
    else expect(v.econOk === false || v.goMet === false).toBe(true);
  });
});
