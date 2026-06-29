// substrate.js — Субстрат «Койне»: журнал записей (ядро NEXUS).
// Современное ядро (ES-модуль). Хранит неизменяемый журнал записей-«рун»,
// персистит в localStorage и оповещает мир через шину событий.
// Любая запись (echo, knowledge, system, ...) ложится одним и тем же типом
// записи — это и есть субстрат «Койне», общий язык всех систем.
// Привязка: NX-INN-003 (субстрат записей), NX-VIS-004.

import { bus } from './eventbus.js';

// Ключ персиста. Версионируем, чтобы не ломаться при смене схемы.
const STORAGE_KEY = 'nexus.substrate.v1';

// Внутренний журнал записей. Источник истины в рантайме.
let log = [];

// Монотонный счётчик для генерации id даже при одинаковом timestamp.
let seq = 0;

/**
 * Доступна ли постоянная память браузера.
 * При file:// или приватных режимах localStorage может бросать —
 * тогда мягко уходим в режим «только память».
 */
function hasStorage() {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/** Загрузка журнала из localStorage. Любая ошибка → пустой журнал в памяти. */
function load() {
  if (!hasStorage()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    // Восстанавливаем счётчик, чтобы новые id не сталкивались со старыми.
    for (const rec of data) {
      const n = Number.parseInt(String(rec?.id ?? '').replace(/^r/, ''), 10);
      if (Number.isFinite(n) && n >= seq) seq = n + 1;
    }
    return data;
  } catch {
    // Битый JSON / нет доступа — стартуем с чистого листа в памяти.
    return [];
  }
}

/** Сохранение журнала. Ошибки (quota / отсутствие доступа) проглатываем. */
function save() {
  if (!hasStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch {
    // Фолбэк: продолжаем работать только в памяти, без падения.
  }
}

/** Уникальный id записи вида r1, r2, ... */
function nextId() {
  return 'r' + seq++;
}

// Инициализация при загрузке модуля.
log = load();

export const substrate = {
  /**
   * Записать запись в субстрат.
   * @param {{id?:string,type:string,author?:string,t?:number,place?:string,payload?:any,tags?:string[]}} rec
   * @returns {string} id созданной записи
   * Проставляет id и t (timestamp) автоматически. После записи эмитит
   * 'record:written' с полной записью.
   */
  write(rec) {
    const record = {
      ...rec,
      id: rec?.id ?? nextId(),
      t: rec?.t ?? Date.now(),
    };
    log.push(record);
    save();
    bus.emit('record:written', record);
    return record.id;
  },

  /**
   * Выборка записей по фильтру.
   * @param {{type?:string,place?:string,author?:string,since?:number}} [filter]
   * @returns {Array} записи, прошедшие все заданные условия (в порядке записи).
   */
  query(filter = {}) {
    const { type, place, author, since } = filter;
    return log.filter((rec) => {
      if (type !== undefined && rec.type !== type) return false;
      if (place !== undefined && rec.place !== place) return false;
      if (author !== undefined && rec.author !== author) return false;
      if (since !== undefined && !(rec.t >= since)) return false;
      return true;
    });
  },

  /** Все записи журнала (копия, чтобы наружу не утекала внутренняя ссылка). */
  all() {
    return log.slice();
  },

  /** Полностью очистить субстрат (журнал + персист). */
  clear() {
    log = [];
    seq = 0;
    if (hasStorage()) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Нет доступа к памяти — достаточно очистки в рантайме.
      }
    }
  },
};
