/**
 * WebAudio-обвязка звука (Проход З): AudioContext, осцилляторы, огибающие,
 * планирование по currentTime. В ТЕСТАХ НЕ ИНСТАНЦИРУЕТСЯ — проверяемая
 * логика (частоты/маппинг событий) живёт в notes.ts.
 *
 * Синтез по эталону: OscillatorNode('sine') + GainNode-огибающая — атака 10%
 * длительности, сустейн, спад последние 30% (linearRampToValueAtTime) против
 * щелчков. PCM-буферы вручную НЕ генерируем — в WebAudio это осцилляторы.
 *
 * Autoplay-политика браузеров: AudioContext создаётся ЛЕНИВО по первому
 * пользовательскому жесту (unlock() зовёт src/audio/index.ts); до этого
 * play() — тихий no-op. Состояние 'suspended' лечится resume().
 */
import { BASE_AMPLITUDE, MASTER_VOLUME_DEFAULT, type NoteSpec } from './notes';

/** Интерфейс проигрывателя: UI зависит от него, а не от WebAudio напрямую. */
export interface SoundPlayer {
  /** Сыграть план нот (notes.ts). До unlock()/при выкл — тихий no-op. */
  play(specs: readonly NoteSpec[]): void;
  /** Вкл/выкл звука (настройка ⚙️): off — play() мгновенно выходит. */
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  /** Мастер-громкость 0..1 (по умолчанию MASTER_VOLUME_DEFAULT ≈ 0.6). */
  setVolume(volume: number): void;
  /** Создать/разбудить AudioContext — звать ТОЛЬКО из жеста пользователя. */
  unlock(): void;
}

/** Окно с учётом старых Safari (префиксный webkitAudioContext). */
interface AudioWindow {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

export class WebAudioPlayer implements SoundPlayer {
  /** Один AudioContext на приложение; null до первого жеста. */
  private ctx: AudioContext | null = null;
  /** Мастер-GainNode громкости (общая ручка поверх огибающих нот). */
  private master: GainNode | null = null;
  private enabled: boolean;
  private volume: number;

  constructor(enabled = true, volume: number = MASTER_VOLUME_DEFAULT) {
    this.enabled = enabled;
    this.volume = clamp01(volume);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    // Выкл = ПОЛНАЯ тишина сразу: мастер глушит и уже запланированные ноты
    // (например, хвост арпеджио победы), а не только будущие play().
    this.applyMasterGain();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setVolume(volume: number): void {
    this.volume = clamp01(volume);
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
      const w = window as unknown as AudioWindow;
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      if (Ctor === undefined) return; // WebAudio недоступен — играем молча
      try {
        this.ctx = new Ctor();
      } catch {
        return; // сбой создания контекста не роняет игру
      }
      this.master = this.ctx.createGain();
      // Контекст могли создать при выключенном звуке — мастер сразу в 0.
      this.master.gain.value = this.enabled ? this.volume : 0;
      this.master.connect(this.ctx.destination);
    }
    // Жест пользователя — законный момент разбудить приостановленный контекст.
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => undefined);
    }
  }

  play(specs: readonly NoteSpec[]): void {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const master = this.master;
    if (ctx === null || master === null) return; // до первого жеста — no-op
    if (ctx.state === 'suspended') {
      // Фоновая вкладка/возврат в приложение: пробуем разбудить, ноту не ждём.
      void ctx.resume().catch(() => undefined);
    }
    const now = ctx.currentTime;
    for (const spec of specs) scheduleNote(ctx, master, now, spec);
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Одна нота: sine-осциллятор + GainNode-огибающая по эталону —
 * 0 → (атака 10% длительности) → сустейн → (спад последние 30%) → 0.
 */
function scheduleNote(ctx: AudioContext, master: GainNode, now: number, spec: NoteSpec): void {
  const t0 = now + spec.atMs / 1000;
  const dur = spec.durMs / 1000;
  const peak = BASE_AMPLITUDE * spec.gain;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(spec.freq, t0);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + dur * 0.1); // атака 10%
  env.gain.setValueAtTime(peak, t0 + dur * 0.7); // сустейн до начала спада
  env.gain.linearRampToValueAtTime(0, t0 + dur); // спад — последние 30%

  osc.connect(env);
  env.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
  // Убираем узлы за собой — длинная сессия не копит мёртвые ноды графа.
  osc.onended = () => {
    osc.disconnect();
    env.disconnect();
  };
}
