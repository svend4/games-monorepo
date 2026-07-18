/**
 * Тесты i18n RU/EN и FTUE-онбординга (Проход Ж.1) — чистая логика без DOM.
 *
 * Проверяются:
 *  1) ПОЛНОТА ЛОКАЛЕЙ: ru и en имеют идентичные наборы ключей, значения —
 *     непустые строки (рантайм-дубль компилерной гарантии `satisfies`);
 *  2) ПОКРЫТИЕ КОНФИГОВ: у каждой строки конфигов (зоны/заказы/миссии/
 *     бустеры/плейсменты/полка IAP/план 5.4) есть ключ перевода в ОБЕИХ
 *     локалях (динамические ключи tDyn не видны компилятору);
 *  3) выбор локали: localStorage-override → navigator.language → en;
 *  4) t()/tDyn(): подстановка параметров, фолбэк динамического ключа;
 *  5) флаг онбординга: ТОТ ЖЕ ключ orchardPeaks.onboarding и схема
 *     прототипа (сейв прототипа = обучение пройдено), версия/сброс.
 */
import { describe, expect, it } from 'vitest';
import { ru } from '../src/i18n/ru';
import { en } from '../src/i18n/en';
import { detectLocale, getLocale, setLocale, t, tDyn } from '../src/i18n';
import { ECON } from '../src/economy/econ';
import { ZONES } from '../src/meta/config';
import { IAP_SHELF, PLACEMENT_ORDER } from '../src/monetize/config';
import {
  ONBOARDING_KEY,
  ONBOARDING_VERSION,
  isOnboardingDone,
  markOnboardingDone,
  readOnboardingFlag,
  resetOnboarding
} from '../src/ui/OnboardingUi';
import { MemStorage } from './helpers';

const ruDict = ru as Record<string, string>;
const enDict = en as Record<string, string>;

/* ==================== 1. Полнота локалей ==================== */

describe('i18n: полнота локалей ru/en', () => {
  it('наборы ключей идентичны (ни недостающих, ни лишних)', () => {
    const ruKeys = Object.keys(ruDict).sort();
    const enKeys = Object.keys(enDict).sort();
    expect(enKeys).toEqual(ruKeys);
  });

  it('все значения — непустые строки в обеих локалях', () => {
    for (const [k, v] of Object.entries(ruDict)) {
      expect(typeof v, 'ru: ' + k).toBe('string');
      expect(v.length, 'ru пустой: ' + k).toBeGreaterThan(0);
    }
    for (const [k, v] of Object.entries(enDict)) {
      expect(typeof v, 'en: ' + k).toBe('string');
      expect(v.length, 'en пустой: ' + k).toBeGreaterThan(0);
    }
  });

  it('наборы плейсхолдеров {…} совпадают в ru и en (параметры не потеряны)', () => {
    const holders = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(ruDict)) {
      expect(holders(enDict[k]), 'плейсхолдеры ключа ' + k).toEqual(holders(ruDict[k]));
    }
  });
});

/* ==================== 2. Покрытие строк конфигов ==================== */

describe('i18n: покрытие конфигов динамическими ключами', () => {
  const expectKey = (key: string): void => {
    expect(ruDict[key], 'нет в ru: ' + key).toBeTypeOf('string');
    expect(enDict[key], 'нет в en: ' + key).toBeTypeOf('string');
  };

  it('зоны и заказы сада (meta/config.ts)', () => {
    for (const z of ZONES) {
      expectKey('zone.' + z.id + '.name');
      expectKey('zone.' + z.id + '.scene');
      for (let i = 0; i < z.orders.length; i++) {
        expectKey('order.' + z.id + '.' + i + '.title');
      }
    }
  });

  it('миссии и бустеры (econ.ts)', () => {
    for (const def of [...ECON.DAILY_MISSIONS, ...ECON.WEEKLY_MISSIONS]) {
      expectKey('mission.' + def.id + '.text');
    }
    for (const id of ECON.BOOSTER_ORDER) {
      expectKey('booster.' + id + '.name');
      expectKey('booster.' + id + '.hint');
    }
  });

  it('плейсменты рекламы (monetize/config.ts)', () => {
    for (const pid of PLACEMENT_ORDER) {
      expectKey('placement.' + pid + '.name');
      expectKey('placement.' + pid + '.desc');
    }
  });

  it('полка IAP: label всегда, note — для непустых note конфига', () => {
    for (const item of IAP_SHELF) {
      expectKey('iap.' + item.sku + '.label');
      if (item.note !== '') expectKey('iap.' + item.sku + '.note');
    }
  });

  it('план 5.4: примечание каждой строки', () => {
    for (const row of ECON.PLAN_5_4) {
      expectKey('plan.d' + row.day + '.note');
    }
  });
});

/* ==================== 3. Выбор локали ==================== */

describe('i18n: detectLocale (override → navigator → en)', () => {
  it('localStorage-override побеждает navigator', () => {
    expect(detectLocale('ru', 'en-US')).toBe('ru');
    expect(detectLocale('en', 'ru-RU')).toBe('en');
  });

  it('мусор в override игнорируется → фолбэк на navigator', () => {
    expect(detectLocale('de', 'ru-RU')).toBe('ru');
    expect(detectLocale('', 'ru')).toBe('ru');
  });

  it('navigator: ru* → ru (регистронезависимо), иначе en', () => {
    expect(detectLocale(null, 'ru')).toBe('ru');
    expect(detectLocale(null, 'ru-RU')).toBe('ru');
    expect(detectLocale(null, 'RU-ru')).toBe('ru');
    expect(detectLocale(null, 'de-DE')).toBe('en');
    expect(detectLocale(null, 'en-GB')).toBe('en');
  });

  it('ничего нет → en (дефолт листинга)', () => {
    expect(detectLocale(null, null)).toBe('en');
  });
});

/* ==================== 4. t() / tDyn() ==================== */

describe('i18n: t() и tDyn()', () => {
  it('t() переводит по текущей локали; setLocale переключает без DOM', () => {
    const before = getLocale();
    try {
      setLocale('ru');
      expect(t('onb.next')).toBe('Далее');
      expect(t('win.title')).toBe('Стол чист!');
      setLocale('en');
      expect(t('onb.next')).toBe('Next');
      expect(t('win.title')).toBe('Board clear!');
    } finally {
      setLocale(before);
    }
  });

  it('подстановка параметров {name}; неизвестный плейсхолдер остаётся как есть', () => {
    const before = getLocale();
    try {
      setLocale('ru');
      expect(t('onb.stepLabel', { cur: 2, total: 7 })).toBe('Шаг 2 из 7');
      expect(t('game.toast.noCoinsUndo', { price: 150 })).toBe('Нет монет на отмену (нужно 150)');
      // параметр не передан → плейсхолдер не трогаем (виден в ручном тесте)
      expect(t('onb.stepLabel', { cur: 1 })).toBe('Шаг 1 из {total}');
    } finally {
      setLocale(before);
    }
  });

  it('tDyn(): перевод по динамическому ключу, фолбэк на строку конфига', () => {
    const before = getLocale();
    try {
      setLocale('en');
      expect(tDyn('zone.porch.name', 'Крыльцо')).toBe('The Porch');
      expect(tDyn('booster.joker.name', 'Джокер')).toBe('Joker');
      // несуществующий ключ → фолбэк (строка конфига), с параметрами
      expect(tDyn('zone.pond.name', 'Пруд')).toBe('Пруд');
      expect(tDyn('no.such.key', 'x={v}', { v: 3 })).toBe('x=3');
    } finally {
      setLocale(before);
    }
  });
});

/* ==================== 5. Флаг онбординга (совместимость сейва) ==================== */

describe('онбординг: ключ orchardPeaks.onboarding и схема прототипа', () => {
  it('ключ и версия совпадают с прототипом', () => {
    expect(ONBOARDING_KEY).toBe('orchardPeaks.onboarding');
    expect(ONBOARDING_VERSION).toBe(1);
  });

  it('нет ключа → не пройдено (показывать)', () => {
    const s = new MemStorage();
    expect(readOnboardingFlag(s)).toBeNull();
    expect(isOnboardingDone(s)).toBe(false);
  });

  it('ФИКСТУРА сейва прототипа → пройдено (повторно не показывать)', () => {
    const s = new MemStorage();
    // Ровно то, что пишет prototype/onboarding.js markDone(false).
    s.setItem(
      ONBOARDING_KEY,
      JSON.stringify({ done: true, version: 1, skipped: false, at: 1770000000000 })
    );
    expect(isOnboardingDone(s)).toBe(true);
    const f = readOnboardingFlag(s);
    expect(f).not.toBeNull();
    expect(f?.skipped).toBe(false);
  });

  it('markOnboardingDone пишет схему прототипа; skipped сохраняется', () => {
    const s = new MemStorage();
    markOnboardingDone(s, true);
    const raw = s.getItem(ONBOARDING_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    expect(parsed.done).toBe(true);
    expect(parsed.version).toBe(ONBOARDING_VERSION);
    expect(parsed.skipped).toBe(true);
    expect(typeof parsed.at).toBe('number');
    expect(isOnboardingDone(s)).toBe(true);
  });

  it('другая версия флага → показать снова (обновлённый набор шагов)', () => {
    const s = new MemStorage();
    s.setItem(ONBOARDING_KEY, JSON.stringify({ done: true, version: 0, skipped: false, at: 1 }));
    expect(isOnboardingDone(s)).toBe(false);
  });

  it('битый JSON не роняет и трактуется как «не пройдено»; сброс работает', () => {
    const s = new MemStorage();
    s.setItem(ONBOARDING_KEY, '{oops');
    expect(isOnboardingDone(s)).toBe(false);
    markOnboardingDone(s, false);
    expect(isOnboardingDone(s)).toBe(true);
    resetOnboarding(s);
    expect(isOnboardingDone(s)).toBe(false);
  });
});
