/**
 * Схема сейва ядра 'wordgrove.save.v1' и её санитайзинг.
 *
 * СХЕМА 1:1 С ПРОТОТИПОМ (game.js): { level, coins, revealed, foundBonus,
 * usedHint, rewardGiven } — прогресс из прототипа подхватывается прод-билдом
 * БЕЗ миграции. Санитайзинг повторяет проверки load() прототипа и ужесточает
 * типы значений: level в [0..LEVELS.length], coins — конечное неотрицательное
 * целое, revealed — только метки 1|2, foundBonus — только true.
 */
import { START_COINS } from './config';
import { LEVELS } from './levels';
import type { Revealed } from './types';

export interface CoreSave {
  /** Индекс уровня кампании; level == LEVELS.length => всё пройдено. */
  level: number;
  coins: number;
  /** "r,c" -> 1 (открыто словом) | 2 (открыто подсказкой). */
  revealed: Record<string, Revealed>;
  /** 'СЛОВО' -> true (антифарм: сохраняется при рестарте уровня, 11 §4.2). */
  foundBonus: Record<string, true>;
  /** Была ли подсказка на уровне (для «блестящего прохода»). */
  usedHint: boolean;
  /** Защита от двойной выдачи награды (перезагрузка на экране победы). */
  rewardGiven: boolean;
}

export function coreDefaults(): CoreSave {
  return {
    level: 0,
    coins: START_COINS,
    revealed: {},
    foundBonus: {},
    usedHint: false,
    rewardGiven: false
  };
}

type PlainObject = Record<string, unknown>;

function isPlainObject(v: unknown): v is PlainObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Привести неизвестный JSON к строгой схеме CoreSave (порт load() прототипа). */
export function sanitizeCoreSave(raw: unknown): CoreSave {
  const out = coreDefaults();
  if (!isPlainObject(raw)) return out;

  if (
    typeof raw.level === 'number' &&
    Number.isFinite(raw.level) &&
    raw.level >= 0 &&
    raw.level <= LEVELS.length
  ) {
    out.level = Math.floor(raw.level);
  }
  if (typeof raw.coins === 'number' && Number.isFinite(raw.coins) && raw.coins >= 0) {
    out.coins = Math.floor(raw.coins);
  }
  if (isPlainObject(raw.revealed)) {
    for (const key of Object.keys(raw.revealed)) {
      const v = raw.revealed[key];
      if (v === 2) out.revealed[key] = 2;
      else if (v) out.revealed[key] = 1; // любой truthy — «открыто словом»
    }
  }
  if (isPlainObject(raw.foundBonus)) {
    for (const key of Object.keys(raw.foundBonus)) {
      if (raw.foundBonus[key]) out.foundBonus[key] = true;
    }
  }
  out.usedHint = !!raw.usedHint;
  out.rewardGiven = !!raw.rewardGiven;
  return out;
}
