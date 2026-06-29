# NEXUS — Профессиональная архитектура браузерного MMORPG

> Версия 1.0 · Прицел: масштаб 100+ зон, 500+ врагов, 1000+ предметов, мультиплеер

---

## СОДЕРЖАНИЕ

1. [Философия и принципы](#1-философия)
2. [Полная структура папок](#2-структура)
3. [Слои архитектуры](#3-слои)
4. [Паттерны с кодом](#4-паттерны)
   - EventBus
   - ServiceLocator
   - ECS (Entity-Component-System)
   - ObjectPool
   - StateMachine
   - GameLoop с фиксированным шагом
5. [JSON-схемы данных](#5-json-схемы)
6. [Каталог событий EventBus](#6-каталог-событий)
7. [Порядок загрузки скриптов](#7-порядок-загрузки)
8. [База данных (расширенная схема)](#8-база-данных)
9. [Стратегии производительности](#9-производительность)
10. [План миграции](#10-план-миграции)

---

## 1. ФИЛОСОФИЯ

### Пять принципов

| # | Принцип | Что это значит |
|---|---------|----------------|
| 1 | **Single Responsibility** | Один файл = одна обязанность. `CombatSystem.js` считает урон. `Renderer3D.js` рисует. Никогда оба вместе. |
| 2 | **Data-Driven** | Новый враг = новый `goblin.json`, код не трогаем. Новый квест = `quest_new.json`. Дизайнер работает с JSON, программист с JS. |
| 3 | **ECS** | Сущности = просто ID. Данные = компоненты. Логика = системы. Враг и игрок — одна и та же Entity, разные компоненты. |
| 4 | **EventBus** | Системы не знают друг о друге. Враг умер → `emit('entity:died')`. Кто хочет — тот слушает. |
| 5 | **Object Pooling** | Частицы, пули, числа урона — не создаём и не удаляем. Берём из пула, возвращаем в пул. |

### Правило 400 строк
Файл достиг 400 строк → он делает слишком много → разделить.

### Правило нулевых глобальных переменных
Вместо `var scene` — `ServiceLocator.get('scene')`.  
Вместо `var PS` — компонент `HealthComponent` на Entity игрока.

---

## 2. СТРУКТУРА ПАПОК

```
htdocs/01/
│
├── index.html                         ← Лобби: выбор варианта 01/02/03
│
│ ═══════════════════════════════════════════════════════
│  СЛОЙ 0: ЯДРО (не знает про игру, переиспользуется везде)
│ ═══════════════════════════════════════════════════════
│
├── core/
│   ├── EventBus.js                    ← pub/sub с типизированными событиями
│   ├── ServiceLocator.js              ← реестр сервисов (замена глобальным переменным)
│   ├── StateMachine.js                ← конечный автомат (menu/loading/playing/paused/dead)
│   ├── ObjectPool.js                  ← пул объектов для частиц, пуль, текста
│   ├── Logger.js                      ← уровни DEBUG/INFO/WARN/ERROR, фильтрация
│   └── Config.js                      ← константы: TICK_RATE, MAX_ENTITIES, VERSION
│
│ ═══════════════════════════════════════════════════════
│  СЛОЙ 1: ДВИЖОК (игровые сервисы, не зависят от контента)
│ ═══════════════════════════════════════════════════════
│
├── engine/
│   ├── GameLoop.js                    ← RAF + фиксированный timestep + dt
│   ├── InputManager.js                ← keyboard, mouse, gamepad, touch — единый API
│   ├── AudioSystem.js                 ← Web Audio API, spatial 3D звук, микшер
│   ├── AssetLoader.js                 ← JSON/texture/audio с кешем и прогрессом
│   └── SaveSystem.js                  ← localStorage + IndexedDB, автосохранение
│
│ ═══════════════════════════════════════════════════════
│  СЛОЙ 2: ECS RUNTIME
│ ═══════════════════════════════════════════════════════
│
├── ecs/
│   ├── World.js                       ← реестр сущностей, create/destroy/query
│   ├── Entity.js                      ← просто уникальный ID + набор компонентов
│   └── System.js                      ← базовый класс: update(dt), priority, active
│
│ ═══════════════════════════════════════════════════════
│  СЛОЙ 3: КОМПОНЕНТЫ (данные без логики)
│ ═══════════════════════════════════════════════════════
│
├── components/
│   ├── TransformComponent.js          ← position(x,y,z), rotation, scale
│   ├── HealthComponent.js             ← hp, maxHp, armor, regenRate
│   ├── CombatComponent.js             ← atk, atkSpeed, atkRange, critChance
│   ├── MovementComponent.js           ← speed, dashMult, velocity(vx,vz)
│   ├── AIComponent.js                 ← state, aggroRange, target, cooldown
│   ├── LootComponent.js               ← dropTable[], goldMin, goldMax
│   ├── RenderComponent.js             ← meshRef, visible, lod level
│   ├── ColliderComponent.js           ← radius, type(circle/box), layer
│   ├── StatsComponent.js              ← level, xp, xpNext, kills
│   ├── InventoryComponent.js          ← slots[], gold, potions
│   ├── NetworkComponent.js            ← sessionId, lastSync, dirty flag
│   └── TagComponent.js                ← Set{'player','enemy','npc','loot','boss'}
│
│ ═══════════════════════════════════════════════════════
│  СЛОЙ 4: СИСТЕМЫ (логика без данных и без рендера)
│ ═══════════════════════════════════════════════════════
│
├── systems/
│   ├── MovementSystem.js              ← применяет velocity, boundary check
│   ├── CollisionSystem.js             ← broad phase (grid) + narrow phase
│   ├── CombatSystem.js                ← атака, урон, критикал, смерть
│   ├── AISystem.js                    ← FSM врагов: idle→chase→attack→flee
│   ├── SpawnSystem.js                 ← читает spawns.json, контролирует популяцию
│   ├── LootSystem.js                  ← дроп по таблице, подбор, авто-лут
│   ├── ExperienceSystem.js            ← XP, левел-ап, разблокировки
│   ├── QuestSystem.js                 ← прогресс, цепочки, триггеры
│   ├── WorldEventSystem.js            ← глобальные события по таймеру
│   ├── EffectSystem.js                ← баффы/дебаффы с duration
│   ├── NetworkSystem.js               ← WebSocket, sync, prediction
│   └── PersistenceSystem.js           ← автосохранение состояния игрока
│
│ ═══════════════════════════════════════════════════════
│  СЛОЙ 5: РЕНДЕР (только рисование, нет логики)
│ ═══════════════════════════════════════════════════════
│
├── renderer/
│   ├── 3d/
│   │   ├── Scene3D.js                 ← Three.js: scene, camera, renderer, lights
│   │   ├── MeshFactory.js             ← создаёт Three.js меши из ECS компонентов
│   │   ├── ParticlePool.js            ← пул частиц (не push/splice, а ring buffer)
│   │   ├── DayNightRenderer.js        ← небо, туман, солнце по dayTime
│   │   ├── ShadowManager.js           ← динамическое управление тенями
│   │   ├── LODManager.js              ← Level of Detail: далеко = меньше полигонов
│   │   ├── FrustumCuller.js           ← не рендерим объекты вне камеры
│   │   ├── PostFXPipeline.js          ← bloom, color grading, vignette
│   │   ├── OverlayRenderer.js         ← canvas поверх WebGL: урон, иконки
│   │   └── MinimapRenderer.js         ← canvas миникарта
│   └── 2d/
│       ├── Renderer2D.js              ← canvas 2D для вариантов 01/02
│       └── MinimapRenderer2D.js
│
│ ═══════════════════════════════════════════════════════
│  СЛОЙ 6: МИР / ЗОНЫ
│ ═══════════════════════════════════════════════════════
│
├── world/
│   ├── ZoneManager.js                 ← загрузка/выгрузка зон, переходы
│   ├── ChunkLoader.js                 ← стриминг: 16×16 чанки для открытого мира
│   ├── WorldBuilder.js                ← JSON geometry → Three.js объекты
│   ├── SpawnPointManager.js           ← точки спавна, кулдауны, максимумы
│   ├── NPCManager.js                  ← жизненный цикл NPC, диалоги, маршруты
│   └── PortalSystem.js                ← телепорты между зонами
│
│ ═══════════════════════════════════════════════════════
│  СЛОЙ 7: UI (только DOM, нет логики)
│ ═══════════════════════════════════════════════════════
│
├── ui/
│   ├── UIManager.js                   ← стек панелей: push/pop, блокировка ввода
│   ├── panels/
│   │   ├── HUDPanel.js                ← HP, XP, рывок, зелья
│   │   ├── ShopPanel.js               ← магазин с пагинацией
│   │   ├── JournalPanel.js            ← квесты с фильтрами
│   │   ├── InventoryPanel.js          ← сетка предметов, drag&drop
│   │   ├── CharacterPanel.js          ← статы, экипировка
│   │   ├── MapPanel.js                ← полная карта зоны
│   │   ├── SettingsPanel.js           ← звук, графика, управление
│   │   └── DeathPanel.js              ← смерть, возрождение
│   └── widgets/
│       ├── ProgressBar.js             ← переиспользуемая полоска
│       ├── Tooltip.js                 ← подсказки при наведении
│       ├── FloatingText.js            ← числа урона из пула объектов
│       ├── QuestMarker.js             ← маркер на миникарте
│       └── NotificationQueue.js       ← очередь системных уведомлений
│
│ ═══════════════════════════════════════════════════════
│  СЛОЙ 8: ДАННЫЕ (только JSON, нет кода)
│ ═══════════════════════════════════════════════════════
│
├── data/
│   ├── config/
│   │   ├── game.json                  ← VERSION, TICK_RATE, MAX_PLAYERS
│   │   ├── balance.json               ← XP_CURVE, DAMAGE_FORMULA, LOOT_RATES
│   │   └── controls.json             ← раскладка клавиш по умолчанию
│   │
│   ├── worlds/
│   │   ├── arena/
│   │   │   ├── meta.json              ← id, name, music, weather, fog, size
│   │   │   ├── geometry.json          ← walls[], trees[], water[], decorations[]
│   │   │   ├── spawns.json            ← spawnPoints[]: {enemy, pos, max, cooldown}
│   │   │   ├── events.json            ← worldEvents[] для этой зоны
│   │   │   └── portals.json           ← переходы в другие зоны
│   │   ├── dungeon_01/
│   │   ├── dungeon_02/
│   │   ├── forest/
│   │   └── boss_lair/
│   │
│   ├── enemies/
│   │   ├── _schema.json               ← JSON Schema для валидации
│   │   ├── goblin.json
│   │   ├── orc.json
│   │   ├── troll.json
│   │   ├── skeleton.json
│   │   ├── ghost.json
│   │   └── boss_dragon.json           ← новый враг = новый файл
│   │
│   ├── items/
│   │   ├── _schema.json
│   │   ├── weapons/
│   │   │   ├── sword_iron.json
│   │   │   ├── sword_steel.json
│   │   │   └── staff_arcane.json
│   │   ├── armor/
│   │   │   ├── armor_leather.json
│   │   │   └── armor_plate.json
│   │   └── consumables/
│   │       ├── potion_hp.json
│   │       ├── potion_mp.json
│   │       └── scroll_tp.json
│   │
│   ├── quests/
│   │   ├── _schema.json
│   │   ├── main/
│   │   │   ├── ch01_first_blood.json
│   │   │   ├── ch02_the_merchant.json
│   │   │   └── ch03_dragon.json
│   │   └── side/
│   │       ├── daily_bounty.json
│   │       └── arena_champion.json
│   │
│   ├── npcs/
│   │   ├── aron_merchant.json         ← {id, name, pos, shop:[], dialogue:[]}
│   │   └── elder_quest.json
│   │
│   └── effects/
│       ├── rage.json                  ← worldEvent: buff/debuff параметры
│       ├── blessing.json
│       └── fog.json
│
│ ═══════════════════════════════════════════════════════
│  СЛОЙ 9: АССЕТЫ
│ ═══════════════════════════════════════════════════════
│
├── assets/
│   ├── textures/
│   │   ├── terrain/
│   │   ├── enemies/
│   │   └── ui/
│   ├── audio/
│   │   ├── music/
│   │   │   ├── arena_day.mp3
│   │   │   └── dungeon_dark.mp3
│   │   └── sfx/
│   │       ├── hit.wav
│   │       ├── kill.wav
│   │       └── levelup.wav
│   └── fonts/
│
│ ═══════════════════════════════════════════════════════
│  СЛОЙ 10: PHP BACKEND
│ ═══════════════════════════════════════════════════════
│
├── api/
│   ├── core/
│   │   ├── Database.php               ← PDO singleton, prepared statements
│   │   ├── Auth.php                   ← session_id валидация, rate limiting
│   │   ├── Response.php               ← JSON response helper
│   │   └── Validator.php              ← входные данные
│   ├── endpoints/
│   │   ├── players.php                ← GET/POST /api/players
│   │   ├── items.php                  ← инвентарь, экипировка
│   │   ├── chat.php                   ← сообщения с пагинацией
│   │   ├── zones.php                  ← онлайн игроки в зоне
│   │   └── leaderboard.php            ← топ игроков
│   └── config/
│       └── database.php               ← DSN, credentials (не в git!)
│
├── 01/game.html                       ← точка входа v1 (2D вид сверху)
├── 02/game.html                       ← точка входа v2 (изометрия)
└── 03/game.html                       ← точка входа v3 (Three.js 3D) ← текущее
```

---

## 3. СЛОИ АРХИТЕКТУРЫ

```
┌──────────────────────────────────────────────────────┐
│                    game.html                         │  ← точка входа
│              (только <script> теги + init)           │
└───────────────────────┬──────────────────────────────┘
                        │
         ┌──────────────▼──────────────┐
         │          UI LAYER           │  ui/panels/, ui/widgets/
         │    (DOM, без логики)        │
         └──────────────┬──────────────┘
                        │ читает состояние из ECS
         ┌──────────────▼──────────────┐
         │       SYSTEMS LAYER         │  systems/Combat, AI, Quest...
         │   (логика, без рендера)     │
         └──────┬──────────────┬───────┘
                │              │
         ┌──────▼──────┐ ┌─────▼──────┐
         │  ECS LAYER  │ │ EVENT BUS  │  ← системы общаются ТОЛЬКО через EventBus
         │(компоненты) │ │            │
         └──────┬──────┘ └────────────┘
                │
         ┌──────▼──────────────────────┐
         │      RENDERER LAYER         │  renderer/3d/, renderer/2d/
         │   (рисование, без логики)   │
         └──────┬──────────────────────┘
                │
         ┌──────▼──────────────────────┐
         │      ENGINE LAYER           │  engine/GameLoop, Input, Audio
         │   (сервисы, без игры)       │
         └──────┬──────────────────────┘
                │
         ┌──────▼──────────────────────┐
         │       CORE LAYER            │  core/EventBus, Pool, Logger
         │  (фреймворк, нет игры)      │
         └─────────────────────────────┘
```

**Правило зависимостей:** стрелка всегда идёт ВНИЗ. Нижние слои никогда не импортируют верхние.

---

## 4. ПАТТЕРНЫ С КОДОМ

### 4.1 EventBus

```javascript
// core/EventBus.js
'use strict';
var EventBus = (function () {
  var _listeners = {};

  return {
    on: function (event, fn, ctx) {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push({ fn: fn, ctx: ctx || null });
      return this;
    },

    off: function (event, fn) {
      if (!_listeners[event]) return;
      _listeners[event] = _listeners[event].filter(function (l) { return l.fn !== fn; });
      return this;
    },

    emit: function (event, data) {
      var list = _listeners[event];
      if (!list) return;
      for (var i = 0; i < list.length; i++)
        list[i].fn.call(list[i].ctx, data);
      return this;
    },

    once: function (event, fn, ctx) {
      var self = this;
      function wrapper(data) { fn.call(ctx, data); self.off(event, wrapper); }
      return this.on(event, wrapper);
    },

    // отладка: все активные подписки
    debug: function () {
      return Object.keys(_listeners).map(function (k) {
        return k + ' (' + _listeners[k].length + ' listeners)';
      });
    }
  };
})();
```

**Использование:**

```javascript
// CombatSystem: публикует событие
EventBus.emit('entity:died', { entityId: en.id, xp: en.xp, gold: en.gold, pos: en.pos });

// QuestSystem: подписан, сам считает
EventBus.on('entity:died', function (data) {
  if (data.tags.has('enemy')) questProgress.kills++;
  self.checkAll();
});

// ExperienceSystem: тоже подписан
EventBus.on('entity:died', function (data) {
  playerStats.xp += data.xp;
  self.checkLevelUp();
});

// LootSystem: тоже подписан
EventBus.on('entity:died', function (data) {
  self.rollDropTable(data.entityId, data.pos);
});

// HUDPanel: обновляет только UI
EventBus.on('player:stats-changed', function () { HUDPanel.refresh(); });
EventBus.on('player:levelup',       function (d) { HUDPanel.showLevelUp(d.level); });
```

---

### 4.2 ServiceLocator

```javascript
// core/ServiceLocator.js
'use strict';
var ServiceLocator = (function () {
  var _services = {};

  return {
    register: function (name, service) {
      if (_services[name]) Logger.warn('ServiceLocator: overwriting ' + name);
      _services[name] = service;
    },

    get: function (name) {
      if (!_services[name]) throw new Error('Service not found: ' + name);
      return _services[name];
    },

    has: function (name) { return !!_services[name]; }
  };
})();
```

**Регистрация в game.html:**

```javascript
// Вместо глобальных переменных:
ServiceLocator.register('scene',    scene);
ServiceLocator.register('camera',   camera);
ServiceLocator.register('renderer', renderer);
ServiceLocator.register('clock',    clock);

// Использование в любом файле без глобальных переменных:
var scene = ServiceLocator.get('scene');
```

---

### 4.3 ECS (Entity-Component-System)

```javascript
// ecs/World.js
'use strict';
var World = (function () {
  var _nextId = 1;
  var _entities = {};   // id → {id, components:{}}
  var _systems  = [];   // отсортированные по priority

  return {
    createEntity: function () {
      var id = _nextId++;
      _entities[id] = { id: id, components: {} };
      return id;
    },

    destroyEntity: function (id) {
      EventBus.emit('entity:destroyed', { id: id });
      delete _entities[id];
    },

    addComponent: function (entityId, name, component) {
      if (!_entities[entityId]) return;
      _entities[entityId].components[name] = component;
      return this;
    },

    getComponent: function (entityId, name) {
      return _entities[entityId] && _entities[entityId].components[name];
    },

    hasComponent: function (entityId, name) {
      return !!(this.getComponent(entityId, name));
    },

    // Выбрать все сущности с нужным набором компонентов
    query: function (requiredComponents) {
      var result = [];
      var ids = Object.keys(_entities);
      for (var i = 0; i < ids.length; i++) {
        var e = _entities[ids[i]];
        var ok = true;
        for (var j = 0; j < requiredComponents.length; j++) {
          if (!e.components[requiredComponents[j]]) { ok = false; break; }
        }
        if (ok) result.push(e);
      }
      return result;
    },

    addSystem: function (system) {
      _systems.push(system);
      _systems.sort(function (a, b) { return (a.priority || 0) - (b.priority || 0); });
    },

    update: function (dt, t) {
      for (var i = 0; i < _systems.length; i++) {
        if (_systems[i].active !== false) _systems[i].update(dt, t);
      }
    }
  };
})();
```

**Создание игрока через ECS:**

```javascript
// Создание игрока
var playerId = World.createEntity();
World.addComponent(playerId, 'transform',  { x: 0, y: 0, z: 0, rotY: 0 });
World.addComponent(playerId, 'health',     { hp: 100, maxHp: 100, armor: 0 });
World.addComponent(playerId, 'combat',     { atk: 22, atkSpeed: 1.0, atkRange: 3.2, atkCd: 0 });
World.addComponent(playerId, 'movement',   { speed: 5.5, dashMult: 1.0, dashCd: 0, vx: 0, vz: 0 });
World.addComponent(playerId, 'stats',      { level: 1, xp: 0, xpNext: 100, kills: 0 });
World.addComponent(playerId, 'inventory',  { gold: 0, potions: 0, slots: [] });
World.addComponent(playerId, 'tag',        new Set(['player']));
World.addComponent(playerId, 'render',     { meshRef: pg, visible: true });

ServiceLocator.register('playerId', playerId);

// Создание врага из JSON
function spawnEnemy(def, pos) {
  var id = World.createEntity();
  World.addComponent(id, 'transform', { x: pos.x, y: def.yB, z: pos.z, rotY: 0 });
  World.addComponent(id, 'health',    { hp: def.hp, maxHp: def.hp, armor: 0 });
  World.addComponent(id, 'combat',    { atk: def.atk, atkRange: 1.7, atkCd: 0 });
  World.addComponent(id, 'movement',  { speed: def.speed });
  World.addComponent(id, 'ai',        { state: 'idle', aggroRange: 10, target: null, cd: Math.random()*2 });
  World.addComponent(id, 'loot',      { dropTable: def.dropTable, goldMin: def.goldMin, goldMax: def.goldMax });
  World.addComponent(id, 'stats',     { xp: def.xp });
  World.addComponent(id, 'tag',       new Set(['enemy', def.type]));
  return id;
}
```

---

### 4.4 ObjectPool

```javascript
// core/ObjectPool.js
'use strict';
function ObjectPool(factory, reset, initialSize) {
  this._pool    = [];
  this._active  = [];
  this._factory = factory;
  this._reset   = reset;

  for (var i = 0; i < (initialSize || 0); i++)
    this._pool.push(factory());
}

ObjectPool.prototype.get = function () {
  var obj = this._pool.length > 0 ? this._pool.pop() : this._factory();
  this._active.push(obj);
  return obj;
};

ObjectPool.prototype.release = function (obj) {
  var idx = this._active.indexOf(obj);
  if (idx !== -1) this._active.splice(idx, 1);
  this._reset(obj);
  this._pool.push(obj);
};

ObjectPool.prototype.releaseAll = function () {
  while (this._active.length > 0) this.release(this._active[0]);
};
```

**Пул для чисел урона (FloatingText):**

```javascript
var floatTextPool = new ObjectPool(
  // factory: создать DOM-элемент
  function () {
    var el = document.createElement('div');
    el.className = 'float-text';
    el.style.position = 'fixed';
    el.style.pointerEvents = 'none';
    document.body.appendChild(el);
    return { el: el, life: 0, vy: 0, sx: 0, sy: 0 };
  },
  // reset: скрыть и обнулить
  function (obj) {
    obj.el.style.display = 'none';
    obj.life = 0;
  },
  30  // pre-allocate 30
);

// Использование:
function showDamage(screenX, screenY, text, color) {
  var ft = floatTextPool.get();
  ft.el.textContent = text;
  ft.el.style.color = color;
  ft.el.style.display = 'block';
  ft.sx = screenX; ft.sy = screenY; ft.vy = -60; ft.life = 1.2;
}

// В animate():
floatTextPool._active.forEach(function (ft) {
  ft.life -= dt; ft.sy += ft.vy * dt;
  ft.el.style.left = ft.sx + 'px';
  ft.el.style.top  = ft.sy + 'px';
  ft.el.style.opacity = Math.min(1, ft.life);
  if (ft.life <= 0) floatTextPool.release(ft);
});
```

---

### 4.5 StateMachine

```javascript
// core/StateMachine.js — конечный автомат состояний игры
'use strict';
function StateMachine(states, initial) {
  this._states  = states;   // { stateName: { enter, exit, update } }
  this._current = null;
  this._history = [];
  this.transition(initial);
}

StateMachine.prototype.transition = function (name, data) {
  if (!this._states[name]) throw new Error('Unknown state: ' + name);
  if (this._current && this._states[this._current].exit)
    this._states[this._current].exit();
  this._history.push(this._current);
  this._current = name;
  EventBus.emit('state:changed', { from: this._history[this._history.length-1], to: name, data: data });
  if (this._states[name].enter) this._states[name].enter(data);
};

StateMachine.prototype.back = function () {
  var prev = this._history.pop();
  if (prev) this.transition(prev);
};

StateMachine.prototype.update = function (dt) {
  if (this._states[this._current] && this._states[this._current].update)
    this._states[this._current].update(dt);
};
```

**Состояния игры:**

```javascript
var GameState = new StateMachine({
  loading: {
    enter: function () { AssetLoader.loadAll().then(function () { GameState.transition('playing'); }); },
    update: function () { /* показываем прогресс загрузки */ }
  },
  playing: {
    enter: function () { InputManager.enable(); EventBus.emit('game:started'); },
    exit:  function () { InputManager.disable(); },
    update: function (dt) { World.update(dt); }
  },
  paused: {
    enter: function () { UIManager.push('settings'); },
    exit:  function () { UIManager.pop(); }
  },
  dead: {
    enter: function (data) { UIManager.push('death', data); },
    exit:  function () { UIManager.pop(); }
  }
}, 'loading');
```

---

### 4.6 GameLoop с фиксированным timestep

```javascript
// engine/GameLoop.js
'use strict';
var GameLoop = (function () {
  var FIXED_DT  = 1 / 60;   // physics: 60 hz
  var MAX_DT    = 0.05;      // cap: не больше 50ms за кадр
  var _acc      = 0;
  var _last     = null;
  var _raf      = null;
  var _running  = false;

  function tick(now) {
    if (!_running) return;
    _raf = requestAnimationFrame(tick);

    var dt = Math.min((now - (_last || now)) / 1000, MAX_DT);
    _last = now;
    _acc += dt;

    // Фиксированный шаг для физики и AI
    while (_acc >= FIXED_DT) {
      EventBus.emit('loop:fixed', { dt: FIXED_DT });
      _acc -= FIXED_DT;
    }

    // Переменный шаг для рендера (alpha = степень интерполяции)
    var alpha = _acc / FIXED_DT;
    EventBus.emit('loop:render', { dt: dt, alpha: alpha, elapsed: now / 1000 });
  }

  return {
    start:  function () { _running = true; _raf = requestAnimationFrame(tick); },
    stop:   function () { _running = false; cancelAnimationFrame(_raf); },
    pause:  function () { _running = false; },
    resume: function () { _running = true; _last = null; _raf = requestAnimationFrame(tick); }
  };
})();

// Подписки систем:
EventBus.on('loop:fixed',  function (e) { AISystem.update(e.dt); CollisionSystem.update(e.dt); });
EventBus.on('loop:render', function (e) { Renderer3D.render(e.dt, e.alpha); MinimapRenderer.draw(); });
```

---

## 5. JSON-СХЕМЫ ДАННЫХ

### Враг (enemies/goblin.json)

```json
{
  "$schema": "../_schema.json",
  "id": "goblin",
  "name": "Гоблин",
  "type": "humanoid",
  "tier": 1,
  "stats": {
    "hp": 60,
    "armor": 0,
    "atk": 8,
    "atkRange": 1.7,
    "atkSpeed": 1.0,
    "speed": 2.6,
    "aggroRange": 10,
    "xp": 30
  },
  "visual": {
    "color": "#27ae60",
    "width": 0.4,
    "height": 0.82,
    "depth": 0.4,
    "yBase": 0.41,
    "scale": 1.0
  },
  "dropTable": [
    { "item": "gold",       "chance": 0.88, "min": 6,  "max": 12 },
    { "item": "potion_hp",  "chance": 0.35, "min": 1,  "max": 1  },
    { "item": "sword_iron", "chance": 0.02, "min": 1,  "max": 1  }
  ],
  "ai": {
    "type": "melee_chaser",
    "fleeAtHpPercent": 0
  },
  "spawnZones": ["arena", "forest"],
  "respawnTime": 30,
  "boss": false
}
```

### Зона (worlds/arena/meta.json)

```json
{
  "id": "arena",
  "name": "Арена Нексус",
  "version": "1.0",
  "size": { "width": 22, "depth": 22 },
  "environment": {
    "skyColor": "#1a3050",
    "fogDensity": 0.028,
    "fogColor": "#1a3050",
    "ambientColor": "#334466",
    "ambientIntensity": 1.05,
    "sunColor": "#ffeedd",
    "sunIntensity": 1.1,
    "dayNightCycle": true,
    "dayDuration": 180
  },
  "music": {
    "day":   "assets/audio/music/arena_day.mp3",
    "night": "assets/audio/music/arena_night.mp3"
  },
  "enemies": ["goblin", "orc", "troll", "ghost", "skeleton"],
  "maxEnemies": 12,
  "npcs": ["aron_merchant"],
  "events": ["rage", "gold_rain", "fog", "blessing"],
  "eventInterval": [55, 90],
  "level": { "min": 1, "max": 10 },
  "nextZones": [
    { "targetZone": "dungeon_01", "requiredLevel": 5 }
  ]
}
```

### Квест (quests/main/ch01_first_blood.json)

```json
{
  "id": "ch01_first_blood",
  "chain": "main",
  "order": 1,
  "name": "Первая кровь",
  "description": "Докажи свою силу в арене",
  "objectives": [
    {
      "id": "kill_5",
      "type": "kill",
      "target": "any",
      "count": 5,
      "description": "Убить 5 врагов"
    },
    {
      "id": "gold_50",
      "type": "collect",
      "item": "gold",
      "count": 50,
      "description": "Собрать 50 золота"
    }
  ],
  "rewards": {
    "xp": 80,
    "gold": 50,
    "items": [],
    "unlocks": ["ch02_the_merchant"]
  },
  "prerequisite": null,
  "zone": "arena",
  "repeatable": false
}
```

### Предмет (items/consumables/potion_hp.json)

```json
{
  "id": "potion_hp",
  "name": "Зелье здоровья",
  "category": "consumable",
  "rarity": "common",
  "icon": "🧪",
  "description": "Восстанавливает 45% максимального HP",
  "stackable": true,
  "maxStack": 99,
  "shopValue": 25,
  "sellValue": 10,
  "effect": {
    "type": "heal",
    "value": 0.45,
    "valueType": "percent_max_hp"
  },
  "visual": {
    "color": "#e91e8c",
    "emissive": "#330010",
    "geometry": "cylinder",
    "params": [0.07, 0.1, 0.32, 8]
  }
}
```

---

## 6. КАТАЛОГ СОБЫТИЙ EVENTBUS

| Событие | Данные | Кто emit | Кто слушает |
|---------|--------|----------|-------------|
| `entity:died` | `{entityId, pos, xp, gold, tags}` | CombatSystem | Quest, XP, Loot, Renderer |
| `entity:damaged` | `{entityId, amount, source}` | CombatSystem | HUD, Renderer (числа урона) |
| `entity:healed` | `{entityId, amount}` | CombatSystem | HUD, Renderer |
| `entity:spawned` | `{entityId, def}` | SpawnSystem | Renderer (создать меш) |
| `entity:destroyed` | `{id}` | World | Renderer (удалить меш) |
| `player:levelup` | `{level, hp, atk}` | ExperienceSystem | HUD, Quest, Renderer |
| `player:stats-changed` | `{}` | любая система | HUD |
| `player:died` | `{pos}` | CombatSystem | GameState → 'dead' |
| `loot:spawned` | `{entityId, type, amount, pos}` | LootSystem | Renderer (создать меш) |
| `loot:collected` | `{type, amount}` | LootSystem | HUD, Quest |
| `quest:progress` | `{questId, objectiveId, value}` | QuestSystem | JournalPanel |
| `quest:completed` | `{questId, rewards}` | QuestSystem | HUD, JournalPanel, Renderer |
| `world:event-start` | `{type, duration, name}` | WorldEventSystem | DayNight, AI, HUD |
| `world:event-end` | `{type}` | WorldEventSystem | DayNight, AI |
| `zone:loading` | `{zoneId}` | ZoneManager | UI (loading screen) |
| `zone:loaded` | `{zoneId}` | ZoneManager | SpawnSystem, GameState |
| `zone:unloaded` | `{zoneId}` | ZoneManager | Renderer (cleanup) |
| `shop:opened` | `{npcId}` | UIManager | InputManager (lock) |
| `shop:closed` | `{}` | UIManager | InputManager (unlock) |
| `ui:panel-open` | `{panelId}` | UIManager | InputManager |
| `ui:panel-close` | `{panelId}` | UIManager | InputManager |
| `state:changed` | `{from, to, data}` | StateMachine | все |
| `loop:fixed` | `{dt}` | GameLoop | AI, Physics, Network |
| `loop:render` | `{dt, alpha, elapsed}` | GameLoop | Renderer |
| `network:sync` | `{players}` | NetworkSystem | Renderer (других игроков) |
| `input:action` | `{action, pressed}` | InputManager | все системы |

---

## 7. ПОРЯДОК ЗАГРУЗКИ СКРИПТОВ

```html
<!-- ═══ ВНЕШНИЕ ЗАВИСИМОСТИ ══════════════════════════════ -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>

<!-- ═══ СЛОЙ 0: ЯДРО ════════════════════════════════════ -->
<script src="../core/Logger.js"></script>
<script src="../core/Config.js"></script>
<script src="../core/EventBus.js"></script>
<script src="../core/ServiceLocator.js"></script>
<script src="../core/StateMachine.js"></script>
<script src="../core/ObjectPool.js"></script>

<!-- ═══ СЛОЙ 1: ДВИЖОК ══════════════════════════════════ -->
<script src="../engine/AudioSystem.js"></script>
<script src="../engine/InputManager.js"></script>
<script src="../engine/AssetLoader.js"></script>
<script src="../engine/SaveSystem.js"></script>
<script src="../engine/GameLoop.js"></script>

<!-- ═══ СЛОЙ 2: ECS ═════════════════════════════════════ -->
<script src="../ecs/System.js"></script>
<script src="../ecs/Entity.js"></script>
<script src="../ecs/World.js"></script>

<!-- ═══ СЛОЙ 3: КОМПОНЕНТЫ (только данные) ══════════════ -->
<script src="../components/TransformComponent.js"></script>
<script src="../components/HealthComponent.js"></script>
<script src="../components/CombatComponent.js"></script>
<script src="../components/MovementComponent.js"></script>
<script src="../components/AIComponent.js"></script>
<script src="../components/StatsComponent.js"></script>
<script src="../components/InventoryComponent.js"></script>
<script src="../components/LootComponent.js"></script>
<script src="../components/RenderComponent.js"></script>
<script src="../components/TagComponent.js"></script>

<!-- ═══ СЛОЙ 4: РЕНДЕР ══════════════════════════════════ -->
<script src="../renderer/3d/Scene3D.js"></script>
<script src="../renderer/3d/MeshFactory.js"></script>
<script src="../renderer/3d/ParticlePool.js"></script>
<script src="../renderer/3d/DayNightRenderer.js"></script>
<script src="../renderer/3d/LODManager.js"></script>
<script src="../renderer/3d/OverlayRenderer.js"></script>
<script src="../renderer/3d/MinimapRenderer.js"></script>

<!-- ═══ СЛОЙ 5: МИР ═════════════════════════════════════ -->
<script src="../world/WorldBuilder.js"></script>
<script src="../world/ZoneManager.js"></script>
<script src="../world/SpawnPointManager.js"></script>
<script src="../world/NPCManager.js"></script>

<!-- ═══ СЛОЙ 6: СИСТЕМЫ ═════════════════════════════════ -->
<script src="../systems/MovementSystem.js"></script>
<script src="../systems/CollisionSystem.js"></script>
<script src="../systems/CombatSystem.js"></script>
<script src="../systems/AISystem.js"></script>
<script src="../systems/SpawnSystem.js"></script>
<script src="../systems/LootSystem.js"></script>
<script src="../systems/ExperienceSystem.js"></script>
<script src="../systems/QuestSystem.js"></script>
<script src="../systems/WorldEventSystem.js"></script>
<script src="../systems/NetworkSystem.js"></script>

<!-- ═══ СЛОЙ 7: UI ══════════════════════════════════════ -->
<script src="../ui/widgets/FloatingText.js"></script>
<script src="../ui/widgets/ProgressBar.js"></script>
<script src="../ui/widgets/Tooltip.js"></script>
<script src="../ui/panels/HUDPanel.js"></script>
<script src="../ui/panels/ShopPanel.js"></script>
<script src="../ui/panels/JournalPanel.js"></script>
<script src="../ui/panels/InventoryPanel.js"></script>
<script src="../ui/panels/DeathPanel.js"></script>
<script src="../ui/UIManager.js"></script>

<!-- ═══ ТОЧКА ВХОДА ═════════════════════════════════════ -->
<script src="main.js"></script>  <!-- инициализация, GameState.transition('loading') -->
```

---

## 8. БАЗА ДАННЫХ (расширенная схема)

```sql
-- Основная таблица игроков
CREATE TABLE players (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  session_id  VARCHAR(64)   NOT NULL UNIQUE,
  name        VARCHAR(50)   NOT NULL DEFAULT 'Wanderer',
  -- Положение в мире
  zone        VARCHAR(64)   NOT NULL DEFAULT 'arena',
  pos_x       FLOAT         NOT NULL DEFAULT 0,
  pos_z       FLOAT         NOT NULL DEFAULT 0,
  -- Основные характеристики
  level       INT           NOT NULL DEFAULT 1,
  xp          INT           NOT NULL DEFAULT 0,
  xp_next     INT           NOT NULL DEFAULT 100,
  hp          INT           NOT NULL DEFAULT 100,
  max_hp      INT           NOT NULL DEFAULT 100,
  atk         INT           NOT NULL DEFAULT 22,
  -- Инвентарь
  gold        INT           NOT NULL DEFAULT 0,
  potions     INT           NOT NULL DEFAULT 0,
  -- Статистика
  kills_total INT           NOT NULL DEFAULT 0,
  deaths      INT           NOT NULL DEFAULT 0,
  playtime    INT           NOT NULL DEFAULT 0,  -- секунды
  -- Метаданные
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_zone (zone),
  INDEX idx_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Инвентарь (слоты)
CREATE TABLE inventory (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  session_id  VARCHAR(64)   NOT NULL,
  item_id     VARCHAR(64)   NOT NULL,  -- goblin.json → "sword_iron"
  quantity    INT           NOT NULL DEFAULT 1,
  slot        INT,                      -- NULL = не экипировано
  FOREIGN KEY (session_id) REFERENCES players(session_id) ON DELETE CASCADE,
  INDEX idx_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Квесты
CREATE TABLE quest_progress (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  session_id  VARCHAR(64)   NOT NULL,
  quest_id    VARCHAR(64)   NOT NULL,  -- "ch01_first_blood"
  status      ENUM('active','completed','failed') DEFAULT 'active',
  progress    JSON,                     -- {"kill_5": 3, "gold_50": 20}
  started_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  UNIQUE KEY uk_player_quest (session_id, quest_id),
  FOREIGN KEY (session_id) REFERENCES players(session_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Чат
CREATE TABLE chat_messages (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  session_id  VARCHAR(64)   NOT NULL,
  name        VARCHAR(50)   NOT NULL,
  zone        VARCHAR(64)   NOT NULL DEFAULT 'global',
  message     VARCHAR(200)  NOT NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_zone_time (zone, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Таблица лидеров (обновляется триггером или событием)
CREATE TABLE leaderboard (
  session_id  VARCHAR(64)   NOT NULL PRIMARY KEY,
  name        VARCHAR(50)   NOT NULL,
  level       INT           NOT NULL,
  kills_total INT           NOT NULL,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_level (level DESC),
  INDEX idx_kills (kills_total DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## 9. СТРАТЕГИИ ПРОИЗВОДИТЕЛЬНОСТИ

### 9.1 Пространственное хэширование для коллизий

```javascript
// Вместо O(n²) проверки всех пар — только соседние ячейки
var SpatialHash = {
  CELL: 4,  // размер ячейки в юнитах
  _grid: {},

  key: function (x, z) {
    return Math.floor(x / this.CELL) + ',' + Math.floor(z / this.CELL);
  },

  insert: function (entityId, x, z) {
    var k = this.key(x, z);
    if (!this._grid[k]) this._grid[k] = [];
    this._grid[k].push(entityId);
  },

  query: function (x, z, radius) {
    var results = [], cells = Math.ceil(radius / this.CELL);
    for (var dx = -cells; dx <= cells; dx++) {
      for (var dz = -cells; dz <= cells; dz++) {
        var k = (Math.floor(x / this.CELL) + dx) + ',' +
                (Math.floor(z / this.CELL) + dz);
        if (this._grid[k]) results = results.concat(this._grid[k]);
      }
    }
    return results;
  },

  clear: function () { this._grid = {}; }
};
```

### 9.2 LOD (Level of Detail)

```javascript
// renderer/3d/LODManager.js
function updateLOD(camera, entities) {
  entities.forEach(function (e) {
    var dist = camera.position.distanceTo(e.mesh.position);
    if      (dist < 8)  { e.mesh.geometry = highDetail;   }
    else if (dist < 20) { e.mesh.geometry = mediumDetail; }
    else                { e.mesh.geometry = lowDetail;    }
    // совсем далеко — выключить тени
    e.mesh.castShadow    = dist < 15;
    e.mesh.receiveShadow = dist < 15;
  });
}
```

### 9.3 Frustum Culling

```javascript
// Не обновляем объекты вне поля зрения камеры
var frustum = new THREE.Frustum();
var cMatrix = new THREE.Matrix4();

function isVisible(mesh) {
  cMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(cMatrix);
  return frustum.intersectsObject(mesh);
}

// В AI системе: пропускаем врагов вне поля зрения
entities.forEach(function (e) {
  if (!isVisible(e.mesh)) return;  // пропустить дорогой AI
  AISystem.tick(e, dt);
});
```

### 9.4 Правило производительности: 60 FPS

| Бюджет | На что тратить |
|--------|---------------|
| 8ms    | JavaScript: логика, AI, коллизии |
| 4ms    | Three.js draw calls |
| 4ms    | Браузер: layout, compositing |
| **16ms total** | **≥ 60 FPS** |

Цель: не больше 50 draw calls за кадр. Используй `THREE.InstancedMesh` для врагов одного типа.

---

## 10. ПЛАН МИГРАЦИИ

### Фаза 1 — Уже сделано ✅
- `engine/AudioSystem.js`, `engine/DayNight.js`, `engine/ParticleSystem.js`
- `world/Arena.js`, `world/NPC.js`
- `systems/CombatSystem.js`, `systems/EnemySystem.js`, `systems/LootSystem.js`
- `systems/QuestSystem.js`, `systems/WorldEvents.js`
- `ui/HUD.js`, `ui/Overlay.js`, `ui/Minimap.js`, `ui/Shop.js`

### Фаза 2 — Приоритет (следующий шаг)
- [ ] `core/EventBus.js` — убрать прямые вызовы между системами
- [ ] `core/ServiceLocator.js` — убрать глобальные `var scene, PS`
- [ ] `data/enemies/*.json` — вынести `eDefs[]` из `EnemySystem.js`
- [ ] `data/worlds/arena/*.json` — вынести геометрию из `Arena.js`
- [ ] `world/WorldBuilder.js` — читает JSON и строит Three.js объекты

### Фаза 3 — Масштабирование
- [ ] `core/ObjectPool.js` + переписать `ParticleSystem` на Ring Buffer
- [ ] `ecs/World.js` — перейти на ECS (Entity вместо объектов `en`)
- [ ] `world/ZoneManager.js` — поддержка нескольких зон с переходами
- [ ] `engine/AssetLoader.js` — ленивая загрузка данных зоны

### Фаза 4 — Полировка
- [ ] `renderer/3d/LODManager.js` + FrustumCuller
- [ ] `core/StateMachine.js` — замена флагов `shopOpen/journalOpen`
- [ ] `engine/GameLoop.js` — фиксированный timestep
- [ ] `ui/UIManager.js` — стек панелей вместо `display:block/none`

---

*Документ версия 1.0 · NEXUS Architecture*
