/**
 * Хранилище состояния монетизации (Проход Е.2, порт window.MonStore).
 * ОТДЕЛЬНЫЙ ключ 'blocksurge_monetize' (тот же префикс игры): схему Прохода Б
 * ('blocksurge_meta') и рекорд ('blocksurge_best') не трогает. Отсутствие
 * ключа/полей → дефолты (sanitizeMonetize), старые сейвы игру не ломают.
 *
 * Backend хранения инжектируется (KeyValueStorage), как у Store Е.1:
 * в браузере — localStorage, в тестах — in-memory.
 */
import { MONETIZE } from './config';
import { monetizeDefaults, sanitizeMonetize, type MonetizeSave } from './save';
import { defaultStorage, type KeyValueStorage } from '../economy/store';

export class MonetizeStore {
  /** Текущее состояние; мутируется MonetizeController, сохраняется save(). */
  state: MonetizeSave;

  constructor(private readonly storage: KeyValueStorage = defaultStorage()) {
    this.state = this.load();
  }

  private load(): MonetizeSave {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(MONETIZE.STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (raw !== null) {
      try {
        return sanitizeMonetize(JSON.parse(raw));
      } catch {
        return monetizeDefaults(); // повреждённый JSON → чистый старт, без краша
      }
    }
    return monetizeDefaults();
  }

  save(): void {
    try {
      this.storage.setItem(MONETIZE.STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      /* приватный режим / переполнение — игра продолжается */
    }
  }

  /** Полный сброс (отладка). */
  reset(): MonetizeSave {
    this.state = monetizeDefaults();
    this.save();
    return this.state;
  }
}
