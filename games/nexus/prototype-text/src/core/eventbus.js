// NEXUS · prototype-text · ядро «Койне»
// EventBus 2.0 — шина событий записей-субстрата.
//
// Контракт: export const bus { on, off, once, emit }.
// Ключевой фикс из ревью: emit() итерирует по КОПИИ списка слушателей,
// чтобы подписка/отписка во время доставки события не ломала обход
// и не «пропускала»/«дублировала» обработчики (мутация во время итерации).

/**
 * Реестр слушателей: имя события -> Set обработчиков.
 * Set даёт уникальность (повторный on с тем же fn не плодит дубли)
 * и дешёвое удаление в off().
 * @type {Map<string, Set<Function>>}
 */
const listeners = new Map();

/**
 * Подписаться на событие.
 * @param {string} evt — имя события (например, 'record:written').
 * @param {Function} fn — обработчик, вызывается как fn(data).
 * @returns {() => void} функция-отписка для удобного снятия подписки.
 */
function on(evt, fn) {
  if (typeof evt !== 'string' || typeof fn !== 'function') return () => {};
  let set = listeners.get(evt);
  if (!set) {
    set = new Set();
    listeners.set(evt, set);
  }
  set.add(fn);
  // Возвращаем «диспозер» — современный паттерн, не ломает контракт off().
  return () => off(evt, fn);
}

/**
 * Отписаться от события.
 * @param {string} evt — имя события.
 * @param {Function} fn — ранее подписанный обработчик.
 */
function off(evt, fn) {
  const set = listeners.get(evt);
  if (!set) return;
  set.delete(fn);
  if (set.size === 0) listeners.delete(evt); // не держим пустые наборы
}

/**
 * Подписаться ровно на одно срабатывание.
 * Обёртка снимает саму себя ПЕРЕД вызовом оригинала — поэтому даже если
 * обработчик повторно эмитит то же событие, рекурсии-самовозбуждения не будет.
 * @param {string} evt — имя события.
 * @param {Function} fn — обработчик, вызывается единожды как fn(data).
 * @returns {() => void} функция-отписка (на случай отмены до срабатывания).
 */
function once(evt, fn) {
  if (typeof evt !== 'string' || typeof fn !== 'function') return () => {};
  const wrapper = (data) => {
    off(evt, wrapper);
    fn(data);
  };
  return on(evt, wrapper);
}

/**
 * Опубликовать событие всем слушателям.
 * Итерируем по КОПИИ ([...set]) — безопасно к on()/off()/once() из обработчиков.
 * Ошибка одного слушателя не должна срывать доставку остальным.
 * @param {string} evt — имя события.
 * @param {*} [data] — полезная нагрузка, передаётся обработчику.
 */
function emit(evt, data) {
  const set = listeners.get(evt);
  if (!set || set.size === 0) return;
  // Снимок текущих слушателей — фикс из ревью.
  for (const fn of [...set]) {
    try {
      fn(data);
    } catch (err) {
      // Изоляция сбоев: логируем, но продолжаем рассылку.
      console.error(`[bus] обработчик события "${evt}" упал:`, err);
    }
  }
}

/**
 * Единая шина событий прототипа. Импортируется ядром (substrate)
 * и UI (textui) для слабосвязанной реактивности.
 */
export const bus = { on, off, once, emit };
