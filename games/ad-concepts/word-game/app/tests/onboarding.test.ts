/**
 * Тесты FTUE-онбординга (Проход Ж.1, порт prototype/onboarding.js):
 * схема флага localStorage `wordgrove.onboarding.v1` 1:1 с прототипом —
 * сейв прототипа подхватывается (обучение не показывается повторно),
 * finish() пишет {done:true,v:1,ts}, reset() возвращает первый запуск,
 * повреждённый JSON не роняет слой. Логика флага — без DOM (node-среда:
 * mount()/start() — no-op, что тоже проверяется).
 */
import { describe, expect, it } from 'vitest';
import type { KeyValueStorage } from '../src/core/storage';
import { ONBOARDING_FLAG_KEY, OnboardingUi } from '../src/ui/OnboardingUi';

class MemStorage implements KeyValueStorage {
  readonly m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

describe('OnboardingUi: флаг wordgrove.onboarding.v1 (схема прототипа)', () => {
  it('ключ — тот же, что у прототипа', () => {
    expect(ONBOARDING_FLAG_KEY).toBe('wordgrove.onboarding.v1');
  });

  it('нет ключа = первый запуск (isDone=false)', () => {
    const ob = new OnboardingUi({ storage: new MemStorage() });
    expect(ob.isDone()).toBe(false);
  });

  it('finish() пишет {done:true,v:1,ts} — совместимо с прототипом', () => {
    const storage = new MemStorage();
    const ob = new OnboardingUi({ storage });
    ob.finish();
    expect(ob.isDone()).toBe(true);
    const raw = storage.getItem(ONBOARDING_FLAG_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as { done: boolean; v: number; ts: number };
    expect(parsed.done).toBe(true);
    expect(parsed.v).toBe(1);
    expect(typeof parsed.ts).toBe('number');
  });

  it('сейв ПРОТОТИПА подхватывается: обучение не показывается повторно', () => {
    const storage = new MemStorage();
    // Ровно то, что пишет prototype/onboarding.js markDone().
    storage.setItem(ONBOARDING_FLAG_KEY, JSON.stringify({ done: true, v: 1, ts: 1720000000000 }));
    const ob = new OnboardingUi({ storage });
    expect(ob.isDone()).toBe(true);
  });

  it('reset() возвращает состояние первого запуска', () => {
    const storage = new MemStorage();
    const ob = new OnboardingUi({ storage });
    ob.finish();
    expect(ob.isDone()).toBe(true);
    ob.reset();
    expect(ob.isDone()).toBe(false);
    expect(storage.getItem(ONBOARDING_FLAG_KEY)).toBeNull();
  });

  it('повреждённый JSON / чужая схема → первый запуск, без краша', () => {
    const storage = new MemStorage();
    storage.setItem(ONBOARDING_FLAG_KEY, '{oops');
    expect(new OnboardingUi({ storage }).isDone()).toBe(false);
    storage.setItem(ONBOARDING_FLAG_KEY, JSON.stringify({ done: false }));
    expect(new OnboardingUi({ storage }).isDone()).toBe(false);
    storage.setItem(ONBOARDING_FLAG_KEY, JSON.stringify('done'));
    expect(new OnboardingUi({ storage }).isDone()).toBe(false);
  });

  it('бросающий storage не роняет слой (приватный режим)', () => {
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error('quota');
      },
      setItem: () => {
        throw new Error('quota');
      }
    };
    const ob = new OnboardingUi({ storage: throwing });
    expect(ob.isDone()).toBe(false);
    expect(() => ob.finish()).not.toThrow();
    expect(() => ob.reset()).not.toThrow();
  });

  it('в среде без DOM mount()/start() — no-op (node-тесты)', () => {
    const storage = new MemStorage();
    const ob = new OnboardingUi({ storage });
    expect(() => ob.mount()).not.toThrow();
    expect(() => ob.start(true)).not.toThrow();
    // Автозапуск не состоялся и флаг не тронут.
    expect(ob.isDone()).toBe(false);
  });
});
