/**
 * Тесты звука (Проход З) — ТОЛЬКО чистая логика src/audio/notes.ts, без
 * WebAudio/DOM/моков аудио (synth.ts в тестах не инстанцируется).
 *
 * Проверяются:
 *  1) эталонная пентатоника C4–A5 и зажим индексов в границы гаммы;
 *  2) маппинг событий: правильные индексы/частоты, монотонность «выше при
 *     большей серии», аккорды строго из нот пентатоники через 2 ступени;
 *  3) общие инварианты планов нот (частота из гаммы, длительности, гейны);
 *  4) настройка «Звук: вкл/выкл»: ключ с префиксом игры, дефолт ВКЛ, персист.
 */
import { describe, expect, it } from 'vitest';
import {
  BASE_AMPLITUDE,
  MASTER_VOLUME_DEFAULT,
  PENTATONIC,
  SOUND_KEY,
  chordIndices,
  clampIndex,
  pentFreq,
  readSoundEnabled,
  specsFor,
  writeSoundEnabled,
  type GameSoundEvent
} from '../src/audio/notes';
import { MemStorage } from './helpers';

/** Пентатоника как обычный массив (indexOf/includes без сужения литералов). */
const SCALE: readonly number[] = PENTATONIC;

/* ==================== 1. Гамма и границы ==================== */

describe('audio: пентатоника и зажим индексов', () => {
  it('эталонная пентатоника C4–A5 (10 частот, по возрастанию)', () => {
    expect(SCALE).toEqual([
      261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0
    ]);
    for (let i = 1; i < SCALE.length; i++) {
      expect(SCALE[i]).toBeGreaterThan(SCALE[i - 1]);
    }
  });

  it('clampIndex/pentFreq: выход за границы зажимается в гамму', () => {
    expect(clampIndex(-5)).toBe(0);
    expect(clampIndex(0)).toBe(0);
    expect(clampIndex(9)).toBe(9);
    expect(clampIndex(42)).toBe(9);
    expect(pentFreq(-1)).toBe(261.63);
    expect(pentFreq(3)).toBe(392.0);
    expect(pentFreq(99)).toBe(880.0);
  });

  it('chordIndices: голоса через 2 ступени, у вершины — зажим без выхода', () => {
    expect(chordIndices(0, 3)).toEqual([0, 2, 4]);
    expect(chordIndices(5, 3)).toEqual([5, 7, 9]);
    expect(chordIndices(8, 3)).toEqual([8, 9, 9]); // зажим на вершине гаммы
  });
});

/* ==================== 2. Маппинг событий ==================== */

describe('audio: событие → план нот (карта звуков Orchard Peaks)', () => {
  it('убранная карта: одна нота, серия «поёт» вверх (индекс = chain-1)', () => {
    const first = specsFor({ kind: 'cardRemoved', chain: 1 });
    expect(first).toHaveLength(1);
    expect(first[0].freq).toBe(261.63); // начало серии — низ гаммы
    expect(first[0].atMs).toBe(0);
    expect(specsFor({ kind: 'cardRemoved', chain: 3 })[0].freq).toBe(329.63);
  });

  it('монотонность: большая серия — нота НЕ ниже; вершина зажата на A5', () => {
    let prev = 0;
    for (let chain = 1; chain <= 15; chain++) {
      const f = specsFor({ kind: 'cardRemoved', chain })[0].freq;
      expect(f, 'серия ' + chain).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
    expect(specsFor({ kind: 'cardRemoved', chain: 100 })[0].freq).toBe(880.0);
  });

  it('длительность одиночной ноты — в эталонных 200–350 мс', () => {
    const d = specsFor({ kind: 'cardRemoved', chain: 2 })[0].durMs;
    expect(d).toBeGreaterThanOrEqual(200);
    expect(d).toBeLessThanOrEqual(350);
  });

  it('добор из колоды (обрыв серии): одна НИЗКАЯ мягкая нота', () => {
    const specs = specsFor({ kind: 'stockDraw' });
    expect(specs).toHaveLength(1);
    expect(specs[0].freq).toBe(261.63); // низ гаммы
    expect(specs[0].gain).toBeLessThan(1); // тише обычного хода
  });

  it('урожай 🍎: тёплый двузвук — 2 одновременные ноты через 2 ступени', () => {
    const specs = specsFor({ kind: 'harvest' });
    expect(specs).toHaveLength(2);
    expect(specs[0].atMs).toBe(0);
    expect(specs[1].atMs).toBe(0); // одновременно — двузвук, не глиссандо
    const step = SCALE.indexOf(specs[1].freq) - SCALE.indexOf(specs[0].freq);
    expect(step).toBe(2); // «терция» пентатоники
  });

  it('победа: восходящее арпеджио 5 нот (частота и время строго растут)', () => {
    const specs = specsFor({ kind: 'win' });
    expect(specs).toHaveLength(5);
    for (let i = 1; i < specs.length; i++) {
      expect(specs[i].freq).toBeGreaterThan(specs[i - 1].freq);
      expect(specs[i].atMs).toBeGreaterThan(specs[i - 1].atMs);
    }
  });

  it('поражение: две мягкие ноты ВНИЗ, обе негромкие (утешительно)', () => {
    const specs = specsFor({ kind: 'lose' });
    expect(specs).toHaveLength(2);
    expect(specs[1].freq).toBeLessThan(specs[0].freq); // вниз
    expect(specs[1].atMs).toBeGreaterThan(specs[0].atMs); // последовательность
    for (const n of specs) expect(n.gain).toBeLessThanOrEqual(0.6);
  });

  it('заказ сада: «колокольчиковый» аккорд — 3 одновременных голоса 5-7-9', () => {
    const specs = specsFor({ kind: 'orderDone' });
    expect(specs).toHaveLength(3);
    expect(specs.map((n) => SCALE.indexOf(n.freq))).toEqual([5, 7, 9]);
    for (const n of specs) expect(n.atMs).toBe(0);
    // «Колокольчик» тает дольше одиночной ноты хода.
    expect(specs[0].durMs).toBeGreaterThan(specsFor({ kind: 'cardRemoved', chain: 1 })[0].durMs);
  });

  it('стрик/награда: двузвук — 2 одновременные ноты через 2 ступени', () => {
    const specs = specsFor({ kind: 'reward' });
    expect(specs).toHaveLength(2);
    expect(specs[0].atMs).toBe(0);
    expect(specs[1].atMs).toBe(0);
    const step = SCALE.indexOf(specs[1].freq) - SCALE.indexOf(specs[0].freq);
    expect(step).toBe(2);
  });
});

/* ==================== 3. Общие инварианты планов ==================== */

describe('audio: инварианты всех событий', () => {
  const EVENTS: GameSoundEvent[] = [
    { kind: 'cardRemoved', chain: 1 },
    { kind: 'cardRemoved', chain: 7 },
    { kind: 'stockDraw' },
    { kind: 'harvest' },
    { kind: 'win' },
    { kind: 'lose' },
    { kind: 'orderDone' },
    { kind: 'reward' }
  ];

  it('каждая нота: частота ИЗ пентатоники, dur > 0, 0 < gain ≤ 1, atMs ≥ 0', () => {
    for (const ev of EVENTS) {
      const specs = specsFor(ev);
      expect(specs.length, ev.kind).toBeGreaterThan(0);
      for (const n of specs) {
        expect(SCALE.includes(n.freq), ev.kind + ': freq ' + n.freq).toBe(true);
        expect(n.durMs, ev.kind).toBeGreaterThan(0);
        expect(n.gain, ev.kind).toBeGreaterThan(0);
        expect(n.gain, ev.kind).toBeLessThanOrEqual(1);
        expect(n.atMs, ev.kind).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('громкость мягкая: базовая амплитуда 0.45, мастер по умолчанию ~0.6', () => {
    expect(BASE_AMPLITUDE).toBe(0.45);
    expect(MASTER_VOLUME_DEFAULT).toBe(0.6);
    expect(MASTER_VOLUME_DEFAULT).toBeLessThan(1); // тише базовой — ЦА 45+
  });
});

/* ==================== 4. Настройка «Звук: вкл/выкл» ==================== */

describe('audio: персист настройки звука (localStorage-префикс игры)', () => {
  it('ключ — с префиксом игры (как сейвы orchardPeaks.*)', () => {
    expect(SOUND_KEY).toBe('orchardPeaks.sound');
  });

  it('дефолт — ВКЛ: пустое хранилище → true', () => {
    expect(readSoundEnabled(new MemStorage())).toBe(true);
  });

  it('запись/чтение: false и true переживают «перезапуск» (новое чтение)', () => {
    const s = new MemStorage();
    writeSoundEnabled(s, false);
    expect(s.getItem(SOUND_KEY)).toBe('false');
    expect(readSoundEnabled(s)).toBe(false);
    writeSoundEnabled(s, true);
    expect(readSoundEnabled(s)).toBe(true);
  });

  it('мусор в ключе не роняет и трактуется как дефолт (ВКЛ)', () => {
    const s = new MemStorage();
    s.setItem(SOUND_KEY, '{oops');
    expect(readSoundEnabled(s)).toBe(true);
    s.setItem(SOUND_KEY, '"loud"');
    expect(readSoundEnabled(s)).toBe(true);
  });
});
