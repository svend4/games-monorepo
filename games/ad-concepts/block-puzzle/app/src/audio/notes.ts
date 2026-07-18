/**
 * Ноты и маппинг игровых событий в звук (ПРОХОД З). ЧИСТАЯ логика:
 * ни WebAudio, ни DOM — модуль полностью тестируется в node (tests/audio.test.ts).
 *
 * Эталон (порт идеи из Kotlin-референса):
 *  - пентатоника C4–A5 — гармонична при ЛЮБЫХ наложениях нот, поэтому аккорды
 *    и глиссандо можно строить из произвольных индексов без диссонансов;
 *  - одиночная нота ~200–350 мс, амплитуда ~0.45;
 *  - аккорд = 2–4 ноты пентатоники одновременно (индексы через 2:
 *    тоника + терция + квинта пентатоники);
 *  - glissando = быстрая последовательность нот вверх/вниз (startMs-план).
 *
 * Огибающая (атака/сустейн/спад) — забота synth.ts; здесь только «что играть»:
 * частота, момент старта, длительность, амплитуда.
 */

/** Пентатоника C-мажор C4–A5 (Гц) — эталонный ряд из Kotlin-источника. */
export const PENTATONIC_HZ: readonly number[] = [
  261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0
];

/** Амплитуда одиночной ноты (эталон ~0.45). */
export const NOTE_GAIN = 0.45;
/** Амплитуда ноты в аккорде/глиссандо — ниже, чтобы сумма нот не клипповала. */
export const CHORD_GAIN = 0.3;
/** «Мягкая» амплитуда для game over (не пугающая). */
export const SOFT_GAIN = 0.34;

/** Одна запланированная нота: что, когда и как громко играть. */
export interface NoteSpec {
  /** Частота, Гц (всегда из PENTATONIC_HZ). */
  freq: number;
  /** Смещение старта от начала события, мс. */
  startMs: number;
  /** Длительность ноты, мс. */
  durationMs: number;
  /** Пиковая амплитуда огибающей, 0..1. */
  gain: number;
}

/** Игровые события Block Surge, озвучиваемые процедурным синтезом. */
export type SoundEvent =
  /** Постановка фигуры без очистки: ниже на поле (больше row) = ниже тон. */
  | { type: 'place'; row: number; boardRows: number }
  /** Очистка линий: 1 линия = трезвучие, 2+ = аккорд шире и выше. */
  | { type: 'clear'; lines: number }
  /** Комбо: восходящая ступень гаммы по множителю (×2/×3/×5 → всё выше). */
  | { type: 'combo'; mult: number }
  /** Шкала «Прилив» заполнена (бомба в доке): короткий glissando вверх. */
  | { type: 'surgeReady' }
  /** Взрыв кристальной бомбы: широкий аккорд + glissando вниз. */
  | { type: 'bomb' }
  /** Конец партии: мягкая нисходящая последовательность из 3 нот. */
  | { type: 'gameOver' }
  /** Покупка/награда в мете: приятный восходящий двузвук. */
  | { type: 'reward' };

/** Зажать индекс в валидный диапазон пентатоники (мусор/NaN → 0). */
export function clampNoteIndex(index: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(PENTATONIC_HZ.length - 1, Math.round(index)));
}

/** NoteSpec по индексу пентатоники (индекс безопасно зажимается). */
function note(index: number, startMs: number, durationMs: number, gain: number): NoteSpec {
  return { freq: PENTATONIC_HZ[clampNoteIndex(index)], startMs, durationMs, gain };
}

/**
 * Индекс ноты постановки: ниже на поле (row больше) → ниже тон.
 * Нижний ряд (row = boardRows-1) → индекс 0, верхний (row = 0) → boardRows-1.
 */
export function placeNoteIndex(row: number, boardRows: number): number {
  const r = Math.max(0, Math.min(boardRows - 1, Math.round(row)));
  return clampNoteIndex(boardRows - 1 - r);
}

/* ===================== Сборка нот по событиям ========================== */

/** Постановка фигуры — одиночная нота по строке размещения. */
function placeNotes(row: number, boardRows: number): NoteSpec[] {
  return [note(placeNoteIndex(row, boardRows), 0, 240, NOTE_GAIN)];
}

/**
 * Очистка линий — аккорд из нот пентатоники «через 2» (тоника+терция+квинта).
 * 1 линия → трезвучие от тоники; 2+ линий → база выше и добавляется 4-я нота
 * (аккорд «шире/выше»); база монотонно растёт с числом линий (кап на 3+).
 */
function clearChord(lines: number): NoteSpec[] {
  const n = Math.max(1, Math.round(lines));
  const base = Math.min((n - 1) * 2, 3);
  const indices = n >= 2 ? [base, base + 2, base + 4, base + 6] : [base, base + 2, base + 4];
  return indices.map((i) => note(i, 0, 320, CHORD_GAIN));
}

/**
 * Комбо — короткая восходящая ступень (2 ноты); чем выше множитель
 * (×2 → ×3 → ×5), тем выше пара нот. Играет поверх аккорда очистки.
 */
function comboStep(mult: number): NoteSpec[] {
  const rank = mult >= 5 ? 2 : mult >= 3 ? 1 : 0;
  const first = 4 + rank * 2;
  return [note(first, 0, 200, NOTE_GAIN), note(first + 2, 80, 200, NOTE_GAIN)];
}

/** Полный «Прилив» — короткий glissando вверх (4 быстрые ноты). */
function surgeGliss(): NoteSpec[] {
  return [3, 5, 7, 9].map((idx, k) => note(idx, k * 70, 160, CHORD_GAIN + 0.05));
}

/** Взрыв бомбы — широкий аккорд сразу + glissando вниз следом. */
function bombBlast(): NoteSpec[] {
  const chord = [0, 4, 8].map((idx) => note(idx, 0, 320, CHORD_GAIN));
  const gliss = [9, 7, 5, 3, 1].map((idx, k) => note(idx, 80 + k * 60, 150, CHORD_GAIN));
  return [...chord, ...gliss];
}

/** Game over — мягкие 3 ноты вниз, неторопливо (не пугающая концовка). */
function gameOverNotes(): NoteSpec[] {
  return [5, 3, 1].map((idx, k) => note(idx, k * 240, 340, SOFT_GAIN));
}

/** Покупка/награда в мете — приятный восходящий двузвук (терция пентатоники). */
function rewardNotes(): NoteSpec[] {
  return [note(5, 0, 220, 0.4), note(7, 90, 220, 0.4)];
}

/** Главный маппинг: игровое событие → план нот для SoundPlayer.play(). */
export function noteSpecsFor(event: SoundEvent): NoteSpec[] {
  switch (event.type) {
    case 'place':
      return placeNotes(event.row, event.boardRows);
    case 'clear':
      return clearChord(event.lines);
    case 'combo':
      return comboStep(event.mult);
    case 'surgeReady':
      return surgeGliss();
    case 'bomb':
      return bombBlast();
    case 'gameOver':
      return gameOverNotes();
    case 'reward':
      return rewardNotes();
  }
}
