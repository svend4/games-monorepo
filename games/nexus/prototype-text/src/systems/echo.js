// systems/echo.js — Столп ЭХО: следы игроков, осевшие в субстрате «Койне».
//
// Эхо — это короткая записка-послание, которую странник оставляет в комнате.
// Другой странник (или ты сам в новой сессии) находит её позже. Внутри —
// всё та же запись субстрата (type 'echo'), так что эхо и знание говорят на
// одном языке «Койне» и хранятся единым журналом.
//
// АРХИТЕКТУРА «современное-первым»:
//   • По умолчанию работает локальный адаптер поверх ядра (substrate) —
//     ничего не требует, кроме браузера, ES-модули по http.
//   • Опционально можно подключить PhpEchoAdapter (общий сервер на XAMPP+MySQL).
//     Он НЕ подключается по умолчанию и НЕ блокирует ядро: PHP здесь — лишь
//     адаптер за интерфейсом, а не часть ядра.
//
// Привязка: NX-VIS-004, столп ЭХО; NX-INN-003 (субстрат), NX-INN-014 (адаптеры).

import { substrate } from '../core/substrate.js';
import { state, player } from '../world/zone.js';

// --- Контракт адаптера -------------------------------------------------------
// Любой адаптер эха реализует две операции:
//   write({ author, room, text }) -> rec        // сохранить эхо, вернуть запись
//   list(room) -> rec[]                          // эхо в комнате (room?: string)
// Записи всегда в форме субстрата: { id, type:'echo', author, t, place, payload:{text} }.

/**
 * Локальный адаптер — поверх ядра-субстрата.
 * Это дефолт: самодостаточен, синхронен, без сети.
 */
const localAdapter = {
  write({ author, room, text }) {
    // substrate.write сам проставит id и t (метку времени) и эмитнет событие.
    return substrate.write({
      type: 'echo',
      author,
      place: room,
      payload: { text },
    });
  },

  list(room) {
    // place === undefined в query означает «по всем местам».
    return substrate.query({ type: 'echo', place: room });
  },
};

// Активный адаптер. По умолчанию — локальный.
let adapter = localAdapter;

/**
 * Нормализация текста эха: режем пробелы по краям и держим разумный лимит,
 * чтобы записка не превратилась в простыню (тот же лимит, что у PHP-адаптера).
 */
const MAX_LEN = 300;
function normalizeText(text) {
  return String(text ?? '').trim().slice(0, MAX_LEN);
}

export const echo = {
  /**
   * Оставить эхо в ТЕКУЩЕЙ комнате от имени игрока.
   * Возвращает сохранённую запись субстрата (или throw для пустого текста —
   * вызывающий слой ui сам решает, что показать).
   * @param {string} text — текст послания.
   * @returns {object} запись { id, type:'echo', author, t, place, payload }.
   */
  leave(text) {
    const clean = normalizeText(text);
    if (!clean) {
      throw new Error('Пустое эхо оставить нельзя.');
    }
    return adapter.write({
      author: player.id,
      room: state.room,
      text: clean,
    });
  },

  /**
   * Найти эхо в комнате. Без аргумента — в текущей комнате.
   * Передай null/'' явным образом, если когда-нибудь понадобятся все комнаты.
   * @param {string} [room] — id комнаты; по умолчанию текущая (state.room).
   * @returns {object[]} массив записей-эхо.
   */
  find(room) {
    const where = room === undefined ? state.room : room || undefined;
    const recs = adapter.list(where);
    return Array.isArray(recs) ? recs : [];
  },

  /**
   * Подменить адаптер (например, на PhpEchoAdapter для общего сервера).
   * Принимает объект с методами write/list. null/undefined — вернуть локальный.
   * Так включение PHP-синка остаётся явным шагом, а не дефолтом.
   * @param {object|null} a — адаптер или null для возврата к локальному.
   */
  setAdapter(a) {
    adapter = a && typeof a.write === 'function' && typeof a.list === 'function'
      ? a
      : localAdapter;
    return adapter;
  },
};

/**
 * Опциональный PHP-адаптер — НЕ подключён по умолчанию.
 * Включается вручную: `echo.setAdapter(new PhpEchoAdapter())` где-нибудь
 * вне ядра. Требует запущенного XAMPP+MySQL и server/echo.php.
 *
 * Сетевые методы асинхронны, поэтому возвращают Promise — это сознательно
 * иной контракт, чем у локального адаптера: общий сервер по природе async.
 * Подключающий слой должен это учитывать (await при leave/find).
 */
export class PhpEchoAdapter {
  /** @param {string} [endpoint] — URL php-адаптера относительно прототипа. */
  constructor(endpoint = './server/echo.php') {
    this.endpoint = endpoint;
  }

  /** POST action=add — сохранить эхо на сервере, вернуть запись субстрата. */
  async write({ author, room, text }) {
    const res = await fetch(`${this.endpoint}?action=add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author, room, text }),
    });
    const data = await res.json();
    if (!res.ok || data?.error) {
      throw new Error('PHP-адаптер: не удалось сохранить эхо.');
    }
    return this.#toRecord(data);
  }

  /** GET action=list&room= — получить эхо комнаты как записи субстрата. */
  async list(room) {
    const url = new URL(this.endpoint, location.href);
    url.searchParams.set('action', 'list');
    if (room) url.searchParams.set('room', room);
    const res = await fetch(url.toString());
    const data = await res.json();
    if (!res.ok || data?.error || !Array.isArray(data)) return [];
    return data.map((row) => this.#toRecord(row));
  }

  /** Привести строку из БД к единой форме записи субстрата. */
  #toRecord(row) {
    return {
      id: row.id != null ? `php:${row.id}` : `php:${Date.now()}`,
      type: 'echo',
      author: row.author ?? 'неизвестный',
      t: row.created_at ?? new Date().toISOString(),
      place: row.room ?? '',
      payload: { text: row.text ?? '' },
    };
  }
}
