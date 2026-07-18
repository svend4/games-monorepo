/**
 * Фасад звука WordGrove (Проход З): настройка вкл/выкл с персистом +
 * маршрутизация игровых событий в проигрыватель + подписка на первый жест.
 *
 * Композиция: notes.ts (чистый выбор нот) → GameAudio (этот файл) →
 * SoundPlayer (synth.ts, WebAudio). В тестах GameAudio получает стаб-плеер,
 * WebAudioSynth не инстанцируется. Персист — localStorage с префиксом игры
 * (ключ wordgrove.sound.v1), ПО УМОЛЧАНИЮ ЗВУК ВКЛЮЧЁН.
 */
import type { KeyValueStorage } from '../core/storage';
import { mapEventToNotes, type SoundEvent } from './notes';
import { WebAudioSynth, type SoundPlayer } from './synth';

export type { SoundEvent } from './notes';

/** Ключ настройки звука в localStorage — префикс игры, как у сейвов. */
export const SOUND_STORAGE_KEY = 'wordgrove.sound.v1';

/**
 * Прочитать настройку звука: по умолчанию ВКЛ (нет ключа / битый JSON / любое
 * значение, кроме явного {"on":false}). Чистая функция — тестируется в node.
 */
export function readSoundEnabled(storage: KeyValueStorage): boolean {
  try {
    const raw = storage.getItem(SOUND_STORAGE_KEY);
    if (raw === null) return true;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'on' in parsed) {
      return (parsed as { on: unknown }).on !== false;
    }
    return true;
  } catch {
    return true; // приватный режим / мусор в ключе — играем со звуком
  }
}

/** Персист настройки звука (схема {on, v:1} в духе wordgrove.onboarding.v1). */
export function writeSoundEnabled(storage: KeyValueStorage, on: boolean): void {
  try {
    storage.setItem(SOUND_STORAGE_KEY, JSON.stringify({ on, v: 1 }));
  } catch {
    /* переполнение квоты / приватный режим — настройка живёт до перезагрузки */
  }
}

/**
 * Фасад для игрового кода: event() — единственная точка входа звука из
 * UI/сцен-слоя (ядро core/ о звуке не знает). Синглтон создаёт main.ts.
 */
export class GameAudio {
  private readonly player: SoundPlayer;
  private enabled: boolean;

  constructor(
    private readonly storage: KeyValueStorage,
    player?: SoundPlayer // тесты подставляют стаб; по умолчанию — WebAudio
  ) {
    this.enabled = readSoundEnabled(storage);
    this.player = player ?? new WebAudioSynth();
    this.player.setEnabled(this.enabled);
  }

  /** Игровое событие → ноты → проигрыватель (no-op при выключенном звуке). */
  event(e: SoundEvent): void {
    if (!this.enabled) return;
    this.player.play(mapEventToNotes(e));
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Переключатель настроек: применяется сразу и персистится. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.player.setEnabled(on);
    writeSoundEnabled(this.storage, on);
  }

  /** Мастер-громкость (сейчас без UI-слайдера; ручка на будущее). */
  setVolume(volume: number): void {
    this.player.setVolume(volume);
  }

  /**
   * Autoplay-политика: разлочить аудио ПЕРВЫМ пользовательским жестом.
   * capture-фаза — unlock срабатывает ДО обработчиков Phaser, и уже первая
   * нота протяжки имеет шанс прозвучать. Слушатели одноразовые (сами снимаются).
   */
  subscribeFirstGesture(): void {
    if (typeof window === 'undefined') return;
    const unlock = (): void => {
      this.player.unlock();
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
    window.addEventListener('pointerdown', unlock, { once: true, capture: true });
    window.addEventListener('keydown', unlock, { once: true, capture: true });
  }
}
