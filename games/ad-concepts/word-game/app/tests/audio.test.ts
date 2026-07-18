/**
 * Тесты звука (Проход З) — без реального WebAudio/DOM:
 * notes.ts (пентатоника, маппинг событий в NoteSpec, clamp границ, аккорды,
 * монотонность «выше при большем индексе/длине») и фасад index.ts
 * (персист настройки wordgrove.sound.v1, дефолт ВКЛ, гейт enabled) — со
 * стаб-SoundPlayer. WebAudioSynth проверяется отдельным блоком на
 * МИНИМАЛЬНОМ фейке AudioContext (мьют мастером, resume при suspended,
 * onended-очистка) — браузерный WebAudio в node не трогаем.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  AMPLITUDE,
  ATTACK_FRACTION,
  PENTATONIC,
  RELEASE_FRACTION,
  chordIndices,
  chordRootIndex,
  clampNoteIndex,
  letterFreq,
  mapEventToNotes,
  type NoteSpec,
  type SoundEvent
} from '../src/audio/notes';
import { GameAudio, SOUND_STORAGE_KEY, readSoundEnabled, writeSoundEnabled } from '../src/audio';
import { WebAudioSynth, type SoundPlayer } from '../src/audio/synth';
import { MIN_WORD_LEN } from '../src/core/config';
import type { KeyValueStorage } from '../src/core/storage';

/* In-memory хранилище (как в onboarding.test.ts). */
class MemStorage implements KeyValueStorage {
  readonly m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
}

/* Стаб проигрывателя: записывает вызовы, WebAudio не трогает. */
class StubPlayer implements SoundPlayer {
  readonly played: NoteSpec[][] = [];
  enabled = true;
  volume = -1;
  unlocked = 0;
  play(specs: readonly NoteSpec[]): void {
    this.played.push(specs.slice());
  }
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
  setVolume(volume: number): void {
    this.volume = volume;
  }
  unlock(): void {
    this.unlocked++;
  }
}

describe('пентатоника C4–A5 (эталон Kotlin)', () => {
  it('10 нот, границы 261.63 и 880.00 Гц, строго возрастает', () => {
    expect(PENTATONIC).toHaveLength(10);
    expect(PENTATONIC[0]).toBeCloseTo(261.63, 2);
    expect(PENTATONIC[3]).toBeCloseTo(392.0, 2);
    expect(PENTATONIC[9]).toBeCloseTo(880.0, 2);
    for (let i = 1; i < PENTATONIC.length; i++) {
      expect(PENTATONIC[i]).toBeGreaterThan(PENTATONIC[i - 1]);
    }
  });

  it('clampNoteIndex: зажим в [0..9], мусор → 0', () => {
    expect(clampNoteIndex(0)).toBe(0);
    expect(clampNoteIndex(9)).toBe(9);
    expect(clampNoteIndex(99)).toBe(9);
    expect(clampNoteIndex(-5)).toBe(0);
    expect(clampNoteIndex(Number.NaN)).toBe(0);
  });

  it('огибающая эталона: атака 10%, спад 30%, амплитуда 0.45', () => {
    expect(ATTACK_FRACTION).toBeCloseTo(0.1, 5);
    expect(RELEASE_FRACTION).toBeCloseTo(0.3, 5);
    expect(AMPLITUDE).toBeCloseTo(0.45, 5);
  });
});

describe('мелодия протяжки: letterAdd / letterRemove', () => {
  it('n-я буква — n-я нота пентатоники, монотонно вверх', () => {
    for (let i = 0; i < PENTATONIC.length; i++) {
      expect(letterFreq(i)).toBe(PENTATONIC[i]);
    }
    for (let i = 0; i + 1 < PENTATONIC.length; i++) {
      expect(letterFreq(i + 1)).toBeGreaterThan(letterFreq(i)); // «выше при большей серии»
    }
  });

  it('за границей пентатоники — clamp (длинные слова не ломают звук)', () => {
    expect(letterFreq(25)).toBe(PENTATONIC[9]);
    expect(letterFreq(-1)).toBe(PENTATONIC[0]);
  });

  it('letterAdd: одна нота, старт сразу, амплитуда эталона, 200–350 мс', () => {
    const notes = mapEventToNotes({ type: 'letterAdd', index: 2 });
    expect(notes).toHaveLength(1);
    expect(notes[0].freq).toBe(PENTATONIC[2]);
    expect(notes[0].startMs).toBe(0);
    expect(notes[0].gain).toBe(AMPLITUDE);
    expect(notes[0].durationMs).toBeGreaterThanOrEqual(180);
    expect(notes[0].durationMs).toBeLessThanOrEqual(350);
  });

  it('откат буквы — нота вниз и тише добавления', () => {
    const removed = mapEventToNotes({ type: 'letterRemove', index: 3 })[0];
    const added = mapEventToNotes({ type: 'letterAdd', index: 4 })[0];
    expect(removed.freq).toBeLessThan(added.freq); // вернулись ниже
    expect(removed.gain).toBeLessThan(added.gain);
    expect(removed.freq).toBe(PENTATONIC[3]);
  });
});

describe('wordValid: мажорный аккорд пентатоники', () => {
  it('тоника+терция+квинта пентатоники (индексы через 2), одновременно', () => {
    const len = MIN_WORD_LEN + 2;
    const idx = chordIndices(len);
    expect(idx).toEqual([2, 4, 6]);
    const notes = mapEventToNotes({ type: 'wordValid', length: len });
    expect(notes).toHaveLength(3);
    expect(notes.map((n) => n.freq)).toEqual(idx.map((i) => PENTATONIC[i]));
    for (const n of notes) expect(n.startMs).toBe(0); // аккорд, не арпеджио
  });

  it('минимальное слово — от тоники C4; длиннее слово — выше корень', () => {
    expect(chordRootIndex(MIN_WORD_LEN)).toBe(0);
    for (let len = MIN_WORD_LEN; len < MIN_WORD_LEN + 5; len++) {
      expect(chordRootIndex(len + 1)).toBeGreaterThan(chordRootIndex(len));
    }
  });

  it('clamp корня: сверхдлинное слово не вылезает за пентатонику', () => {
    expect(chordRootIndex(99)).toBe(PENTATONIC.length - 5);
    const top = chordIndices(99);
    expect(top[top.length - 1]).toBe(PENTATONIC.length - 1);
    expect(chordRootIndex(0)).toBe(0); // и снизу тоже зажат
  });
});

describe('остальные события карты звуков', () => {
  it('бонусное слово: двузвук одновременно + высокая нота «жёлудь» позже', () => {
    const notes = mapEventToNotes({ type: 'wordBonus' });
    expect(notes).toHaveLength(3);
    expect(notes[0].startMs).toBe(0);
    expect(notes[1].startMs).toBe(0); // двузвук
    expect(notes[0].freq).not.toBe(notes[1].freq);
    expect(notes[2].startMs).toBeGreaterThan(0); // «жёлудь» — после
    expect(notes[2].freq).toBe(PENTATONIC[9]); // высокая нота
  });

  it('невалидное слово: одна нейтральная НИЗКАЯ нота, мягче эталона', () => {
    const notes = mapEventToNotes({ type: 'wordInvalid' });
    expect(notes).toHaveLength(1);
    expect(notes[0].freq).toBe(PENTATONIC[0]); // самая низкая — не «обидная»
    expect(notes[0].gain).toBeLessThan(AMPLITUDE);
  });

  it('дубликат — ещё тише невалидного (нейтральность)', () => {
    const dup = mapEventToNotes({ type: 'wordDuplicate' })[0];
    const bad = mapEventToNotes({ type: 'wordInvalid' })[0];
    expect(dup.gain).toBeLessThan(bad.gain);
  });

  it('подсказка: «волшебный» glissando вверх (частоты и старты растут)', () => {
    const notes = mapEventToNotes({ type: 'hint' });
    expect(notes.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < notes.length; i++) {
      expect(notes[i].freq).toBeGreaterThan(notes[i - 1].freq);
      expect(notes[i].startMs).toBeGreaterThan(notes[i - 1].startMs);
    }
  });

  it('уровень пройден: арпеджио от тоники вверх, последовательно', () => {
    const notes = mapEventToNotes({ type: 'levelComplete' });
    expect(notes.length).toBeGreaterThanOrEqual(4);
    expect(notes[0].freq).toBe(PENTATONIC[0]);
    expect(notes[notes.length - 1].freq).toBe(PENTATONIC[9]);
    for (let i = 1; i < notes.length; i++) {
      expect(notes[i].freq).toBeGreaterThan(notes[i - 1].freq);
      expect(notes[i].startMs).toBeGreaterThan(notes[i - 1].startMs);
    }
  });

  it('клик-тон меты: короткий и тихий', () => {
    const notes = mapEventToNotes({ type: 'uiClick' });
    expect(notes).toHaveLength(1);
    expect(notes[0].durationMs).toBeLessThanOrEqual(120);
    expect(notes[0].gain).toBeLessThan(AMPLITUDE / 2);
  });

  it('ВСЕ частоты всех событий — из пентатоники (гармония гарантирована)', () => {
    const events: readonly SoundEvent[] = [
      { type: 'letterAdd', index: 4 },
      { type: 'letterRemove', index: 1 },
      { type: 'wordValid', length: 7 },
      { type: 'wordBonus' },
      { type: 'wordDuplicate' },
      { type: 'wordInvalid' },
      { type: 'hint' },
      { type: 'levelComplete' },
      { type: 'uiClick' }
    ];
    for (const e of events) {
      for (const n of mapEventToNotes(e)) {
        expect(PENTATONIC, e.type).toContain(n.freq);
        expect(n.gain).toBeGreaterThan(0);
        expect(n.gain).toBeLessThanOrEqual(AMPLITUDE);
        expect(n.durationMs).toBeGreaterThan(0);
      }
    }
  });
});

describe('настройка звука: персист wordgrove.sound.v1, дефолт ВКЛ', () => {
  it('ключ — с префиксом игры', () => {
    expect(SOUND_STORAGE_KEY).toBe('wordgrove.sound.v1');
  });

  it('нет ключа → ВКЛ по умолчанию; выкл/вкл персистится', () => {
    const storage = new MemStorage();
    expect(readSoundEnabled(storage)).toBe(true);
    writeSoundEnabled(storage, false);
    expect(readSoundEnabled(storage)).toBe(false);
    writeSoundEnabled(storage, true);
    expect(readSoundEnabled(storage)).toBe(true);
  });

  it('битый JSON / чужая схема не роняют и дают дефолт ВКЛ', () => {
    const storage = new MemStorage();
    storage.setItem(SOUND_STORAGE_KEY, '{oops');
    expect(readSoundEnabled(storage)).toBe(true);
    storage.setItem(SOUND_STORAGE_KEY, '{"volume":0.5}');
    expect(readSoundEnabled(storage)).toBe(true);
  });

  it('GameAudio: событие идёт в плеер нотами; выкл — гейт + персист', () => {
    const storage = new MemStorage();
    const player = new StubPlayer();
    const audio = new GameAudio(storage, player);
    expect(audio.isEnabled()).toBe(true); // ПО УМОЛЧАНИЮ ВКЛ
    audio.event({ type: 'letterAdd', index: 0 });
    expect(player.played).toHaveLength(1);
    expect(player.played[0][0].freq).toBe(PENTATONIC[0]);

    audio.setEnabled(false);
    audio.event({ type: 'wordValid', length: 5 });
    expect(player.played).toHaveLength(1); // выключено — нот не прибавилось
    expect(player.enabled).toBe(false); // прокинуто в плеер
    expect(readSoundEnabled(storage)).toBe(false); // и персистнуто

    // Новый запуск на том же хранилище — настройка выжила.
    const again = new GameAudio(storage, new StubPlayer());
    expect(again.isEnabled()).toBe(false);
  });
});

/* ================= WebAudioSynth на минимальном фейке AudioContext ========== */

/** Параметр (gain/frequency): помним последнее значение setValueAtTime/ramp. */
class FakeParam {
  value = 0;
  setValueAtTime(v: number, _t: number): void {
    this.value = v;
  }
  linearRampToValueAtTime(v: number, _t: number): void {
    this.value = v;
  }
}

class FakeGain {
  readonly gain = new FakeParam();
  connect(): void {}
  disconnect(): void {}
}

class FakeOscillator {
  type = '';
  readonly frequency = new FakeParam();
  onended: (() => void) | null = null;
  started = 0;
  stopped = 0;
  connect(): void {}
  disconnect(): void {}
  start(): void {
    this.started++;
  }
  stop(): void {
    this.stopped++;
  }
}

class FakeCtx {
  static last: FakeCtx | null = null;
  state: AudioContextState = 'running';
  currentTime = 0;
  readonly destination = {};
  resumed = 0;
  readonly gains: FakeGain[] = [];
  readonly oscs: FakeOscillator[] = [];
  constructor() {
    FakeCtx.last = this;
  }
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createOscillator(): FakeOscillator {
    const o = new FakeOscillator();
    this.oscs.push(o);
    return o;
  }
  resume(): Promise<void> {
    this.resumed++;
    this.state = 'running';
    return Promise.resolve();
  }
}

/** Подсунуть fake-window c AudioContext (node-среда window не имеет). */
function installFakeWindow(): void {
  FakeCtx.last = null;
  (globalThis as { window?: unknown }).window = {
    AudioContext: FakeCtx as unknown as typeof AudioContext
  };
}

describe('WebAudioSynth: autoplay, мьют мастером, resume при suspended', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    FakeCtx.last = null;
  });

  it('до unlock() play() — тихий no-op: контекст НЕ создаётся, исключений нет', () => {
    installFakeWindow();
    const synth = new WebAudioSynth();
    expect(() => synth.play(mapEventToNotes({ type: 'uiClick' }))).not.toThrow();
    expect(FakeCtx.last).toBeNull(); // AudioContext появляется ТОЛЬКО в unlock()
  });

  it('unlock() создаёт контекст один раз; повторный unlock() не плодит их', () => {
    installFakeWindow();
    const synth = new WebAudioSynth();
    synth.unlock();
    const first = FakeCtx.last;
    expect(first).not.toBeNull();
    synth.unlock();
    expect(FakeCtx.last).toBe(first); // ОДИН AudioContext на приложение
  });

  it('выкл = полная тишина: мастер в 0 сразу, setVolume при выкл не размучивает', () => {
    installFakeWindow();
    const synth = new WebAudioSynth();
    synth.unlock();
    const ctx = FakeCtx.last as FakeCtx;
    const master = ctx.gains[0];
    expect(master.gain.value).toBeGreaterThan(0); // вкл по умолчанию

    synth.setEnabled(false);
    expect(master.gain.value).toBe(0); // глушит и уже запланированные хвосты
    synth.setVolume(0.5);
    expect(master.gain.value).toBe(0); // громкость при выкл не пробивает мьют
    synth.setEnabled(true);
    expect(master.gain.value).toBe(0.5); // вкл — вернулась выставленная громкость
  });

  it('unlock() при заранее выключенном звуке — мастер рождается в 0', () => {
    installFakeWindow();
    const synth = new WebAudioSynth();
    synth.setEnabled(false);
    synth.unlock();
    const ctx = FakeCtx.last as FakeCtx;
    expect(ctx.gains[0].gain.value).toBe(0);
  });

  it('suspended: resume() ПЕРЕД планированием, ноты не теряются', () => {
    installFakeWindow();
    const synth = new WebAudioSynth();
    synth.unlock();
    const ctx = FakeCtx.last as FakeCtx;
    ctx.state = 'suspended';
    synth.play(mapEventToNotes({ type: 'letterAdd', index: 0 }));
    expect(ctx.resumed).toBe(1); // разбудили контекст
    expect(ctx.oscs).toHaveLength(1); // и ноту всё же запланировали
    expect(ctx.oscs[0].started).toBe(1);
  });

  it('нет утечек: каждый осциллятор останавливается и имеет onended-очистку', () => {
    installFakeWindow();
    const synth = new WebAudioSynth();
    synth.unlock();
    const ctx = FakeCtx.last as FakeCtx;
    synth.play(mapEventToNotes({ type: 'levelComplete' }));
    expect(ctx.oscs.length).toBeGreaterThanOrEqual(4);
    for (const osc of ctx.oscs) {
      expect(osc.started).toBe(1);
      expect(osc.stopped).toBe(1); // stop() запланирован — узел не вечный
      expect(typeof osc.onended).toBe('function'); // уборка графа после звучания
      osc.onended?.(); // не бросает при disconnect
    }
  });

  it('среда без WebAudio (нет конструктора): unlock()/play() — безопасные no-op', () => {
    (globalThis as { window?: unknown }).window = {}; // window есть, WebAudio нет
    const synth = new WebAudioSynth();
    expect(() => {
      synth.unlock();
      synth.play(mapEventToNotes({ type: 'hint' }));
    }).not.toThrow();
  });
});
