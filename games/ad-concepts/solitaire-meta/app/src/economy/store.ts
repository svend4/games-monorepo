/**
 * Хранилище мета-состояния (порт window.Store из prototype/economy.js).
 * Единый JSON-документ в ключе 'orchardPeaks.meta' — экономика и мета живут
 * вместе: атомарное сохранение, никаких рассинхронов. Монеты дублируются в
 * legacy-ключ 'orchardPeaks.coins' (Проход А) — обратная совместимость.
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

/** localStorage, если доступен; иначе — in-memory заглушка (тесты/приватный режим). */
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

  /** Монеты Прохода А из legacy-ключа (для первого запуска без orchardPeaks.meta). */
  private readLegacyCoins(): number | null {
    try {
      const raw = this.storage.getItem(ECON.LEGACY_COINS);
      if (raw === null) return null;
      const v: unknown = JSON.parse(raw);
      return typeof v === 'number' && isFinite(v) ? v : null;
    } catch {
      return null;
    }
  }

  private load(): SaveState {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(ECON.META_KEY);
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
        return defaults(); // повреждённый JSON → чистый старт без краша
      }
    }
    // Первый запуск прод-порта. Мигрируем монеты Прохода А, если игрок уже играл.
    const state = defaults();
    const legacy = this.readLegacyCoins();
    if (legacy !== null) {
      state.economy.coins = Math.max(0, legacy); // накопленные монеты Прохода А
      state._fresh = false; // не совсем новый игрок
    }
    return state;
  }

  save(): void {
    try {
      this.storage.setItem(ECON.META_KEY, JSON.stringify(this.state));
    } catch {
      /* приватный режим / переполнение — игра продолжается без сейва */
    }
    // Дублируем монеты в legacy-ключ: обратная совместимость с Проходом А.
    try {
      this.storage.setItem(ECON.LEGACY_COINS, JSON.stringify(this.state.economy.coins));
    } catch {
      /* no-op */
    }
  }

  /** Совсем новый сейв (ни meta-ключа, ни legacy-монет) — для FTUE-событий. */
  isFreshInstall(): boolean {
    return !this.loadedExisting && this.state._fresh;
  }

  /** Полный сброс (для отладки/будущих настроек). */
  reset(): SaveState {
    this.state = defaults();
    this.save();
    return this.state;
  }
}
