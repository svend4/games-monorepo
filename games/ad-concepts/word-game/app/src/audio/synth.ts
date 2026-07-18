/**
 * WebAudio-обвязка звука (Проход З): AudioContext, осцилляторы, огибающие.
 *
 * Порт идеи эталона Kotlin на WebAudio: PCM-буферы вручную НЕ генерируем —
 * нота = OscillatorNode('sine') + GainNode-огибающая (атака 10% длительности,
 * сустейн, спад последние 30% — против щелчков), суммирование в мастер-Gain.
 *
 * Autoplay-политика браузера: AudioContext создаётся/резюмируется ЛЕНИВО по
 * первому пользовательскому жесту (unlock()); до этого play() — тихий no-op.
 * В vitest этот класс НЕ инстанцируется (node-среда без WebAudio) — тесты
 * покрывают чистую логику notes.ts и фасад index.ts со стаб-плеером.
 */
import { ATTACK_FRACTION, RELEASE_FRACTION, type NoteSpec } from './notes';

/** Интерфейс проигрывателя: фасад (index.ts) зависит от него, не от WebAudio. */
export interface SoundPlayer {
  /** Запланировать список нот (no-op до unlock() или при setEnabled(false)). */
  play(specs: readonly NoteSpec[]): void;
  /** Вкл/выкл звук: выкл — play() no-op И мастер в 0 (глушит хвосты нот). */
  setEnabled(enabled: boolean): void;
  /** Мастер-громкость 0..1 (мастер-GainNode). */
  setVolume(volume: number): void;
  /** Первый пользовательский жест: создать AudioContext / resume() из suspended. */
  unlock(): void;
}

/** Safari-фолбэк: webkitAudioContext без применения `any`. */
interface WebkitWindow {
  webkitAudioContext?: typeof AudioContext;
}

/** Мастер-громкость по умолчанию (ноты уже несут ~0.45 в огибающей). */
const DEFAULT_MASTER_VOLUME = 0.9;
/** Хвост после спада до stop() осциллятора, с (страховка от щелчка). */
const STOP_TAIL_S = 0.02;

export class WebAudioSynth implements SoundPlayer {
  /** ОДИН AudioContext на приложение; null до первого жеста (autoplay). */
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;
  private volume = DEFAULT_MASTER_VOLUME;

  play(specs: readonly NoteSpec[]): void {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const master = this.master;
    if (ctx === null || master === null) return; // до первого жеста — тихий no-op
    if (ctx.state === 'closed') return; // терминальное состояние — уже не оживёт
    if (ctx.state === 'suspended') {
      // Вкладка/система приостановили аудио: resume ПЕРЕД планированием нот.
      // Ноты всё равно планируем: у suspended-контекста currentTime заморожен,
      // очередь сыграет сразу после resume() — событие не теряется.
      void ctx.resume().catch(() => undefined);
    }
    const now = ctx.currentTime;
    for (const spec of specs) this.scheduleNote(ctx, master, now, spec);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    // Выкл = ПОЛНАЯ тишина сразу: мастер в 0 глушит и уже запланированные
    // хвосты (арпеджио победы, glissando), а не только будущие play().
    this.applyMasterGain();
  }

  setVolume(volume: number): void {
    this.volume = Math.min(Math.max(volume, 0), 1);
    this.applyMasterGain();
  }

  /** Мастер всегда отражает состояние: вкл → volume, выкл → 0. */
  private applyMasterGain(): void {
    if (this.ctx !== null && this.master !== null) {
      this.master.gain.setValueAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime);
    }
  }

  unlock(): void {
    if (this.ctx === null) {
      const Ctor: typeof AudioContext | undefined =
        typeof window !== 'undefined'
          ? (window.AudioContext ?? (window as unknown as WebkitWindow).webkitAudioContext)
          : undefined;
      if (Ctor === undefined) return; // среда без WebAudio — звук остаётся no-op
      try {
        this.ctx = new Ctor();
      } catch {
        return; // создание может упасть (лимит контекстов и т.п.) — без звука
      }
      this.master = this.ctx.createGain();
      // Контекст могли создать при выключенном звуке — мастер сразу в 0.
      this.master.gain.value = this.enabled ? this.volume : 0;
      this.master.connect(this.ctx.destination);
    }
    // Контекст мог родиться suspended (или уснуть) — resume() внутри жеста.
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  /** Одна нота: sine-осциллятор + огибающая атака/сустейн/спад (без щелчков). */
  private scheduleNote(ctx: AudioContext, master: GainNode, now: number, spec: NoteSpec): void {
    const t0 = now + spec.startMs / 1000;
    const dur = spec.durationMs / 1000;
    const attackEnd = t0 + dur * ATTACK_FRACTION;
    const releaseStart = t0 + dur * (1 - RELEASE_FRACTION);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(spec.freq, t0);

    const env = ctx.createGain();
    // Огибающая линейными рампами: 0 → gain (атака) → gain (сустейн) → ~0 (спад).
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(spec.gain, attackEnd);
    env.gain.setValueAtTime(spec.gain, releaseStart);
    env.gain.linearRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(env);
    env.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + STOP_TAIL_S);
    // Уборка графа после звучания (иначе узлы копятся до GC).
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
    };
  }
}
