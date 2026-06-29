// knowledge.js — Столп ЗНАНИЕ: прогрессия через факты и дешифровку рун.
// Современное ядро (ES-модуль). Игрок «узнаёт» факты (learn); знание факта
// открывает руну — закодированную надпись, которая читается (decode) только
// тогда, когда нужный факт известен. Так знание = ключ доступа к миру.
// Состояние известных фактов персистится в localStorage (с фолбэком в память).
// Привязка: NX-INN-004 (знание как прогрессия), NX-VIS-004, NX-SPEC-005..010.

import { substrate } from '../core/substrate.js';
import { zones } from '../world/zone.js';

// Версионированный ключ персиста знаний (отдельно от субстрата).
const STORAGE_KEY = 'nexus.knowledge.v1';

// Множество известных игроку фактов. Источник истины в рантайме.
let facts = new Set();

/** Доступна ли постоянная память браузера (приватный режим / file:// могут бросать). */
function hasStorage() {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/** Загрузка множества фактов из localStorage. Любая ошибка → пустое множество. */
function load() {
  if (!hasStorage()) return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return new Set();
    return new Set(data.filter((x) => typeof x === 'string'));
  } catch {
    // Битый JSON / нет доступа — стартуем с чистого листа в памяти.
    return new Set();
  }
}

/** Сохранение множества фактов. Ошибки (quota / нет доступа) проглатываем. */
function save() {
  if (!hasStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...facts]));
  } catch {
    // Фолбэк: продолжаем работать только в памяти, без падения.
  }
}

// Инициализация при загрузке модуля.
facts = load();

/**
 * Найти определение руны по её id, обойдя комнаты зоны.
 * Руна — объект {id, requires, text} ИЛИ строковый id (тогда определение
 * ищется в реестре zones.runes, если он есть). Возвращаем нормализованный
 * объект {id, requires, text} либо null, если руна не найдена.
 */
function findRune(runeId) {
  // 1) Явный реестр рун на зоне (если автор zone.js его предоставил).
  const registry = zones?.runes;
  if (registry) {
    const fromRegistry = Array.isArray(registry)
      ? registry.find((r) => r && r.id === runeId)
      : registry[runeId];
    if (fromRegistry) return normalizeRune(runeId, fromRegistry);
  }

  // 2) Обход комнат: руна может лежать как объект в room.runes
  //    или как id-строка (тогда текст/требование ждём из реестра выше).
  const rooms = Array.isArray(zones) ? zones : Object.values(zones ?? {});
  for (const room of rooms) {
    const runeList = room?.runes;
    if (!Array.isArray(runeList)) continue;
    for (const rune of runeList) {
      if (rune && typeof rune === 'object' && rune.id === runeId) {
        return normalizeRune(runeId, rune);
      }
    }
  }
  return null;
}

/** Привести запись руны к виду {id, requires, text}. */
function normalizeRune(runeId, rune) {
  return {
    id: rune.id ?? runeId,
    // Какой факт требуется, чтобы прочесть руну (имя поля терпимо к вариантам).
    requires: rune.requires ?? rune.fact ?? rune.key ?? null,
    // Расшифрованный текст руны.
    text: rune.text ?? rune.decoded ?? rune.desc ?? '',
  };
}

export const knowledge = {
  /**
   * Узнать факт. Идемпотентно: повторный learn не создаёт дубликат.
   * Первое узнавание факта пишет след в субстрат (type 'knowledge'),
   * чтобы прогрессия была частью общего журнала «Койне».
   * @param {string} factId
   * @returns {boolean} true, если факт стал известен впервые сейчас.
   */
  learn(factId) {
    if (typeof factId !== 'string' || factId.length === 0) return false;
    if (facts.has(factId)) return false;
    facts.add(factId);
    save();
    // Неблокирующий след в субстрате: прогрессия видна как запись.
    substrate.write({ type: 'knowledge', author: 'you', payload: { fact: factId } });
    return true;
  },

  /**
   * Известен ли игроку факт.
   * @param {string} factId
   * @returns {boolean}
   */
  knows(factId) {
    return facts.has(factId);
  },

  /**
   * Дешифровать руну. Руна читается только при известном требуемом факте.
   * @param {string} runeId
   * @returns {{ok:boolean, text:string}} ok=true и расшифрованный текст,
   *   либо ok=false и подсказка-причина (руна не найдена / не хватает знания).
   */
  decode(runeId) {
    const rune = findRune(runeId);
    if (!rune) {
      return { ok: false, text: 'Такой руны здесь нет.' };
    }
    // Руна без требования читается всегда (открытая надпись).
    if (rune.requires && !facts.has(rune.requires)) {
      return {
        ok: false,
        text: 'Знаки складываются в узор, но смысл ускользает — вам не хватает знания.',
      };
    }
    return { ok: true, text: rune.text || 'Руна расшифрована, но безмолвна.' };
  },

  /**
   * Все известные факты.
   * @returns {string[]} копия списка фактов (порядок узнавания).
   */
  known() {
    return [...facts];
  },
};
