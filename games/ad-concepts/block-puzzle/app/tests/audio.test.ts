/**
 * Тесты звука (ПРОХОД З) — только ЧИСТАЯ логика, без WebAudio/DOM:
 *  - notes.ts: маппинг игровых событий в NoteSpec[] (частоты строго из
 *    пентатоники C4–A5, clamp границ, аккорды «через 2», монотонность
 *    «выше при большем комбо/числе линий», направление глиссандо);
 *  - settings.ts: тумблер «Звук» персистится, по умолчанию ВКЛ.
 * WebAudioSynth в тестах не инстанцируется (архитектурный инвариант прохода).
 */
import { describe, expect, it } from 'vitest';
import {
  CHORD_GAIN,
  NOTE_GAIN,
  PENTATONIC_HZ,
  SOFT_GAIN,
  clampNoteIndex,
  noteSpecsFor,
  placeNoteIndex,
  type NoteSpec,
  type SoundEvent
} from '../src/audio/notes';
import {
  SOUND_KEY,
  loadSoundEnabled,
  parseSoundEnabled,
  saveSoundEnabled,
  serializeSoundEnabled
} from '../src/audio/settings';
import type { KeyValueStorage } from '../src/economy/store';

/** In-memory localStorage для node-окружения (как в ui-prefs.test.ts). */
function memStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k, v) => void data.set(k, v)
  };
}

const freqs = (specs: NoteSpec[]): number[] => specs.map((s) => s.freq);
const meanFreq = (specs: NoteSpec[]): number =>
  freqs(specs).reduce((a, b) => a + b, 0) / specs.length;
const allInScale = (specs: NoteSpec[]): boolean =>
  specs.every((s) => PENTATONIC_HZ.includes(s.freq));

/* ===================== Пентатоника и границы ============================ */

describe('пентатоника C4–A5 и clamp индексов', () => {
  it('эталонный ряд: 10 нот, строго по возрастанию', () => {
    expect(PENTATONIC_HZ).toHaveLength(10);
    expect(PENTATONIC_HZ[0]).toBeCloseTo(261.63);
    expect(PENTATONIC_HZ[9]).toBeCloseTo(880.0);
    for (let i = 1; i < PENTATONIC_HZ.length; i++) {
      expect(PENTATONIC_HZ[i]).toBeGreaterThan(PENTATONIC_HZ[i - 1]);
    }
  });

  it('clampNoteIndex: выход за границы и мусор зажимаются в 0..9', () => {
    expect(clampNoteIndex(-3)).toBe(0);
    expect(clampNoteIndex(99)).toBe(9);
    expect(clampNoteIndex(4)).toBe(4);
    expect(clampNoteIndex(Number.NaN)).toBe(0);
  });
});

/* ===================== Постановка фигуры =============================== */

describe('постановка фигуры: нота по строке размещения', () => {
  it('ниже на поле (row больше) = ниже тон; верхний ряд — выше', () => {
    // Поле 8×8: нижний ряд (7) → индекс 0, верхний (0) → индекс 7.
    expect(placeNoteIndex(7, 8)).toBe(0);
    expect(placeNoteIndex(0, 8)).toBe(7);
    for (let row = 1; row < 8; row++) {
      expect(placeNoteIndex(row, 8)).toBeLessThan(placeNoteIndex(row - 1, 8));
    }
  });

  it('clamp: строки вне поля не выпадают из диапазона нот', () => {
    expect(placeNoteIndex(-5, 8)).toBe(7); // как верхний ряд
    expect(placeNoteIndex(99, 8)).toBe(0); // как нижний ряд
  });

  it('событие place — одна нота пентатоники с эталонной амплитудой ~0.45', () => {
    const specs = noteSpecsFor({ type: 'place', row: 7, boardRows: 8 });
    expect(specs).toHaveLength(1);
    expect(specs[0].freq).toBeCloseTo(261.63); // нижний ряд → C4
    expect(specs[0].gain).toBeCloseTo(NOTE_GAIN);
    expect(allInScale(specs)).toBe(true);
  });
});

/* ===================== Очистка линий: аккорды =========================== */

describe('очистка линий: аккорды из нот пентатоники', () => {
  it('1 линия — трезвучие «через 2» (тоника+терция+квинта), одновременно', () => {
    const specs = noteSpecsFor({ type: 'clear', lines: 1 });
    expect(specs).toHaveLength(3);
    // Индексы 0/2/4 пентатоники: C4, E4, A4.
    expect(freqs(specs)).toEqual([PENTATONIC_HZ[0], PENTATONIC_HZ[2], PENTATONIC_HZ[4]]);
    expect(specs.every((s) => s.startMs === 0)).toBe(true);
  });

  it('2+ линии — аккорд шире (4 ноты) и выше по средней частоте', () => {
    const one = noteSpecsFor({ type: 'clear', lines: 1 });
    const two = noteSpecsFor({ type: 'clear', lines: 2 });
    const three = noteSpecsFor({ type: 'clear', lines: 3 });
    expect(two).toHaveLength(4);
    expect(meanFreq(two)).toBeGreaterThan(meanFreq(one));
    expect(meanFreq(three)).toBeGreaterThan(meanFreq(two));
    // Кап: 4+ линий не выше «потолка» трёх (границы clamp).
    expect(meanFreq(noteSpecsFor({ type: 'clear', lines: 5 }))).toBeCloseTo(meanFreq(three));
    expect(allInScale(two) && allInScale(three)).toBe(true);
  });
});

/* ===================== Комбо: монотонность вверх ======================== */

describe('комбо: восходящая ступень, выше при большем множителе', () => {
  it('монотонность: ×5 выше ×3 выше ×2', () => {
    const m2 = noteSpecsFor({ type: 'combo', mult: 2 });
    const m3 = noteSpecsFor({ type: 'combo', mult: 3 });
    const m5 = noteSpecsFor({ type: 'combo', mult: 5 });
    expect(meanFreq(m3)).toBeGreaterThan(meanFreq(m2));
    expect(meanFreq(m5)).toBeGreaterThan(meanFreq(m3));
  });

  it('пара нот восходящая и целиком из пентатоники', () => {
    const specs = noteSpecsFor({ type: 'combo', mult: 2 });
    expect(specs).toHaveLength(2);
    expect(specs[1].freq).toBeGreaterThan(specs[0].freq);
    expect(specs[1].startMs).toBeGreaterThan(specs[0].startMs);
    expect(allInScale(specs)).toBe(true);
  });
});

/* ===================== Глиссандо, бомба, game over ====================== */

describe('глиссандо «Прилива», бомба, game over, награда', () => {
  it('surgeReady — быстрый glissando ВВЕРХ (частоты и старты растут)', () => {
    const specs = noteSpecsFor({ type: 'surgeReady' });
    expect(specs.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < specs.length; i++) {
      expect(specs[i].freq).toBeGreaterThan(specs[i - 1].freq);
      expect(specs[i].startMs).toBeGreaterThan(specs[i - 1].startMs);
    }
  });

  it('bomb — широкий аккорд сразу + glissando ВНИЗ следом', () => {
    const specs = noteSpecsFor({ type: 'bomb' });
    const chord = specs.filter((s) => s.startMs === 0);
    expect(chord.length).toBeGreaterThanOrEqual(3); // широкий аккорд
    const spread = Math.max(...freqs(chord)) / Math.min(...freqs(chord));
    expect(spread).toBeGreaterThan(2); // «широкий» = больше октавы
    const tail = specs.filter((s) => s.startMs > 0).sort((a, b) => a.startMs - b.startMs);
    for (let i = 1; i < tail.length; i++) {
      expect(tail[i].freq).toBeLessThan(tail[i - 1].freq); // вниз
    }
  });

  it('gameOver — ровно 3 мягкие ноты вниз, тише одиночной ноты', () => {
    const specs = noteSpecsFor({ type: 'gameOver' });
    expect(specs).toHaveLength(3);
    expect(specs[1].freq).toBeLessThan(specs[0].freq);
    expect(specs[2].freq).toBeLessThan(specs[1].freq);
    expect(specs.every((s) => s.gain <= SOFT_GAIN && s.gain < NOTE_GAIN)).toBe(true);
  });

  it('reward — приятный восходящий двузвук из пентатоники', () => {
    const specs = noteSpecsFor({ type: 'reward' });
    expect(specs).toHaveLength(2);
    expect(specs[1].freq).toBeGreaterThan(specs[0].freq);
    expect(allInScale(specs)).toBe(true);
  });
});

/* ===================== Инварианты всех событий ========================== */

describe('инварианты NoteSpec для всех событий', () => {
  const events: SoundEvent[] = [
    { type: 'place', row: 3, boardRows: 8 },
    { type: 'place', row: -10, boardRows: 8 },
    { type: 'clear', lines: 1 },
    { type: 'clear', lines: 4 },
    { type: 'combo', mult: 5 },
    { type: 'surgeReady' },
    { type: 'bomb' },
    { type: 'gameOver' },
    { type: 'reward' }
  ];

  it('каждая нота: частота из пентатоники, gain в (0..1], длительность 120–400 мс', () => {
    for (const ev of events) {
      const specs = noteSpecsFor(ev);
      expect(specs.length).toBeGreaterThan(0);
      for (const s of specs) {
        expect(PENTATONIC_HZ).toContain(s.freq);
        expect(s.gain).toBeGreaterThan(0);
        expect(s.gain).toBeLessThanOrEqual(1);
        expect(s.durationMs).toBeGreaterThanOrEqual(120);
        expect(s.durationMs).toBeLessThanOrEqual(400);
        expect(s.startMs).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('ноты аккордов тише одиночных — сумма не клиппует', () => {
    expect(CHORD_GAIN).toBeLessThan(NOTE_GAIN);
    const chord = noteSpecsFor({ type: 'clear', lines: 2 });
    const peakSum = chord.reduce((a, s) => a + s.gain, 0);
    expect(peakSum).toBeLessThanOrEqual(1.25); // с запасом под мастер 0.8
  });
});

/* ===================== Настройка «Звук» ================================= */

describe('настройка звука (blocksurge_sound): дефолт ВКЛ + персист', () => {
  it('ключ персиста — с префиксом игры', () => {
    expect(SOUND_KEY).toBe('blocksurge_sound');
  });

  it('parseSoundEnabled: отсутствие ключа и мусор → ВКЛ, только "off" → выкл', () => {
    expect(parseSoundEnabled(null)).toBe(true);
    expect(parseSoundEnabled('on')).toBe(true);
    expect(parseSoundEnabled('garbage')).toBe(true);
    expect(parseSoundEnabled('off')).toBe(false);
  });

  it('персист: save → load возвращает то же значение (round-trip)', () => {
    const s = memStorage();
    expect(loadSoundEnabled(s)).toBe(true); // свежая установка → ВКЛ
    saveSoundEnabled(false, s);
    expect(s.data.get(SOUND_KEY)).toBe('off');
    expect(loadSoundEnabled(s)).toBe(false);
    saveSoundEnabled(true, s);
    expect(loadSoundEnabled(s)).toBe(true);
    expect(serializeSoundEnabled(false)).toBe('off');
    expect(serializeSoundEnabled(true)).toBe('on');
  });
});
