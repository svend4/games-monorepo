/**
 * Headless-запуск симулятора экономики (Проход Е.3):
 *   npm run sim -- [runId] [N]
 * Например: `npm run sim -- seed42 200`.
 *
 * Тот же расчётный код, что в браузере (src/sim/sim.ts — один модуль, два
 * входа): печатает текстовую сводку SURVIVOR + короткую COHORT-строку в stdout,
 * как `node sim.js` прототипа. Дефолты прототипа: runId='cli', N=2000.
 */
import { runSim, toText } from './sim';

const runId = process.argv[2] ?? 'cli';
const parsedN = Number.parseInt(process.argv[3] ?? '', 10);
const N = Number.isFinite(parsedN) && parsedN > 0 ? parsedN : 2000;

const survivor = runSim({ N, days: 30, runId, mode: 'SURVIVOR' });
process.stdout.write(toText(survivor) + '\n');

// Короткая COHORT-сводка (метрики «на DAU»: rewarded/DAU, ad-ARPDAU).
const cohort = runSim({ N, days: 30, runId, mode: 'COHORT' });
process.stdout.write('\n COHORT (метрики на DAU, кривая удержания 09 §5.1):\n');
process.stdout.write(
  '   rewarded/DAU = ' + cohort.aggregates.rwPerDauMean.toFixed(2) +
  '  ·  ad-ARPDAU (T1) = $' + cohort.aggregates.adArpdau.toFixed(4) +
  '  ·  earn/spend = ' + cohort.aggregates.ratioMean.toFixed(3) + '\n'
);
