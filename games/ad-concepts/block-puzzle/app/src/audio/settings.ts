/**
 * Настройка «Звук: вкл/выкл» (ПРОХОД З). Чистые парс/сериализация +
 * персист в localStorage через инжектируемый KeyValueStorage (как Store/ftueFlag)
 * — тестируется в node с in-memory хранилищем.
 *
 * Ключ с префиксом игры (blocksurge_*), ПО УМОЛЧАНИЮ ВКЛ: отсутствие ключа
 * или мусор в нём трактуются как «звук включён».
 */
import { defaultStorage, type KeyValueStorage } from '../economy/store';

export const SOUND_KEY = 'blocksurge_sound';

/** Чистый парс сохранённого значения: только явное 'off' выключает звук. */
export function parseSoundEnabled(stored: string | null): boolean {
  return stored !== 'off';
}

/** Обратная сериализация для персиста. */
export function serializeSoundEnabled(on: boolean): string {
  return on ? 'on' : 'off';
}

/** Прочитать настройку (ошибки storage → дефолт ВКЛ). */
export function loadSoundEnabled(storage: KeyValueStorage = defaultStorage()): boolean {
  try {
    return parseSoundEnabled(storage.getItem(SOUND_KEY));
  } catch {
    return true; // приватный режим — играем со звуком по умолчанию
  }
}

/** Сохранить настройку (ошибки storage не роняют игру). */
export function saveSoundEnabled(on: boolean, storage: KeyValueStorage = defaultStorage()): void {
  try {
    storage.setItem(SOUND_KEY, serializeSoundEnabled(on));
  } catch {
    /* приватный режим/квота — настройка поживёт в памяти до перезагрузки */
  }
}
