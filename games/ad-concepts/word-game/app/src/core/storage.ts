/**
 * Минимальный контракт хранилища (подмножество Web Storage) — как в порте
 * Block Surge. Backend инжектируется: в браузере — localStorage, в тестах —
 * in-memory. Приватный режим / переполнение квоты не роняют игру.
 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** localStorage, если доступен; иначе — in-memory заглушка (SSR/тесты/приватный режим). */
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
