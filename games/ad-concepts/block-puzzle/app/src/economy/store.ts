/**
 * Хранилище мета-состояния (Проход Е.2, порт window.Store из economy.js).
 * Единый JSON-документ в ключе 'blocksurge_meta' — экономика и мета живут
 * вместе: атомарное сохранение, никаких рассинхронов.
 *
 * Backend хранения инжектируется (KeyValueStorage): в браузере — localStorage,
 * в тестах — in-memory. Приватный режим/переполнение квоты не роняют игру.
 */
import { ECON } from './econ';
import { deepMerge, defaults, sanitize, type SaveState } from './save';

/** Минимальный контракт хранилища (подмножество Web Storage). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** localStorage, если доступен; иначе — in-memory заглушка (SSR/тесты/приватный режим).
 * Экспортируется: MonetizeStore (Проход Е.2) использует тот же backend. */
export function defaultStorage(): KeyValueStorage {
  try {
    if (typeof localStorage !== 'undefined' && localStorage !== null) return localStorage;
  } catch {
    /* доступ к localStorage может бросить в приватном режиме */
  }
  const mem = new Map<string, string>();
  return {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => {
      mem.set(k, v);
    }
  };
}

export class Store {
  /** Текущее мета-состояние; мутируется слоями Economy/Meta, сохраняется save(). */
  state: SaveState;

  private loadedExisting = false;

  constructor(private readonly storage: KeyValueStorage = defaultStorage()) {
    this.state = this.load();
  }

  private load(): SaveState {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(ECON.STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (raw !== null) {
      try {
        const parsed: unknown = JSON.parse(raw);
        const state = sanitize(deepMerge(defaults(), parsed));
        state._fresh = false;
        this.loadedExisting = true;
        return state;
      } catch {
        return defaults(); // повреждённый JSON → чистый старт, без краша
      }
    }
    return defaults();
  }

  save(): void {
    try {
      this.storage.setItem(ECON.STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      /* приватный режим / переполнение — игнорируем, игра продолжается */
    }
  }

  /** Совсем новый сейв (ключа не было) — для FTUE-события стартового бонуса. */
  isFreshInstall(): boolean {
    return !this.loadedExisting;
  }

  /** Полный сброс (для отладки/будущих настроек). */
  reset(): SaveState {
    this.state = defaults();
    this.save();
    return this.state;
  }
}
