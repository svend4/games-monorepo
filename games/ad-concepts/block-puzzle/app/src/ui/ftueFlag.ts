/**
 * Флаг «онбординг пройден» (Проход Ж.1, порт из prototype/onboarding.js).
 * ТОТ ЖЕ ключ localStorage `blocksurge_ftue` и ТА ЖЕ схема значения
 * ({ done: true, v: 1, how, ts }), что у прототипа: его сейв подхватывается
 * прод-портом 1:1 — обучение не всплывает повторно. ОТСУТСТВИЕ ключа = показать
 * (совместимо со старыми сейвами Проходов А–Е: у них этого ключа просто нет).
 *
 * Хранилище инжектируется (тесты гоняются в node без DOM); семантика прототипа
 * сохранена: «пройдено» = ключ присутствует с любым truthy-значением.
 */

export const FTUE_KEY = 'blocksurge_ftue';

/** Минимальный контракт localStorage (инжекция в тестах). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // приватный режим/недоступный storage — считаем «не пройдено»
  }
}

export function isFtueDone(storage: KeyValueStorage | null = defaultStorage()): boolean {
  try {
    return storage !== null && !!storage.getItem(FTUE_KEY);
  } catch {
    return false;
  }
}

export function markFtueDone(
  how: 'complete' | 'skip',
  storage: KeyValueStorage | null = defaultStorage()
): void {
  try {
    storage?.setItem(FTUE_KEY, JSON.stringify({ done: true, v: 1, how, ts: Date.now() }));
  } catch {
    /* приватный режим / переполнение — не критично, покажем ещё раз */
  }
}

/** Для отладки/тестов: сбросить флаг, чтобы онбординг всплыл заново. */
export function resetFtueFlag(storage: KeyValueStorage | null = defaultStorage()): void {
  try {
    storage?.removeItem(FTUE_KEY);
  } catch {
    /* no-op */
  }
}
