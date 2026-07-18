/**
 * WordGrove — данные 12 встроенных АНГЛИЙСКИХ уровней (Проход Ж.2).
 *
 * Источник: офлайн-генератор tools/gen-levels.ts (реализация приложения 11
 * §2–3: курируемый EN-словарь, отбор слов по мультимножеству букв базы,
 * укладка backtracking со скорингом компактности). Данные сгенерированы
 * командой `npx tsx tools/gen-levels.ts` (пакет EN_PACK_INDEX = 0, словарь
 * 1.0.0) и отобраны вручную: базы слотов и правило «не более одной вложенной
 * пары» (PAINT+PAINTER — да, PAIN+PAINT+PAINTER — нет) — курируемая часть.
 * НЕ редактируйте числа руками: тест levelsEn.test.ts сверяет массив с
 * повторной генерацией бит-в-бит (INV-W4) — правки делаются через генератор.
 *
 * Прогрессия сложности: колесо 6 → 7 букв, слов сетки 4 → 8 (полосы D1–D4
 * из 11 §3.1). Инварианты — те же, что у русского набора (levels.ts):
 *   INV-W1: каждое слово сетки и каждый бонус составимы из мультимножества
 *           букв колеса;
 *   INV-W2: каждый максимальный ран >= 2 клеток — ровно одно целевое слово,
 *           сетка связна, bbox <= 9x9;
 *   бонус-слова: длина >= 3, без дублей и без пересечения со словами сетки.
 * Проверяются validateLevel (validate.ts) в tests/levelsEn.test.ts.
 */
import type { LevelData } from './types';

export const LEVELS_EN: readonly LevelData[] = [
  {
    base: 'GARDEN',
    wheel: ['N', 'R', 'G', 'A', 'D', 'E'],
    size: { w: 6, h: 6 },
    words: [
      { w: 'GARDEN', r: 4, c: 0, d: 'H' },
      { w: 'DANGER', r: 0, c: 4, d: 'V' },
      { w: 'GRAND', r: 0, c: 0, d: 'H' },
      { w: 'ANGER', r: 0, c: 2, d: 'V' }
    ],
    bonus: ['AGE', 'AGED', 'AND', 'ARE', 'DARE', 'DEAR', 'DEN', 'EAR', 'EARN', 'END', 'ERA', 'GEAR', 'GRADE', 'NEAR', 'RAG', 'RAGE', 'RAN', 'RANG', 'RANGE', 'READ', 'RED']
  },
  {
    base: 'PLANET',
    wheel: ['N', 'A', 'P', 'T', 'L', 'E'],
    size: { w: 6, h: 7 },
    words: [
      { w: 'PLANET', r: 4, c: 0, d: 'H' },
      { w: 'PLANT', r: 0, c: 5, d: 'V' },
      { w: 'PETAL', r: 0, c: 1, d: 'V' },
      { w: 'PANEL', r: 2, c: 3, d: 'V' }
    ],
    bonus: ['ALE', 'ANT', 'ATE', 'EAT', 'LANE', 'LAP', 'LATE', 'LEAN', 'LEAP', 'LET', 'NAP', 'NEAT', 'NET', 'PALE', 'PAN', 'PANE', 'PAT', 'PEA', 'PEN', 'PET', 'PLAN', 'PLANE', 'PLATE', 'TALE', 'TAN', 'TAP', 'TAPE', 'TEA', 'TEN']
  },
  {
    base: 'CANDLE',
    wheel: ['N', 'C', 'D', 'A', 'E', 'L'],
    size: { w: 7, h: 8 },
    words: [
      { w: 'CANDLE', r: 4, c: 1, d: 'H' },
      { w: 'DANCE', r: 0, c: 6, d: 'V' },
      { w: 'CLEAN', r: 0, c: 3, d: 'V' },
      { w: 'DEAL', r: 1, c: 0, d: 'H' },
      { w: 'CLAN', r: 4, c: 1, d: 'V' }
    ],
    bonus: ['ACE', 'ALE', 'AND', 'CAN', 'CANE', 'DEN', 'END', 'LACE', 'LAD', 'LAND', 'LANE', 'LEAD', 'LEAN', 'LED']
  },
  {
    base: 'MASTER',
    wheel: ['T', 'A', 'S', 'R', 'E', 'M'],
    size: { w: 8, h: 6 },
    words: [
      { w: 'MASTER', r: 3, c: 0, d: 'H' },
      { w: 'STREAM', r: 0, c: 4, d: 'V' },
      { w: 'SMART', r: 1, c: 1, d: 'V' },
      { w: 'STEAM', r: 5, c: 0, d: 'H' },
      { w: 'STARE', r: 1, c: 3, d: 'H' }
    ],
    bonus: ['ARE', 'ARM', 'ART', 'ATE', 'EAR', 'EAST', 'EAT', 'ERA', 'MAST', 'MAT', 'MATE', 'MEAT', 'MET', 'RAT', 'RATE', 'REST', 'SAME', 'SAT', 'SEA', 'SEAT', 'SET', 'STAR', 'STEM', 'TAME', 'TAR', 'TEA', 'TEAM', 'TEAR', 'TERM']
  },
  {
    base: 'BASKET',
    wheel: ['K', 'E', 'S', 'T', 'B', 'A'],
    size: { w: 6, h: 8 },
    words: [
      { w: 'BASKET', r: 4, c: 0, d: 'H' },
      { w: 'STAKE', r: 0, c: 4, d: 'V' },
      { w: 'STEAK', r: 2, c: 1, d: 'H' },
      { w: 'BEAST', r: 0, c: 1, d: 'H' },
      { w: 'BASE', r: 4, c: 0, d: 'V' }
    ],
    bonus: ['ASK', 'ATE', 'BAKE', 'BAT', 'BEAT', 'BEST', 'BET', 'EAST', 'EAT', 'SAKE', 'SAT', 'SEA', 'SEAT', 'SET', 'SKATE', 'TAB', 'TAKE', 'TASK', 'TEA']
  },
  {
    base: 'SILENT',
    wheel: ['N', 'L', 'T', 'I', 'S', 'E'],
    size: { w: 8, h: 7 },
    words: [
      { w: 'SILENT', r: 4, c: 1, d: 'H' },
      { w: 'ENLIST', r: 0, c: 1, d: 'V' },
      { w: 'LISTEN', r: 1, c: 6, d: 'V' },
      { w: 'INLET', r: 1, c: 4, d: 'V' },
      { w: 'ISLE', r: 1, c: 4, d: 'H' },
      { w: 'LENS', r: 0, c: 0, d: 'H' }
    ],
    bonus: ['ITS', 'LET', 'LIE', 'LINE', 'LIST', 'NEST', 'NET', 'SENT', 'SET', 'SIT', 'SITE', 'TEN', 'TIE', 'TILE', 'TIN']
  },
  {
    base: 'PAINTER',
    wheel: ['A', 'R', 'P', 'N', 'I', 'E', 'T'],
    size: { w: 8, h: 7 },
    words: [
      { w: 'PAINTER', r: 4, c: 0, d: 'H' },
      { w: 'PRINT', r: 0, c: 4, d: 'V' },
      { w: 'PAINT', r: 2, c: 2, d: 'V' },
      { w: 'TRAIN', r: 6, c: 2, d: 'H' },
      { w: 'PANE', r: 0, c: 4, d: 'H' },
      { w: 'EARN', r: 0, c: 7, d: 'V' }
    ],
    bonus: ['AIR', 'ANT', 'ARE', 'ART', 'ATE', 'EAR', 'EAT', 'ERA', 'NAP', 'NEAR', 'NEAT', 'NET', 'PAIN', 'PAIR', 'PAN', 'PART', 'PAT', 'PEA', 'PEAR', 'PEN', 'PET', 'PIE', 'PIN', 'PINE', 'PIT', 'RAIN', 'RAN', 'RAT', 'RATE', 'RENT', 'RIP', 'RIPE', 'TAN', 'TAP', 'TAPE', 'TAR', 'TEA', 'TEAR', 'TEN', 'TIE', 'TIN', 'TIP', 'TRAP', 'TRIP']
  },
  {
    base: 'KITCHEN',
    wheel: ['K', 'N', 'H', 'T', 'E', 'C', 'I'],
    size: { w: 7, h: 8 },
    words: [
      { w: 'KITCHEN', r: 4, c: 0, d: 'H' },
      { w: 'THICK', r: 0, c: 0, d: 'V' },
      { w: 'HIKE', r: 1, c: 0, d: 'H' },
      { w: 'CHIN', r: 4, c: 3, d: 'V' },
      { w: 'KNIT', r: 1, c: 2, d: 'V' },
      { w: 'KITE', r: 1, c: 5, d: 'V' }
    ],
    bonus: ['HEN', 'HINT', 'HIT', 'ICE', 'INCH', 'INK', 'ITCH', 'KIT', 'NECK', 'NET', 'NICE', 'TEN', 'THE', 'THEN', 'THIN', 'TICK', 'TIE', 'TIN']
  },
  {
    base: 'TEACHER',
    wheel: ['H', 'T', 'C', 'E', 'A', 'R', 'E'],
    size: { w: 9, h: 9 },
    words: [
      { w: 'TEACHER', r: 4, c: 1, d: 'H' },
      { w: 'CREATE', r: 0, c: 1, d: 'V' },
      { w: 'HEATER', r: 0, c: 6, d: 'V' },
      { w: 'CRATE', r: 4, c: 4, d: 'V' },
      { w: 'CHEAT', r: 2, c: 3, d: 'H' },
      { w: 'EARTH', r: 8, c: 4, d: 'H' },
      { w: 'CHART', r: 7, c: 0, d: 'H' }
    ],
    bonus: ['ACE', 'ACHE', 'ACT', 'ARCH', 'ARE', 'ART', 'ATE', 'CAR', 'CARE', 'CART', 'CAT', 'CHAT', 'CHEER', 'EACH', 'EAR', 'EAT', 'ERA', 'HAT', 'HATE', 'HEAR', 'HEART', 'HEAT', 'HER', 'HERE', 'RACE', 'RAT', 'RATE', 'REACH', 'TAR', 'TEA', 'TEACH', 'TEAR', 'THE', 'THREE', 'TRACE']
  },
  {
    base: 'THUNDER',
    wheel: ['T', 'H', 'N', 'E', 'U', 'R', 'D'],
    size: { w: 9, h: 8 },
    words: [
      { w: 'THUNDER', r: 4, c: 1, d: 'H' },
      { w: 'HUNTER', r: 0, c: 6, d: 'V' },
      { w: 'UNDER', r: 3, c: 4, d: 'V' },
      { w: 'TREND', r: 7, c: 3, d: 'H' },
      { w: 'HURT', r: 1, c: 1, d: 'V' },
      { w: 'DUNE', r: 1, c: 5, d: 'H' },
      { w: 'HUNT', r: 2, c: 0, d: 'H' }
    ],
    bonus: ['DEN', 'DUE', 'END', 'HEN', 'HER', 'HERD', 'HUT', 'NET', 'NUT', 'RED', 'RENT', 'RUDE', 'RUN', 'TEN', 'TEND', 'THE', 'THEN', 'TUNE', 'TURN']
  },
  {
    base: 'CHAPTER',
    wheel: ['A', 'P', 'T', 'R', 'E', 'H', 'C'],
    size: { w: 8, h: 9 },
    words: [
      { w: 'CHAPTER', r: 4, c: 1, d: 'H' },
      { w: 'CARPET', r: 1, c: 4, d: 'V' },
      { w: 'CHART', r: 1, c: 7, d: 'V' },
      { w: 'CHEAT', r: 4, c: 1, d: 'V' },
      { w: 'HEART', r: 6, c: 0, d: 'H' },
      { w: 'PERCH', r: 1, c: 1, d: 'H' },
      { w: 'REACH', r: 0, c: 2, d: 'V' }
    ],
    bonus: ['ACE', 'ACHE', 'ACT', 'ARCH', 'ARE', 'ART', 'ATE', 'CAP', 'CAPE', 'CAR', 'CARE', 'CART', 'CAT', 'CHAT', 'CRATE', 'EACH', 'EAR', 'EARTH', 'EAT', 'ERA', 'HAT', 'HATE', 'HEAR', 'HEAT', 'HER', 'PACE', 'PART', 'PAT', 'PATCH', 'PATH', 'PEA', 'PEACH', 'PEAR', 'PET', 'RACE', 'RAT', 'RATE', 'TAP', 'TAPE', 'TAR', 'TEA', 'TEACH', 'TEAR', 'THE', 'TRACE', 'TRAP']
  },
  {
    base: 'STRANGE',
    wheel: ['R', 'T', 'E', 'N', 'G', 'S', 'A'],
    size: { w: 9, h: 9 },
    words: [
      { w: 'STRANGE', r: 4, c: 1, d: 'H' },
      { w: 'GREAT', r: 0, c: 2, d: 'V' },
      { w: 'AGENT', r: 0, c: 1, d: 'H' },
      { w: 'RANGE', r: 0, c: 7, d: 'V' },
      { w: 'GRANT', r: 2, c: 4, d: 'H' },
      { w: 'STERN', r: 4, c: 1, d: 'V' },
      { w: 'ANGER', r: 4, c: 4, d: 'V' },
      { w: 'GRATE', r: 7, c: 0, d: 'H' }
    ],
    bonus: ['AGE', 'ANT', 'ARE', 'ART', 'ATE', 'EAR', 'EARN', 'EAST', 'EAT', 'ERA', 'GAS', 'GATE', 'GEAR', 'GET', 'NEAR', 'NEAT', 'NEST', 'NET', 'RAG', 'RAGE', 'RAN', 'RANG', 'RAT', 'RATE', 'RENT', 'REST', 'SANG', 'SAT', 'SEA', 'SEAT', 'SENT', 'SET', 'STAGE', 'STAR', 'STARE', 'TAG', 'TAN', 'TAR', 'TEA', 'TEAR', 'TEN']
  }
];
