/**
 * Генератор миссий дня (порт из meta.js): детерминированный выбор 3 миссий
 * из пула по дате. Свой RNG-сид, независимый от RNG партии: hashStr прототипа —
 * это FNV-1a 32 бит (fnv1a32 ядра), перемешивание — Фишер–Йетс на mulberry32.
 */
import { fnv1a32, mulberry32 } from '../core/rng';
import { MISSION_POOL, type MissionDef } from './config';

/** 3 id миссий на дату 'YYYY-MM-DD' — одна дата → один и тот же набор. */
export function rollMissions(dateStr: string): string[] {
  const rnd = mulberry32(fnv1a32('missions:' + dateStr));
  const pool = MISSION_POOL.slice();
  // перемешивание Фишера–Йетса на детерминированном RNG
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, 3).map((m) => m.id);
}

/** id → определение миссии из пула (null для неизвестных id из старых сейвов). */
export function missionDef(id: string): MissionDef | null {
  for (const m of MISSION_POOL) {
    if (m.id === id) return m;
  }
  return null;
}
