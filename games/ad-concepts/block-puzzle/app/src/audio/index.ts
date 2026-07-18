/**
 * Точка входа звука (ПРОХОД З): синглтон WebAudioSynth + подписка на первый
 * пользовательский жест (autoplay-политика: AudioContext создаётся лениво,
 * ровно один раз, из обработчика жеста; до этого playSound — тихий no-op).
 *
 * Игровой код (сцена/UI) зовёт только playSound(event) — маппинг события в
 * ноты делает чистый notes.ts, планирование — synth.ts. Настройка «Звук»
 * персистится в blocksurge_sound (settings.ts), по умолчанию ВКЛ.
 */
import { noteSpecsFor, type SoundEvent } from './notes';
import { WebAudioSynth } from './synth';
import { loadSoundEnabled, saveSoundEnabled } from './settings';

const synth = new WebAudioSynth();

/* Настройка читается один раз на загрузке (как локаль/тема). */
let enabled = loadSoundEnabled();
synth.setEnabled(enabled);

/** Текущее состояние тумблера «Звук» (для active-подсветки настроек). */
export function soundEnabled(): boolean {
  return enabled;
}

/** Переключить звук: применяется сразу + персист в localStorage. */
export function setSoundEnabled(on: boolean): void {
  enabled = on;
  synth.setEnabled(on);
  saveSoundEnabled(on);
}

/** Мастер-громкость 0..1 (сейчас UI не выставляет — задел под слайдер). */
export function setSoundVolume(volume: number): void {
  synth.setVolume(volume);
}

/** Озвучить игровое событие (карта звуков — notes.ts). Выкл/до жеста — no-op. */
export function playSound(event: SoundEvent): void {
  if (!enabled) return;
  synth.play(noteSpecsFor(event));
}

/* Подписка на ПЕРВЫЙ жест: unlock() идемпотентен, поэтому два once-слушателя
 * (тач/мышь и клавиатура) безопасны. Guard — модуль импортируется и в node. */
if (typeof window !== 'undefined') {
  const unlock = (): void => synth.unlock();
  window.addEventListener('pointerdown', unlock, { once: true, passive: true });
  window.addEventListener('keydown', unlock, { once: true });
}
