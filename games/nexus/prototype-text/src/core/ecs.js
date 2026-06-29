// core/ecs.js — Минимальный ECS (Entity-Component-System) для прототипа «Койне».
//
// Ядро NEXUS строится на субстрате записей; ECS даёт лёгкий слой сущностей и
// компонентов для игровой логики (игрок, руны, предметы, эхо-маркеры комнат).
//
// Принцип: сущность — это просто числовой id; компоненты хранятся в Map по имени;
// для быстрых выборок ведутся обратные индексы component-name -> Set(entityId).
// query([names]) пересекает индексы и возвращает id всех сущностей, у которых
// присутствуют ВСЕ перечисленные компоненты.
//
// API (по контракту, имена и сигнатуры точные):
//   world.createEntity()            -> id
//   world.removeEntity(id)          -> void
//   world.addComponent(id,name,comp)-> world   (цепочечный вызов)
//   world.getComponent(id,name)     -> comp | undefined
//   world.hasComponent(id,name)     -> boolean
//   world.query([names])            -> [ids]

// Счётчик id сущностей. Простая монотонная последовательность — id не
// переиспользуются, что упрощает рассуждение о ссылках на сущности.
let nextId = 1;

// id сущности -> Map(componentName -> componentData)
const entities = new Map();

// componentName -> Set(entityId). Обратный индекс для быстрых запросов.
const indices = new Map();

/** Вернуть (создав при необходимости) индекс для имени компонента. */
function indexFor(name) {
  let set = indices.get(name);
  if (!set) {
    set = new Set();
    indices.set(name, set);
  }
  return set;
}

export const world = {
  /**
   * Создать новую сущность.
   * @returns {number} уникальный id сущности
   */
  createEntity() {
    const id = nextId++;
    entities.set(id, new Map());
    return id;
  },

  /**
   * Удалить сущность и все её компоненты, очистив обратные индексы.
   * Безопасно вызывать для несуществующего id (просто no-op).
   * @param {number} id
   */
  removeEntity(id) {
    const comps = entities.get(id);
    if (!comps) return;
    // Снять id из всех индексов компонентов этой сущности.
    for (const name of comps.keys()) {
      const set = indices.get(name);
      if (set) set.delete(id);
    }
    entities.delete(id);
  },

  /**
   * Добавить (или заменить) компонент на сущности.
   * Возвращает world для цепочечных вызовов:
   *   world.addComponent(id,'pos',{x,y}).addComponent(id,'tag',{});
   * @param {number} id    id существующей сущности
   * @param {string} name  имя компонента
   * @param {*} comp        данные компонента (любой объект/значение)
   * @returns {typeof world}
   */
  addComponent(id, name, comp) {
    const comps = entities.get(id);
    if (!comps) return this; // несуществующая сущность — тихий no-op
    comps.set(name, comp);
    indexFor(name).add(id);
    return this;
  },

  /**
   * Получить данные компонента сущности.
   * @param {number} id
   * @param {string} name
   * @returns {*} данные компонента или undefined
   */
  getComponent(id, name) {
    const comps = entities.get(id);
    return comps ? comps.get(name) : undefined;
  },

  /**
   * Проверить наличие компонента у сущности.
   * @param {number} id
   * @param {string} name
   * @returns {boolean}
   */
  hasComponent(id, name) {
    const comps = entities.get(id);
    return comps ? comps.has(name) : false;
  },

  /**
   * Найти все сущности, обладающие ВСЕМИ перечисленными компонентами.
   * Пересечение начинается с самого маленького индекса ради эффективности.
   * @param {string[]} names список имён компонентов
   * @returns {number[]} массив id сущностей
   */
  query(names) {
    if (!Array.isArray(names) || names.length === 0) return [];

    // Собрать наборы индексов; если хоть одного нет — пересечение пусто.
    const sets = [];
    for (const name of names) {
      const set = indices.get(name);
      if (!set || set.size === 0) return [];
      sets.push(set);
    }

    // Стартуем с наименьшего набора — меньше итераций при проверке.
    sets.sort((a, b) => a.size - b.size);
    const [smallest, ...rest] = sets;

    const result = [];
    for (const id of smallest) {
      if (rest.every((set) => set.has(id))) result.push(id);
    }
    return result;
  },
};
