/**
 * Чистая логика звука WordGrove (Проход З) — БЕЗ WebAudio и DOM.
 *
 * Идея — порт эталона Kotlin (Surreal Circus): пентатоника C4–A5 гармонична
 * при любых комбинациях, поэтому «мелодия пальцем» при протяжке не может
 * прозвучать фальшиво. Модуль отвечает ТОЛЬКО за выбор нот: игровое событие
 * (SoundEvent) → список NoteSpec (частота/старт/длительность/амплитуда).
 * Синтез (осцилляторы, огибающие, планирование) — src/audio/synth.ts.
 *
 * Тестируется vitest в node-среде без моков аудио (tests/audio.test.ts).
 */
import { MIN_WORD_LEN } from '../core/config';

/** Пентатоника C4–A5, Гц — гармонична при любых комбинациях (эталон Kotlin). */
export const PENTATONIC: readonly number[] = [
  261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0
];

/** Базовая амплитуда одиночной ноты (~0.45 из эталона). */
export const AMPLITUDE = 0.45;
/** Атака огибающей — первые 10% длительности (против щелчков). */
export const ATTACK_FRACTION = 0.1;
/** Спад огибающей — последние 30% длительности. */
export const RELEASE_FRACTION = 0.3;

/** Одна запланированная нота: частота + смещение старта + огибающая. */
export interface NoteSpec {
  /** Частота, Гц (всегда из PENTATONIC). */
  readonly freq: number;
  /** Смещение старта от момента вызова, мс (0 — сразу). */
  readonly startMs: number;
  /** Полная длительность ноты, мс (атака+сустейн+спад внутри неё). */
  readonly durationMs: number;
  /** Пиковая амплитуда огибающей (0..1). */
  readonly gain: number;
}

/**
 * Игровые события со звуком (карта WordGrove, Проход З):
 *  - letterAdd:    буква добавлена в протяжку (index — позиция в слове, 0-based);
 *  - letterRemove: откат буквы (index — буква, к которой вернулись);
 *  - wordValid:    отпускание с валидным словом сетки (length — длина слова);
 *  - wordBonus:    бонусное слово (двузвук + высокая нота «жёлудь»);
 *  - wordDuplicate:слово уже найдено (нейтрально, тише invalid);
 *  - wordInvalid:  слова нет в словаре (нейтральная низкая нота, не обидная);
 *  - hint:         подсказка «Лампа» («волшебный» glissando вверх);
 *  - levelComplete:уровень пройден (арпеджио по пентатонике);
 *  - uiClick:      переход в мету/атлас (тихий клик-тон).
 */
export type SoundEvent =
  | { readonly type: 'letterAdd'; readonly index: number }
  | { readonly type: 'letterRemove'; readonly index: number }
  | { readonly type: 'wordValid'; readonly length: number }
  | { readonly type: 'wordBonus' }
  | { readonly type: 'wordDuplicate' }
  | { readonly type: 'wordInvalid' }
  | { readonly type: 'hint' }
  | { readonly type: 'levelComplete' }
  | { readonly type: 'uiClick' };

/** Индекс ноты пентатоники с зажимом в [0, PENTATONIC.length-1]. */
export function clampNoteIndex(index: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), PENTATONIC.length - 1);
}

/** Частота n-й буквы протяжки: каждая буква — следующая нота вверх (с зажимом). */
export function letterFreq(index: number): number {
  return PENTATONIC[clampNoteIndex(index)];
}

/** Максимальный корень аккорда: root+4 не должен вылезти за пентатонику. */
const MAX_CHORD_ROOT = PENTATONIC.length - 5;

/**
 * Корень мажорного аккорда для валидного слова: длиннее слово — выше корень
 * (монотонно, с зажимом сверху). Минимальное слово (MIN_WORD_LEN) — тоника C4.
 */
export function chordRootIndex(wordLength: number): number {
  const raw = wordLength - MIN_WORD_LEN;
  return Math.min(Math.max(raw, 0), MAX_CHORD_ROOT);
}

/**
 * Аккорд = тоника + «терция» + «квинта» пентатоники (индексы через 2):
 * шаги пентатоники гарантируют консонанс на любом корне.
 */
export function chordIndices(wordLength: number): readonly number[] {
  const root = chordRootIndex(wordLength);
  return [root, root + 2, root + 4];
}

/* ---------- Длительности/амплитуды пресетов (эталон: 200–350 мс) ---------- */

const LETTER_MS = 220;
const CHORD_MS = 350;
const CHORD_GAIN = 0.3; // три голоса суммарно ~ базовой амплитуде
const GLISS_STEP_MS = 45;
const ARPEGGIO_STEP_MS = 90;

/** Карта: игровое событие → список нот (единственная точка выбора звука). */
export function mapEventToNotes(event: SoundEvent): NoteSpec[] {
  switch (event.type) {
    case 'letterAdd':
      // Палец «играет мелодию»: n-я буква — n-я нота пентатоники вверх.
      return [{ freq: letterFreq(event.index), startMs: 0, durationMs: LETTER_MS, gain: AMPLITUDE }];

    case 'letterRemove':
      // Откат: нота буквы, к которой вернулись, — ниже и тише добавления.
      return [{ freq: letterFreq(event.index), startMs: 0, durationMs: 180, gain: 0.32 }];

    case 'wordValid':
      // Мажорный аккорд (2-3 ноты одновременно): выше при более длинном слове.
      return chordIndices(event.length).map((idx) => ({
        freq: PENTATONIC[idx],
        startMs: 0,
        durationMs: CHORD_MS,
        gain: CHORD_GAIN
      }));

    case 'wordBonus':
      // Особый двузвук + высокая нота «жёлудь» чуть позже.
      return [
        { freq: PENTATONIC[5], startMs: 0, durationMs: 200, gain: 0.3 },
        { freq: PENTATONIC[7], startMs: 0, durationMs: 200, gain: 0.3 },
        { freq: PENTATONIC[9], startMs: 140, durationMs: 300, gain: 0.38 }
      ];

    case 'wordDuplicate':
      // «Уже найдено»: нейтрально и совсем тихо, без негатива.
      return [{ freq: PENTATONIC[1], startMs: 0, durationMs: 200, gain: 0.22 }];

    case 'wordInvalid':
      // Нейтральная низкая нота (не обидная): тоника C4, мягкая.
      return [{ freq: PENTATONIC[0], startMs: 0, durationMs: 300, gain: 0.3 }];

    case 'hint':
      // «Волшебный» glissando вверх: быстрая последовательность нот.
      return [3, 4, 5, 6, 7, 8].map((idx, i) => ({
        freq: PENTATONIC[idx],
        startMs: i * GLISS_STEP_MS,
        durationMs: 140,
        gain: 0.3
      }));

    case 'levelComplete':
      // Арпеджио победы по пентатонике; последняя нота — длиннее.
      return [0, 2, 4, 7, 9].map((idx, i, arr) => ({
        freq: PENTATONIC[idx],
        startMs: i * ARPEGGIO_STEP_MS,
        durationMs: i === arr.length - 1 ? 420 : 260,
        gain: 0.4
      }));

    case 'uiClick':
      // Тихий короткий клик-тон перехода в мету/атлас.
      return [{ freq: PENTATONIC[5], startMs: 0, durationMs: 80, gain: 0.18 }];
  }
}
