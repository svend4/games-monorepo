/**
 * Хранилище состояния монетизации (Проход Е.2, порт load()/save() из прототипа
 * monetize.js). ОТДЕЛЬНЫЙ ключ 'orchardPeaks.monetize' (тот же, что в
 * прототипе): схему Прохода Б ('orchardPeaks.meta') не трогает. Отсутствие
 * ключа/полей → дефолты (deepMerge + sanitizeMonetize), старые сейвы игру
 * не ломают.
 *
 * Backend хранения инжектируется (KeyValueStorage), как у Store Е.1:
 * в браузере — localStorage, в тестах — in-memory.
 */
import { MON } from './config';
import { monetizeDefaults, sanitizeMonetize, type MonetizeSave } from './save';
import { deepMerge } from '../economy/save';
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
      raw = this.storage.getItem(MON.STORE_KEY);
    } catch {
      raw = null;
    }
    if (raw !== null) {
      try {
        // Двухступенчато, как в прототипе: deepMerge дефолтов → санитизация типов.
        return sanitizeMonetize(deepMerge(monetizeDefaults(), JSON.parse(raw)));
      } catch {
        return monetizeDefaults(); // повреждённый JSON → чистый старт, без краша
      }
    }
    return monetizeDefaults();
  }

  save(): void {
    try {
      this.storage.setItem(MON.STORE_KEY, JSON.stringify(this.state));
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
