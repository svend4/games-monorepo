/**
 * WebAudio-синтезатор (ПРОХОД З): единственный модуль, знающий про AudioContext.
 * В тестах НЕ инстанцируется — вся выбираемая логика (какие ноты играть)
 * живёт в чистом notes.ts.
 *
 * Реализация эталона на WebAudio:
 *  - НЕ генерируем PCM-буферы вручную — синусоида это OscillatorNode('sine');
 *  - огибающая против щелчков — GainNode + linearRampToValueAtTime:
 *    атака 10% длительности → сустейн → спад последние 30%;
 *  - один AudioContext на приложение + мастер-GainNode для общей громкости.
 *
 * Autoplay-политика браузеров: контекст создаётся ЛЕНИВО в unlock() —
 * index.ts зовёт его по первому пользовательскому жесту (pointerdown/keydown).
 * До unlock() play() — тихий no-op; suspended-контекст резюмируется resume().
 */
import type { NoteSpec } from './notes';

/** Интерфейс проигрывателя — игровой код зависит только от него. */
export interface SoundPlayer {
  /** Запланировать пачку нот (см. notes.ts). До первого жеста — no-op. */
  play(specs: readonly NoteSpec[]): void;
  /** Вкл/выкл звук (выкл — play() ничего не планирует). */
  setEnabled(on: boolean): void;
  /** Мастер-громкость 0..1 (поверх амплитуд нот). */
  setVolume(volume: number): void;
  /** Создать/резюмировать AudioContext — звать из обработчика жеста. */
  unlock(): void;
}

/** Доля длительности ноты на атаку (эталон: 10%). */
const ATTACK_FRAC = 0.1;
/** Доля длительности ноты на спад (эталон: последние 30%). */
const RELEASE_FRAC = 0.3;
/** Мастер-громкость по умолчанию (оставляет запас под аккорды). */
const DEFAULT_MASTER_VOLUME = 0.8;

/** Окно с учётом старых Safari/WebView (префиксный webkitAudioContext). */
interface AudioWindow {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

export class WebAudioSynth implements SoundPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;
  private volume = DEFAULT_MASTER_VOLUME;

  unlock(): void {
    // Без window (node) — молча остаёмся no-op-плеером.
    if (typeof window === 'undefined') return;
    if (this.ctx === null) {
      const w = window as unknown as AudioWindow;
      const Ctor = w.AudioContext ?? w.webkitAudioContext; // старые Safari/WebView
      if (Ctor === undefined) return; // WebAudio недоступен — играем молча
      try {
        this.ctx = new Ctor();
      } catch {
        return; // сбой создания контекста не роняет обработчик жеста
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? this.volume : 0;
      this.master.connect(this.ctx.destination);
    }
    // Жест пользователя — легитимный момент снять suspended (autoplay-политика).
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => undefined); // reject ≠ unhandled rejection
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    // Выкл = мгновенная ПОЛНАЯ тишина: мастер в 0 глушит и уже запланированные
    // ноты (хвост глиссандо/game over ~0.8 c), а не только будущие play().
    this.applyMasterGain();
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyMasterGain();
  }

  /** Мастер-ручка: громкость при вкл, жёсткий 0 при выкл. */
  private applyMasterGain(): void {
    if (this.master !== null) this.master.gain.value = this.enabled ? this.volume : 0;
  }

  play(specs: readonly NoteSpec[]): void {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const master = this.master;
    if (ctx === null || master === null) return; // до первого жеста — тихий no-op
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => undefined); // вернулись из фона (iOS) — будим
    }
    const now = ctx.currentTime;
    for (const spec of specs) this.scheduleNote(ctx, master, spec, now);
  }

  /** Одна нота: sine-осциллятор + огибающая атака/сустейн/спад (без щелчков). */
  private scheduleNote(ctx: AudioContext, out: GainNode, spec: NoteSpec, now: number): void {
    const start = now + spec.startMs / 1000;
    const dur = Math.max(0.03, spec.durationMs / 1000);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(spec.freq, start);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(spec.gain, start + dur * ATTACK_FRAC);
    env.gain.setValueAtTime(spec.gain, start + dur * (1 - RELEASE_FRAC));
    env.gain.linearRampToValueAtTime(0, start + dur);

    osc.connect(env);
    env.connect(out);
    osc.start(start);
    osc.stop(start + dur + 0.02);
    // Освобождаем граф после отзвучивания — партия длинная, узлы копить нельзя.
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
    };
  }
}
