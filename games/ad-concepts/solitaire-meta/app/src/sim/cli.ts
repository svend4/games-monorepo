/**
 * Headless-запуск симулятора экономики (Проход Е.3):
 *   npm run sim -- [seed] [N]
 * Например: `npm run sim -- seed42 200` (seed принимает и «42», и «seed42»).
 *
 * Тот же расчётный код, что в браузерном кокпите (src/sim/sim.ts — один
 * модуль, два входа): печатает текстовую сводку в stdout БИТ-В-БИТ с
 * прототипом (`node ../prototype/sim.js` — N=2000, seed=1000; произвольные
 * seed/N — через API prototype/sim.js `run({N, days:30, seed})`, тест
 * tests/sim.test.ts сравнивает вывод с прототипом побайтово).
 *
 * Дефолты прототипа: seed=1000, N=2000, 30 дней.
 */
import { formatSummary, run } from './sim';

const seedArg = process.argv[2];
const seedMatch = seedArg !== undefined ? /-?\d+/.exec(seedArg) : null;
const seed = seedMatch !== null ? Number.parseInt(seedMatch[0], 10) : 1000;

const parsedN = Number.parseInt(process.argv[3] ?? '', 10);
const N = Number.isFinite(parsedN) && parsedN > 0 ? parsedN : 2000;

const res = run({ N, days: 30, seed });
process.stdout.write(formatSummary(res) + '\n');
