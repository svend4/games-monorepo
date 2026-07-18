/**
 * Чистая звуковая логика Orchard Peaks (Проход З): частоты пентатоники и
 * маппинг игровых событий в план нот (NoteSpec[]). Ни WebAudio, ни DOM —
 * тестируется vitest без моков аудио (tests/audio.test.ts); проигрывание
 * плана — src/audio/synth.ts.
 *
 * Идея (эталон — Kotlin-версия): пентатоника C4–A5 гармонична при ЛЮБЫХ
 * комбинациях нот, поэтому события можно свободно накладывать друг на друга —
 * фальши не будет. Аудитория 45+ — звучание мягкое и негромкое: синусоида,
 * огибающая против щелчков (synth.ts), сниженный мастер по умолчанию.
 */
import type { KeyValueStorage } from '../economy/store';

/** Пентатоника C4–A5, Гц — гармонична при любых комбинациях (эталон). */
export const PENTATONIC = [
  261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0
] as const;

/** Базовая амплитуда ноты (эталон ~0.45); итоговый пик = BASE × gain ноты. */
export const BASE_AMPLITUDE = 0.45;

/** Мастер-громкость по умолчанию: ЦА 45+ — мягко, ~0.6 от базовой. */
export const MASTER_VOLUME_DEFAULT = 0.6;

/** Спецификация одной ноты — «что и когда сыграть» (план для synth.ts). */
export interface NoteSpec {
  /** Частота, Гц — всегда из PENTATONIC (гарантия гармоничности). */
  freq: number;
  /** Смещение старта от «сейчас», мс (арпеджио/глиссандо — растущие atMs). */
  atMs: number;
  /** Длительность, мс (одиночная нота ~200–350 по эталону; аккорд дольше). */
  durMs: number;
  /** Относительная громкость ноты 0..1 (множится на BASE_AMPLITUDE). */
  gain: number;
}

/**
 * Игровые события со звуком — карта звуков Orchard Peaks (Проход З).
 * UI-слой зовёт sound.play({ kind: ... }) в точках событий; ядро (core/)
 * звука не знает.
 */
export type GameSoundEvent =
  /** Убранная карта: нота, индекс растёт с длиной серии — серия «поёт» вверх. */
  | { kind: 'cardRemoved'; chain: number }
  /** Добор из колоды (обрыв серии): низкая мягкая нота. */
  | { kind: 'stockDraw' }
  /** Карта урожая 🍎: тёплый двузвук. */
  | { kind: 'harvest' }
  /** Победа: восходящее арпеджио 5 нот. */
  | { kind: 'win' }
  /** Поражение: две мягкие ноты вниз (утешительно, не мрачно). */
  | { kind: 'lose' }
  /** Выполнение заказа сада: «колокольчиковый» аккорд. */
  | { kind: 'orderDone' }
  /** Стрик/награда миссии: двузвук. */
  | { kind: 'reward' };

/** Индекс пентатоники с зажимом в границы гаммы (из гаммы не выходим). */
export function clampIndex(index: number): number {
  const i = Math.round(index);
  if (i < 0) return 0;
  const top = PENTATONIC.length - 1;
  return i > top ? top : i;
}

/** Частота по индексу пентатоники (индекс зажимается в границы). */
export function pentFreq(index: number): number {
  return PENTATONIC[clampIndex(index)];
}

/**
 * Индексы аккорда пентатоники: голоса через 2 ступени гаммы от тоники
 * (тоника + «терция» + «квинта» пентатоники — эталонная схема аккорда).
 */
export function chordIndices(root: number, voices: 2 | 3): number[] {
  const out: number[] = [];
  for (let v = 0; v < voices; v++) out.push(clampIndex(root + v * 2));
  return out;
}

/* Длительности (мс): нота — эталонные 200–350; «колокольчик» тает дольше. */
const NOTE_DUR_MS = 220;
const CHORD_DUR_MS = 320;
const BELL_DUR_MS = 480;
/** Шаг нот восходящего арпеджио победы, мс (глиссандо вверх). */
const ARPEGGIO_STEP_MS = 90;

/**
 * Маппинг: игровое событие → план нот. Все частоты — из PENTATONIC, гейны
 * событий «фона» (добор/поражение) занижены — мягкая палитра для ЦА 45+.
 */
export function specsFor(event: GameSoundEvent): NoteSpec[] {
  switch (event.kind) {
    case 'cardRemoved': {
      // Серия «поёт» вверх: 1-я карта серии — низ гаммы, дальше индекс растёт
      // с длиной серии (clamp на вершине A5 — длинные серии не «улетают»).
      const idx = clampIndex(event.chain - 1);
      return [{ freq: pentFreq(idx), atMs: 0, durMs: NOTE_DUR_MS, gain: 1 }];
    }
    case 'stockDraw':
      // Обрыв серии: самая низкая нота гаммы, тише обычного хода.
      return [{ freq: pentFreq(0), atMs: 0, durMs: 260, gain: 0.55 }];
    case 'harvest': {
      // Тёплый двузвук середины гаммы (тоника+«терция»), одновременно.
      const [a, b] = chordIndices(4, 2);
      return [
        { freq: pentFreq(a), atMs: 0, durMs: CHORD_DUR_MS, gain: 0.9 },
        { freq: pentFreq(b), atMs: 0, durMs: CHORD_DUR_MS, gain: 0.7 }
      ];
    }
    case 'win': {
      // Победа: восходящее арпеджио 5 нот через ступень, последняя — акцент.
      const idxs = [1, 3, 5, 7, 9];
      return idxs.map((idx, i) => ({
        freq: pentFreq(idx),
        atMs: i * ARPEGGIO_STEP_MS,
        durMs: 280,
        gain: i === idxs.length - 1 ? 1 : 0.8
      }));
    }
    case 'lose':
      // Две мягкие ноты вниз — утешительно, не мрачно (тихие, середина гаммы).
      return [
        { freq: pentFreq(3), atMs: 0, durMs: 300, gain: 0.6 },
        { freq: pentFreq(1), atMs: 180, durMs: 340, gain: 0.5 }
      ];
    case 'orderDone':
      // «Колокольчик» заказа: 3 голоса верха гаммы (5-7-9), тают дольше ноты;
      // верхние голоса чуть тише — звон, а не столб звука.
      return chordIndices(5, 3).map((idx, v) => ({
        freq: pentFreq(idx),
        atMs: 0,
        durMs: BELL_DUR_MS,
        gain: 0.85 - v * 0.15
      }));
    case 'reward': {
      // Двузвук награды (стрик/миссия) — выше двузвука урожая, короче звона.
      const [a, b] = chordIndices(6, 2);
      return [
        { freq: pentFreq(a), atMs: 0, durMs: CHORD_DUR_MS, gain: 0.85 },
        { freq: pentFreq(b), atMs: 0, durMs: CHORD_DUR_MS, gain: 0.65 }
      ];
    }
  }
}

/* ==================== Настройка «Звук: вкл/выкл» ==================== */

/** Ключ localStorage настройки звука (префикс игры — как у сейвов). */
export const SOUND_KEY = 'orchardPeaks.sound';

/** Прочитать настройку: ПО УМОЛЧАНИЮ ВКЛ (нет ключа/мусор/сбой → true). */
export function readSoundEnabled(storage: KeyValueStorage): boolean {
  try {
    const raw = storage.getItem(SOUND_KEY);
    if (raw === null) return true;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'boolean' ? parsed : true;
  } catch {
    return true;
  }
}

/** Сохранить настройку звука (сбой квоты/приватный режим не роняют игру). */
export function writeSoundEnabled(storage: KeyValueStorage, enabled: boolean): void {
  try {
    storage.setItem(SOUND_KEY, JSON.stringify(enabled));
  } catch {
    /* приватный режим — настройка живёт до перезагрузки */
  }
}
