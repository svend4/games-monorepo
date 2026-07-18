/**
 * Headless-запуск симулятора экономики (Проход Е.3):
 *   npm run sim -- [runId] [N]
 * Например: `npm run sim -- seed42 200`.
 *
 * Тот же расчётный код, что в браузере (src/sim/sim.ts — один модуль, два
 * входа). Печатает REF + MC сводки и короткую COHORT-строку в stdout —
 * БИТ-В-БИТ как `node ../prototype/sim.js [runId] [N]` (дефолты прототипа:
 * runId='cli', N=300).
 */
import { runSim, toText, type McSummary } from './sim';

const runId = process.argv[2] || 'cli';
const N = Number.parseInt(process.argv[3] ?? '', 10) || 300;

const ref = runSim({ days: 30, runId, mode: 'REF' });
process.stdout.write(toText(ref) + '\n\n');

const mc = runSim({ N, days: 30, runId, mode: 'MC' });
process.stdout.write(toText(mc) + '\n\n');

const cohort = runSim({ N, days: 30, runId, mode: 'COHORT' }) as McSummary;
process.stdout.write(' COHORT (метрики на DAU, кривая удержания R(t)=0,42·t^(−0,435), 09 §4.2):\n');
const cag = cohort.aggregates;
process.stdout.write('   Σ rewarded/DAU = ' + cag.rwTotal.toFixed(2) +
  '  ·  ad-ARPDAU = $' + cag.adArpdau.toFixed(4) +
  '  ·  earn/spend = ' + cag.ratioMean.toFixed(3) +
  '  ·  медиана D30 = ' + cag.balanceD30Median + '\n');
