/**
 * Хранилище состояния монетизации (Проход Е.2, порт window.WGMonStore).
 * ОТДЕЛЬНЫЙ ключ 'wordgrove.monetize.v1' (тот же префикс игры): сейвы ядра
 * ('wordgrove.save.v1'), экономики ('wordgrove.economy.v1') и меты
 * ('wordgrove.meta.v1') не трогает. Отсутствие ключа/полей → дефолты
 * (sanitizeMonetize), старые сейвы игру не ломают.
 *
 * Backend хранения инжектируется (KeyValueStorage, как у слоёв Е.1):
 * в браузере — localStorage, в тестах — in-memory.
 */
import { defaultStorage, type KeyValueStorage } from '../core/storage';
import { MONETIZE } from './config';
import { monetizeDefaults, sanitizeMonetize, type MonetizeSave } from './save';

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
