/**
 * Общие хелперы тестов: in-memory хранилище и «мир» экономики/меты с
 * замороженными часами — чистая логика без DOM/localStorage/реального времени.
 */
import { Analytics } from '../src/economy/analytics';
import { Economy } from '../src/economy/economy';
import { Store, type KeyValueStorage } from '../src/economy/store';
import { Meta } from '../src/meta/meta';
import type { Deal } from '../src/core/types';

export class MemStorage implements KeyValueStorage {
  private readonly m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
}

/** Базовый момент времени тестов: 18.07.2026, середина недели weekKey. */
export const BASE_MS = new Date(2026, 6, 18, 12).getTime();

export interface World {
  storage: MemStorage;
  store: Store;
  analytics: Analytics;
  economy: Economy;
  meta: Meta;
  /** Изменяемое «сейчас» (мс) — тесты двигают время сами. */
  now: { ms: number };
}

/** Мир меты с in-memory сейвом и инжектированными часами. */
export function makeWorld(rawSave?: string, baseMs: number = BASE_MS): World {
  const storage = new MemStorage();
  if (rawSave !== undefined) storage.setItem('orchardPeaks.meta', rawSave);
  const now = { ms: baseMs };
  const store = new Store(storage);
  const analytics = new Analytics(true);
  const economy = new Economy(store, analytics);
  const meta = new Meta(store, economy, analytics, () => now.ms);
  return { storage, store, analytics, economy, meta, now };
}

/** Ручная раздача для сценарных тестов ядра (без генератора). */
export function makeDeal(over?: Partial<Deal>): Deal {
  return {
    tableRanks: new Array<number>(28).fill(1),
    tableSuits: new Array<number>(28).fill(0),
    stockRanks: [],
    stockSuits: [],
    startWaste: 5,
    startWasteSuit: 0,
    harvest: new Set<number>(),
    ...over
  };
}
