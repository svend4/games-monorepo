/**
 * Фабрика рекламного провайдера (Проход Е.2).
 *
 * Выбор реализации — по флагу окружения VITE_AD_PROVIDER:
 *   - 'max'  → MaxAdProvider (скелет прод-интеграции AppLovin MAX, 06 §6, §8);
 *   - иначе  → SimAdProvider (СИМУЛЯЦИЯ; веб-сборка и дев-режим).
 *
 * Игра нигде, кроме этой фабрики, не знает о конкретных реализациях —
 * MonetizeController получает готовый AdProvider.
 */
import type { AdProvider } from './provider';
import { SimAdProvider, type SimAdProviderOptions } from './simProvider';
import { MaxAdProvider } from './maxProvider.stub';

export type AdProviderKind = 'sim' | 'max';

export interface CreateAdProviderOptions {
  /** Явный выбор реализации (тесты); по умолчанию — флаг окружения. */
  kind?: AdProviderKind;
  /** Опции симулятора (RNG, предикат активности баннера). */
  sim?: SimAdProviderOptions;
}

/** Нормализация значения флага: всё, кроме 'max', — симулятор. */
export function resolveAdProviderKind(flagValue: unknown): AdProviderKind {
  return flagValue === 'max' ? 'max' : 'sim';
}

/** Флаг из import.meta.env без объявления vite/client-типов (strict, без any). */
function envFlag(name: string): unknown {
  const meta = import.meta as unknown as { env?: Record<string, unknown> };
  return meta.env ? meta.env[name] : undefined;
}

export function createAdProvider(opts: CreateAdProviderOptions = {}): AdProvider {
  const kind = opts.kind ?? resolveAdProviderKind(envFlag('VITE_AD_PROVIDER'));
  if (kind === 'max') return new MaxAdProvider();
  return new SimAdProvider(opts.sim);
}
