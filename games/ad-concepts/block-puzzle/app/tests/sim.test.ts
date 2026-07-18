/**
 * Тесты симулятора экономики и soft-launch кокпита (Проход Е.3) — чистая
 * логика без Phaser/DOM. Проверяются: детерминизм прогона (INV-E2, один runId
 * → бит-в-бит один результат, включая сериализованный вывод), доли сегментов
 * Σ=1 (12 §2.1), детерминизм и распределение A/B-назначений, гейты 09 §5.4
 * (сценарий База → вердикт по порогам; нулевой прогон не даёт ложный GO),
 * санитайзинг сейва blocksurge_softlaunch (схема прототипа experiments.js).
 */
import { describe, expect, it } from 'vitest';
import {
  BOOK_TUNE,
  CHECKPOINTS,
  FREQ_ORDER,
  SHARES,
  SKILL_ORDER,
  assertShares
} from '../src/sim/constants';
import { mergeTune, retentionAt, runSim, segmentTable, toText } from '../src/sim/sim';
import {
  EXPERIMENTS,
  Experiments,
  GATES,
  MAX_ITERATE,
  RET_SCENARIOS,
  evaluateGates,
  variantIndexFor
} from '../src/experiments/experiments';
import { SOFTLAUNCH_KEY, sanitizeSoftlaunch, softlaunchDefaults } from '../src/experiments/save';
import type { KeyValueStorage } from '../src/economy/store';

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

/* ==================== ДЕТЕРМИНИЗМ СИМУЛЯТОРА (INV-E2) ==================== */

describe('симулятор: детерминизм (INV-E2)', () => {
  it('один runId → бит-в-бит идентичный результат (включая сериализацию)', () => {
    const a = runSim({ N: 150, days: 30, runId: 'seed42', mode: 'SURVIVOR' });
    const b = runSim({ N: 150, days: 30, runId: 'seed42', mode: 'SURVIVOR' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(toText(a)).toBe(toText(b));
  });

  it('другой runId → другая траектория (сид действительно влияет)', () => {
    const a = runSim({ N: 150, days: 30, runId: 'seed42' });
    const b = runSim({ N: 150, days: 30, runId: 'seed43' });
    expect(toText(a)).not.toBe(toText(b));
  });

  it('COHORT-режим детерминирован и даёт метрики на DAU', () => {
    const a = runSim({ N: 150, days: 30, runId: 'seed42', mode: 'COHORT' });
    const b = runSim({ N: 150, days: 30, runId: 'seed42', mode: 'COHORT' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.aggregates.adArpdau).toBeGreaterThan(0);
    expect(a.aggregates.rwPerDauMean).toBeGreaterThan(0);
  });

  it('структура сводки: 30 дней, чекпоинты 12 §8.1, конечные числа', () => {
    const s = runSim({ N: 120, days: 30, runId: 'seed42' });
    expect(s.byDay).toHaveLength(30);
    expect(s.checkpoints.map((c) => c.day)).toEqual([...CHECKPOINTS]);
    for (const r of s.byDay) {
      expect(Number.isFinite(r.balanceMedianBaseCore)).toBe(true);
      expect(Number.isFinite(r.earnMean)).toBe(true);
      expect(Number.isFinite(r.spendMean)).toBe(true);
    }
  });
});

/* ==================== СЕГМЕНТЫ И ОПОРНЫЕ КРИВЫЕ ========================= */

describe('сегменты скилл×частота (12 §2)', () => {
  it('Σ долей популяции = 1.00 (12 §2.1)', () => {
    expect(assertShares()).toBe(true);
    let sum = 0;
    for (const sk of SKILL_ORDER) for (const fq of FREQ_ORDER) sum += SHARES[sk][fq];
    expect(sum).toBeCloseTo(1.0, 9);
    const s = runSim({ N: 120, days: 5, runId: 'shares' });
    expect(s.meta.sharesOk).toBe(true);
  });

  it('таблица сегментов: 9 ячеек в детерминированном порядке, BASE×CORE = 0.26', () => {
    const rows = segmentTable();
    expect(rows).toHaveLength(9);
    const baseCore = rows.find((r) => r.skill === 'BASE' && r.freq === 'CORE');
    expect(baseCore?.share).toBe(0.26);
  });

  it('кривая удержания 09 §5.1: D1=38%, D7=15%, хвост 6%', () => {
    expect(retentionAt(1)).toBe(38);
    expect(retentionAt(7)).toBeCloseTo(0.15, 9);
    expect(retentionAt(60)).toBeCloseTo(0.06, 9);
  });

  it('mergeTune: частичный ecpm-override не обнуляет остальные под-ключи', () => {
    const t = mergeTune({ ecpm: { rw: 10 } });
    expect(t.ecpm.rw).toBe(10);
    expect(t.ecpm.int).toBe(BOOK_TUNE.ecpm.int);
    expect(t.ecpm.banner).toBe(BOOK_TUNE.ecpm.banner);
    // и не мутирует книгу
    expect(BOOK_TUNE.ecpm.rw).toBe(16.0);
  });
});

/* ============================ A/B-НАЗНАЧЕНИЕ ============================= */

describe('A/B-фреймворк (09 §6): детерминизм и распределение', () => {
  it('один session-id → всегда один и тот же вариант (и после перезагрузки)', () => {
    const { storage, ex } = makeExperiments('sess-fixed');
    const first = ex.getAssignments();
    expect(ex.getAssignments()).toEqual(first);
    // «Перезагрузка»: новый инстанс над тем же storage читает тот же session-id.
    const ex2 = new Experiments(storage, () => 'DIFFERENT-would-be-wrong');
    expect(ex2.sessionId).toBe('sess-fixed');
    expect(ex2.getAssignments()).toEqual(first);
  });

  it('распределение по 1000 session-id ≈ 50/50 (±10 п.п.) для всех 3 экспериментов', () => {
    for (const exp of EXPERIMENTS) {
      let bCount = 0;
      for (let i = 0; i < 1000; i++) {
        if (variantIndexFor('session-' + i, exp.id, exp.variants.length) === 1) bCount++;
      }
      const shareB = bCount / 1000;
      expect(shareB).toBeGreaterThanOrEqual(0.4);
      expect(shareB).toBeLessThanOrEqual(0.6);
    }
  });

  it('пул прототипа 1:1: int_cap 7/5, rw2_mult ×2/×3, start_grant 200/300', () => {
    expect(EXPERIMENTS.map((e) => e.id)).toEqual(['int_cap', 'rw2_mult', 'start_grant']);
    expect(EXPERIMENTS[0]?.variants.map((v) => v.over.intPerDau)).toEqual([7, 5]);
    expect(EXPERIMENTS[1]?.variants.map((v) => v.over.rw2Mult)).toEqual([2, 3]);
    expect(EXPERIMENTS[2]?.variants.map((v) => v.over.startGrant)).toEqual([200, 300]);
  });

  it('приоритет переопределений: A/B-вариант → ручной тюнинг важнее', () => {
    const { ex } = makeExperiments('sess-prio');
    ex.setApplyAB(true);
    const abOnly = ex.buildOverrides();
    // Все три эксперимента дают переопределения своих ручек.
    expect(abOnly.intPerDau).toBeDefined();
    expect(abOnly.rw2Mult).toBeDefined();
    expect(abOnly.startGrant).toBeDefined();
    // Ручной тюнинг перекрывает A/B.
    ex.setKnob('startGrant', 400);
    expect(ex.buildOverrides().startGrant).toBe(400);
  });
});

/* ============================ ГЕЙТЫ (09 §5.4) ============================ */

describe('гейты go/iterate/kill (09 §5.4)', () => {
  it('сценарий База + здоровый ad-ARPDAU → GO/SCALE (все пороги 1:1)', () => {
    const g = evaluateGates({
      scenario: RET_SCENARIOS.base,
      adArpdau: 0.12,
      iapArpdau: 0.045,
      cpi: 0.9,
      flags: [],
      iterateCount: 0
    });
    // LT7 = 1 + (38+30+25+22+19+17+15)/100 = 2.66 (09 §5.2)
    expect(g.lt7).toBeCloseTo(2.66, 9);
    expect(g.roas7).toBeCloseTo((2.66 * (0.12 + 0.045)) / 0.9 * 100, 6);
    expect(g.verdicts.d1).toBe('scale'); // 38 ≥ 38
    expect(g.verdicts.d7).toBe('scale'); // 15 ≥ 15
    expect(g.verdicts.adArpdau).toBe('scale'); // 0.12 ≥ 0.10
    expect(g.verdicts.roas7).toBe('scale'); // 48.8% ≥ 40%
    expect(g.verdict).toBe('scale');
  });

  it('красные флаги дизайна удерживают от scale → iterate (12 §8.4)', () => {
    const g = evaluateGates({
      scenario: RET_SCENARIOS.base,
      adArpdau: 0.12,
      iapArpdau: 0.045,
      cpi: 0.9,
      flags: ['M2 > 1.15: инфляция'],
      iterateCount: 0
    });
    expect(g.verdict).toBe('iterate');
  });

  it('пессимист: D1 32 / D7 11 — серая зона → iterate', () => {
    const g = evaluateGates({
      scenario: RET_SCENARIOS.pess,
      adArpdau: 0.12,
      iapArpdau: 0.045,
      cpi: 0.9,
      flags: [],
      iterateCount: 0
    });
    expect(g.verdicts.d1).toBe('iterate'); // 30 ≤ 32 < 38
    expect(g.verdicts.d7).toBe('iterate'); // 9 ≤ 11 < 15
    expect(g.verdict).toBe('iterate');
  });

  it('ad-ARPDAU ниже kill-порога 0.06 → вердикт KILL', () => {
    const g = evaluateGates({
      scenario: RET_SCENARIOS.optim,
      adArpdau: 0.05,
      iapArpdau: 0.045,
      cpi: 0.9,
      flags: [],
      iterateCount: 0
    });
    expect(g.verdicts.adArpdau).toBe('kill');
    expect(g.verdict).toBe('kill');
  });

  it('нулевой прогон (ad-ARPDAU=0) НЕ даёт ложный GO', () => {
    const { ex } = makeExperiments('sess-zero');
    const g = ex.computeGates(); // симуляция ещё не гонялась
    expect(g.adArpdau).toBe(0);
    expect(g.verdict).not.toBe('scale');
    expect(g.verdict).toBe('kill'); // 0 < kill-порога $0.06
  });

  it('гейты по реальной COHORT-когорте: вердикт согласован с порогами', () => {
    const { ex } = makeExperiments('sess-run');
    ex.runBoth();
    const g = ex.computeGates();
    expect(g.adArpdau).toBeGreaterThan(GATES.adArpdau.scale); // T1-eCPM книги даёт ≥$0.10
    expect(['scale', 'iterate']).toContain(g.verdict); // без kill: база D1/D7 на scale-порогах
  });

  it('счётчик iterate: лимит ≤2 (10 P7), сброс работает', () => {
    const { ex } = makeExperiments('sess-iter');
    ex.incIterate();
    ex.incIterate();
    ex.incIterate(); // клип на лимите
    expect(ex.getState().iterateCount).toBe(MAX_ITERATE);
    ex.resetIterate();
    expect(ex.getState().iterateCount).toBe(0);
  });
});

/* ================ СЕЙВ blocksurge_softlaunch (санитайзинг) =============== */

describe('сейв blocksurge_softlaunch: схема и санитайзинг (порт experiments.js)', () => {
  it('мусор/не-объект → дефолты прототипа (v1, база, CPI 0.90, N 300)', () => {
    for (const raw of [null, 42, 'str', undefined]) {
      const s = sanitizeSoftlaunch(raw);
      expect(s).toEqual(softlaunchDefaults());
    }
    expect(softlaunchDefaults()).toMatchObject({
      v: 1, retScenario: 'base', cpi: 0.9, iapArpdau: 0.045, iterateCount: 0, simN: 300, applyAB: false
    });
  });

  it('повреждённые поля приводятся к типам, simN клипится в 100–400', () => {
    const s = sanitizeSoftlaunch({
      v: 1,
      sessionId: 'sX',
      retScenario: 'weird',
      cpi: 'abc',
      iapArpdau: -1,
      iterateCount: -3,
      simN: 9999,
      applyAB: 'yes',
      tune: { W_HARD: '1.2', evil: 999, ecpm: { rw: 'nope', int: 12 } }
    });
    expect(s.sessionId).toBe('sX');
    expect(s.retScenario).toBe('base'); // неизвестный сценарий → база
    expect(s.cpi).toBe(0.9);
    expect(s.iapArpdau).toBe(0);
    expect(s.iterateCount).toBe(0);
    expect(s.simN).toBe(400);
    expect(s.applyAB).toBe(false); // только literal true
    // tune: белый список ручек; номиналы/чужие ключи отбрасываются (INV-E1)
    expect(s.tune.W_HARD).toBe(1.2);
    expect('evil' in s.tune).toBe(false);
    expect(s.tune.ecpm).toEqual({ int: 12 }); // rw:'nope' отброшен, int сохранён
  });

  it('кокпит пишет тот же ключ, что прототип, и переживает перезагрузку', () => {
    const storage = new MemStorage();
    const { ex } = makeExperiments('sess-persist', storage);
    ex.setKnob('ecpm.rw', 12);
    ex.setKnob('W_HARD', 1.2);
    ex.setSimN(200);
    const raw = storage.getItem(SOFTLAUNCH_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as Record<string, unknown>;
    expect(parsed.sessionId).toBe('sess-persist');
    // «Перезагрузка» с тем же storage: правки ручек на месте.
    const ex2 = new Experiments(storage, () => 'unused');
    expect(ex2.knobValue('ecpm.rw')).toBe(12);
    expect(ex2.knobValue('W_HARD')).toBe(1.2);
    expect(ex2.getState().simN).toBe(200);
    expect(ex2.isKnobEdited('W_HARD')).toBe(true);
    // Сброс к книге (baseline 12 §8).
    ex2.resetAll();
    expect(ex2.knobValue('ecpm.rw')).toBe(BOOK_TUNE.ecpm.rw);
    expect(ex2.isKnobEdited('W_HARD')).toBe(false);
  });

  it('битый JSON в ключе → дефолты + новый session-id, без краша', () => {
    const storage = new MemStorage();
    storage.setItem(SOFTLAUNCH_KEY, '{broken json');
    const ex = new Experiments(storage, () => 'fresh-id');
    expect(ex.sessionId).toBe('fresh-id');
    expect(ex.getState().simN).toBe(300);
  });
});

/* ==================== A/B-СРАВНЕНИЕ И ЭФФЕКТ РУЧЕК ======================= */

describe('A/B-сравнение и эффект тюнинга (интеграция с симулятором)', () => {
  it('int_cap: вариант B (5/DAU) даёт меньший ad-ARPDAU, чем A (7/DAU)', () => {
    const { ex } = makeExperiments('sess-cmp');
    ex.setSimN(100);
    const res = ex.compareExperiment('int_cap');
    expect(res).not.toBeNull();
    if (res) {
      expect(res.rows).toHaveLength(2);
      expect(res.rows[1]?.adArpdau).toBeLessThan(res.rows[0]?.adArpdau ?? 0);
      expect(res.deltaArpdauPct).toBeLessThan(0);
    }
    expect(ex.compareExperiment('nope')).toBeNull();
  });

  it('тюнинг eCPM применяется к прогону (ad-ARPDAU растёт с eCPM)', () => {
    const lo = runSim({ N: 100, days: 30, runId: 'ecpm-t', mode: 'COHORT', tune: { ecpm: { rw: 8, int: 7 } } });
    const hi = runSim({ N: 100, days: 30, runId: 'ecpm-t', mode: 'COHORT', tune: { ecpm: { rw: 16, int: 14 } } });
    expect(hi.aggregates.adArpdau).toBeGreaterThan(lo.aggregates.adArpdau);
  });
});
