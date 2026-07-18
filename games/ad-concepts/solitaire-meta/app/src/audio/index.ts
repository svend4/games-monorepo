/**
 * Синглтон звука (Проход З): связывает чистый маппинг notes.ts, WebAudio-
 * проигрыватель synth.ts, настройку в localStorage и autoplay-разблокировку
 * по первому пользовательскому жесту. UI-слой зовёт sound.play({ kind }) в
 * точках игровых событий; ядро (core/) о звуке не знает.
 */
import {
  readSoundEnabled,
  specsFor,
  writeSoundEnabled,
  type GameSoundEvent
} from './notes';
import { WebAudioPlayer, type SoundPlayer } from './synth';
import { defaultStorage, type KeyValueStorage } from '../economy/store';

class GameSound {
  private readonly player: SoundPlayer;

  constructor(private readonly storage: KeyValueStorage) {
    // Настройка читается на старте: по умолчанию ВКЛ (readSoundEnabled).
    this.player = new WebAudioPlayer(readSoundEnabled(storage));
  }

  /** Сыграть игровое событие (до первого жеста/при выкл — тихий no-op). */
  play(event: GameSoundEvent): void {
    this.player.play(specsFor(event));
  }

  isEnabled(): boolean {
    return this.player.isEnabled();
  }

  /** Настройка ⚙️ «Звук»: применяется сразу и персистится в localStorage. */
  setEnabled(enabled: boolean): void {
    this.player.setEnabled(enabled);
    writeSoundEnabled(this.storage, enabled);
  }

  /** Мастер-громкость 0..1 (на будущее — ползунок в настройках). */
  setVolume(volume: number): void {
    this.player.setVolume(volume);
  }

  /** Разбудить/создать AudioContext — только из пользовательского жеста. */
  unlock(): void {
    this.player.unlock();
  }
}

/** Единственный экземпляр на приложение — один AudioContext (эталон). */
export const sound = new GameSound(defaultStorage());

/**
 * Подписка на ПЕРВЫЙ пользовательский жест (autoplay-политика браузеров):
 * pointerdown ИЛИ keydown (игра играбельна с клавиатуры — доступность 45+),
 * capture-фаза — жест не потеряется за stopPropagation. Слушатели снимаются
 * после первого срабатывания. Вызывается один раз из main.ts.
 */
export function installSoundUnlock(target: Window = window): void {
  const once = (): void => {
    target.removeEventListener('pointerdown', once, true);
    target.removeEventListener('keydown', once, true);
    sound.unlock();
  };
  target.addEventListener('pointerdown', once, true);
  target.addEventListener('keydown', once, true);
}
