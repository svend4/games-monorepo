/**
 * Конфиг ядра (порт CFG из prototype/game.js; числа — 05-economy.md).
 * В проде числа уезжают в remote config (05 §10) — здесь константы 1:1.
 */

/** Ключ сейва ядра в localStorage — ТОТ ЖЕ, что в прототипе (совместимость). */
export const CORE_SAVE_KEY = 'wordgrove.save.v1';

/** Стартовый баланс монет (05 §3: 300 — хватает на ~3 Лампы). */
export const START_COINS = 300;

/** «Лампа» — цена подсказки в монетах (05 §2.1). */
export const HINT_COST = 100;

/** Базовая награда за уровень, монет (05 §2.1, 12 §141: levelBase = 20). */
export const WIN_REWARD = 20;

/** «Блестящий проход» без подсказок: +5 монет (05 §2.1). */
export const PERFECT_BONUS = 5;

/** Минимальная длина слова (03 §2.3). */
export const MIN_WORD_LEN = 3;

/** Радиус захвата буквы колеса = 1.3 x визуального (07 §3). */
export const HIT_RADIUS_FACTOR = 1.3;

/** Тайминги UI (порт прототипа; на логику не влияют). */
export const TOAST_MS = 1900;
export const WORD_FLASH_MS = 750;
export const WIN_DELAY_MS = 550;

/** Размеры клетки сетки (DOM-рендер). */
export const MAX_CELL_PX = 56;
export const MIN_CELL_PX = 26;
