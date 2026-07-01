---
id: NX-POLY-002
title: «Проект в проекте» — вложение и композиция (submodule, vendoring, воркспейсы, iframe, ESM-federation, плагины)
type: system
status: proposed
layer: technical
abstraction: extended
version: 0.1
created: 2026-06-29
updated: 2026-06-29
authors: [claude-opus-4-8]
tags: [polyglot, monorepo, submodule, subtree, vendoring, workspaces, iframe, microfrontend, esm-federation, plugins, interop, isolation, versioning, containers]
relates_to: [NX-POLY-001, NX-POLY-003, NX-SYS-006, NX-INN-003, NX-VIS-002, NX-SPEC-002]
depends_on: [NX-POLY-003]
comments_on: [NX-ARCH#sec1-structure, NX-REVIEW#sec2-monorepo, NX-VIS-002#modularity]
superseded_by: null
inspiration_sources: [c20-proven, humanities]
new_vs_known: новое — единая «лестница вложения» (6 ступеней изоляции/связности) и правило подбора ступени по матрице «граница × версия × язык» для NEXUS; кирпичики — Unix-философия маленьких программ, git submodule/subtree (1990–2010-е), vendoring, монорепо-воркспейсы, iframe; новое измерение — ESM Module Federation и контейнеры поверх них
innovation_score: 3
improves: { quantitative: "снижает связность между подпроектами: правка одного варианта (v1/v2/v3) не пересобирает остальные; целевой бандл клиента <= размера одного варианта вместо суммы", qualitative: "ясные границы и версии — рой агентов может работать над подпроектами параллельно без слияния-ада" }
maturity: analyzed
risk: med
effort: M
language: ru
---

# «Проект в проекте»: вложение и композиция

## TL;DR
Встроить проект в проект можно шестью способами — от простого копирования файлов (vendoring)
до изоляции в `iframe`/контейнере и динамической склейки модулей через ESM Module Federation.
Все они — варианты одной «лестницы»: чем выше ступень, тем сильнее изоляция и слабее связность,
но тем дороже interop. NEXUS уже монорепо (`games/nexus/{shared,v1,v2,v3}`), поэтому правило
простое: **общий код — через воркспейс-`shared`, чужой код — через vendoring/submodule,
рискованный сторонний UI — через `iframe`, поздняя склейка независимых сборок — через federation.**

## Краткое содержание
«Проект в проекте» — это всегда выбор по трём осям: **где граница** (papka, репозиторий,
процесс, документ), **как версионируется вложенное** (вместе с родителем или независимо) и
**на каком языке/рантайме** оно живёт. Unix-философия XX века уже решила базовый случай:
маленькие программы, делающие одно дело, склеенные пайпами и общими файлами. Современность
добавила одно новое измерение — **позднюю композицию независимо собранных модулей в браузере**
(ESM Module Federation) и **жёсткую изоляцию рантайма** (контейнеры/WASM-песочница).

Этот документ даёт лестницу из шести ступеней вложения, таблицы выбора, конкретные команды
(`git submodule`, `git subtree`, npm/pnpm workspaces, `import maps`, federation-конфиг,
`iframe` + `postMessage`), и привязывает их к реальной структуре NEXUS из
[NX-ARCH#sec1-structure]. Механизмы interop между языками вынесены в [NX-POLY-003];
здесь — только организация исходников и границы. Связь со сборкой/деплоем — в [NX-SYS-006].

## Расширенное содержание (общее)

### Лестница вложения: 6 ступеней
От самой связной (всё пересобирается вместе) к самой изолированной (отдельный рантайм):

| Ст. | Способ | Граница | Версия вложенного | Изоляция | Когда |
|-----|--------|---------|-------------------|----------|-------|
| 0 | **Vendoring** (копия файлов) | папка `vendor/` | заморожена в коммите | нет | мелкая чужая утилита, нет своего пакета |
| 1 | **Монорепо-воркспейс** | пакет в одном репо | едина с родителем | модульная (импорт) | НАШ общий код — `shared/` |
| 2 | **git submodule** | вложенный git-репо | независимая (свой коммит-указатель) | репо-граница | чужой/наш репо, нужна точная версия |
| 3 | **git subtree** | подкаталог, история влита | вместе, но обновляема | нет | как submodule, но без боли submodule |
| 4 | **iframe** | отдельный документ/origin | независимая (свой бандл) | DOM/JS-песочница | рискованный сторонний UI, изоляция стилей |
| 5 | **ESM Module Federation** | отдельная сборка, склейка в рантайме | независимая, может меняться без редеплоя хоста | модульная + версионная | микрофронтенды, плагины-фичи |
| 6 | **Контейнер / WASM-песочница** | отдельный процесс/линейная память | полностью независимая | процесс/память | недоверенный код, другой язык/рантайм |

Ступени 0–3 — про **организацию исходников** (статика, решается в git/npm). Ступени 4–6 — про
**рантайм-границу** (динамика, решается в браузере/ОС). Это разные вопросы и решаются
независимо: можно подключить чужой репо submodule'ом (ст. 2) и при этом крутить его в
`iframe` (ст. 4).

### Три оси выбора
1. **Граница.** Папка → репозиторий → документ(iframe) → процесс(контейнер). Чем дальше,
   тем дороже общение, тем безопаснее ошибки соседа.
2. **Версия.** «Вместе с родителем» (воркспейс, subtree) против «независимо»
   (submodule, federation-remote, контейнер-тег). Независимая версия = можно обновлять
   подпроект без касания родителя, но нужен контракт совместимости.
3. **Язык/рантайм.** Тот же JS-рантайм (воркспейс/federation), другой документ но тот же
   браузер (iframe), другой рантайм целиком (PHP-бэкенд, Python-генератор, WASM-модуль из
   Rust/Lua). Кросс-рантайм interop — отдельная тема [NX-POLY-003].

### Где NEXUS уже «проект в проекте»
Монорепо NEXUS — это де-факто ступени 0–1 уже сейчас:
- `shared/{engine,systems,ui,world}` — общий код трёх вариантов (ступень 1, воркспейс-стиль);
- `v1-2d-mmo`, `v2-isometric`, `v3-3d` — три **подпроекта-варианта** одной игры, делящие `shared`;
- `nexus_api.php` — бэкенд-подпроект на другом рантайме (PHP), общающийся по HTTP/JSON;
- Python-генераторы контента и SQL-схема — ещё два подпроекта на своих языках.

То есть NEXUS уже полиглот-монорепо. Вопрос документа — **как добавлять новые вложения,
не превращая монорепо в "монолит-комок"**.

## Детали и частные случаи

### Ст. 0 — Vendoring (копия в репозиторий)
Просто кладём чужие файлы в `vendor/` и коммитим. Проверенный кирпичик: так делали до
пакетных менеджеров, и Go вернул это в моду (`go mod vendor`).
```bash
# вендорим крошечную либу детерминированного ГСЧ для генераторов мира
mkdir -p games/nexus/shared/vendor/alea
curl -L https://example/alea.min.js -o games/nexus/shared/vendor/alea/alea.js
# фиксируем источник и версию рядом — это обязательно
cat > games/nexus/shared/vendor/alea/VENDORED.md <<'EOF'
source: https://example/alea  v0.9  pinned 2026-06-29  license: MIT
update: replace alea.js, re-run tests/seed-stability.test.js
EOF
```
Плюс: ноль инфраструктуры, работает офлайн, детерминированный билд. Минус: ручное обновление,
легко забыть про патчи безопасности. Применять только к мелкому стабильному коду.

### Ст. 1 — Монорепо-воркспейс (НАШ общий код)
Для `shared/` это правильный уровень. Если введём `package.json`-воркспейсы:
```jsonc
// games/nexus/package.json
{
  "name": "nexus",
  "private": true,
  "workspaces": ["shared", "v1-2d-mmo", "v2-isometric", "v3-3d"]
}
```
```jsonc
// games/nexus/shared/package.json
{ "name": "@nexus/shared", "version": "0.1.0", "type": "module",
  "exports": { "./engine/*": "./engine/*.js", "./systems/*": "./systems/*.js" } }
```
```js
// в v3-3d/game.html (или его модуле) — импорт общего кода без копий
import { CombatSystem } from '@nexus/shared/systems/CombatSystem.js';
import { ParticleSystem } from '@nexus/shared/engine/ParticleSystem.js';
```
Плюс: одна версия, atomic-рефактор через все варианты, нет рассинхрона. Минус: все варианты
связаны — ломающее изменение в `shared` ломает всех сразу (это и хорошо, и плохо). Это база;
варианты, которым нужна своя версия `shared`, переходят на ст. 5 (federation).

### Ст. 2 — git submodule (независимая версия чужого/нашего репо)
Указатель на конкретный коммит другого репозитория.
```bash
# подключаем внешний движок физики как submodule с пинном на тег
git submodule add -b main https://github.com/acme/tinyphys.git \
    games/nexus/shared/vendor/tinyphys
cd games/nexus/shared/vendor/tinyphys && git checkout v1.4.0 && cd -
git add .gitmodules games/nexus/shared/vendor/tinyphys
git commit -m "feat: add tinyphys v1.4.0 as submodule"

# у того, кто клонирует:
git clone --recurse-submodules <repo>
# или после обычного клона:
git submodule update --init --recursive
# обновление до нового тега:
cd games/nexus/shared/vendor/tinyphys && git fetch && git checkout v1.5.0 && cd -
git commit -am "chore: bump tinyphys 1.4.0 -> 1.5.0"
```
Плюс: точная независимая версия, чужая история не засоряет нашу. Минус: классическая боль —
забытый `--recurse`, "detached HEAD", CI ломается без `update --init`. Для **наших** общих
кусков предпочитать ст. 1; submodule — для чужого кода или для шаринга между разными монорепо.

### Ст. 3 — git subtree (история влита, без боли submodule)
```bash
# добавляем тот же tinyphys, но вливаем содержимое (никаких .gitmodules)
git subtree add --prefix games/nexus/shared/vendor/tinyphys \
    https://github.com/acme/tinyphys.git v1.4.0 --squash
# обновление:
git subtree pull --prefix games/nexus/shared/vendor/tinyphys \
    https://github.com/acme/tinyphys.git v1.5.0 --squash
# при необходимости отдать наши патчи обратно:
git subtree push --prefix games/nexus/shared/vendor/tinyphys <fork> patches
```
Плюс: клонируется как обычная папка (никто не споткнётся), можно патчить локально. Минус:
история раздувается, апдейт через `--squash` иногда конфликтует. Хорош, когда потребители
репо не должны знать про вложение.

### Ст. 4 — iframe (изоляция документа/стилей/скриптов)
Для NEXUS уместно, когда встраиваем **чужой UI-виджет** (внешний лидерборд, редактор уровней,
рекламный/донат-блок) и не хотим, чтобы его CSS/JS трогал игру.
```html
<!-- хост: games/nexus/v1-2d-mmo/game.html -->
<iframe id="leaderboard"
        src="/games/nexus/widgets/leaderboard/index.html"
        sandbox="allow-scripts"            <!-- НЕ даём allow-same-origin недоверенному -->
        referrerpolicy="no-referrer"
        loading="lazy"></iframe>
<script type="module">
  const frame = document.getElementById('leaderboard');
  // строгий контракт сообщений — единственный канал связи
  frame.contentWindow.postMessage(
    { type: 'nexus:submitScore', score: 1280, sid: SESSION_ID },
    'https://nexus.example'                 // целевой origin явно, не '*'
  );
  window.addEventListener('message', (e) => {
    if (e.origin !== 'https://nexus.example') return;        // проверка отправителя
    if (e.data?.type === 'lb:rank') updateRankUI(e.data.rank);
  });
</script>
```
Плюс: настоящая изоляция (свой DOM, свой event loop, своя версия библиотек), краш виджета не
роняет игру. Минус: связь только через `postMessage` (сериализация, асинхронность), нельзя
делить WebGL-контекст. Идеально как «карантин» для недоверенного/тяжёлого UI.

### Ст. 5 — ESM Module Federation (поздняя склейка независимых сборок)
Новое измерение поверх старого `<script>`. Хост и «remote» собираются **отдельно**; хост
подтягивает модуль remote'а в рантайме по URL — можно обновить фичу без редеплоя хоста.
Нативный, безбандлерный путь — через **import maps**:
```html
<!-- хост объявляет, откуда брать федеративные модули -->
<script type="importmap">
{ "imports": {
    "@nexus/shared/": "/games/nexus/shared/",
    "feat-arena/":    "https://cdn.example/nexus-arena@2.3.1/"   <!-- независимая версия -->
} }
</script>
<script type="module">
  // ленивая загрузка фичи-плагина уже после старта игры
  const { mountArena } = await import('feat-arena/entry.js');
  mountArena(document.getElementById('arena-slot'), gameContext);
</script>
```
Бандлерный путь (Webpack/Rspack Module Federation) даёт **разделение singleton-зависимостей**
(одна копия `@nexus/shared` на хост и все remotes), чего import maps сам не гарантирует:
```js
// remote (фича-арена) — webpack.config.js
new ModuleFederationPlugin({
  name: 'feat_arena',
  filename: 'remoteEntry.js',
  exposes: { './entry': './src/arena.js' },
  shared: { '@nexus/shared': { singleton: true, requiredVersion: '^0.1.0' } }
});
```
Плюс: независимый деплой фич, A/B и горячая замена, рой может выкатывать варианты порознь.
Минус: контракт версий между хостом и remote — главный источник тонких багов; нужна
дисциплина semver. Это механизм для микрофронтенд-плагинов (см. контракт плагинов ниже).

### Ст. 6 — Контейнер / WASM-песочница (другой рантайм)
Для кода, которому нельзя доверять JS-рантайм целиком, или который на другом языке:
- **Серверная сторона:** PHP-бэкенд, Python-генераторы, очередь — каждый в своём контейнере;
  граница — HTTP/JSON или общий data-файл/БД. Детали interop — [NX-POLY-003].
- **Клиентская сторона:** модуль на Rust→WASM или Lua-скрипт мода исполняется в WASM-песочнице
  с явным импортом-экспортом (нет доступа к DOM, только то, что хост передал). Это даёт
  безопасную модерацию пользовательских модов.
```js
// загрузка недоверенного мод-скрипта (Rust→WASM) с минимальным импортом
const { instance } = await WebAssembly.instantiateStreaming(
  fetch('/mods/community/firestorm.wasm'),
  { env: { log: (p,n)=>console.log(decode(p,n)),    // только то, что разрешили
           rng: () => seededRandom() } }
);
const dmg = instance.exports.computeDamage(baseDmg, mods);  // ничего лишнего не достанет
```

### Контракт плагинов (надстройка над ст. 5/6)
Чтобы вложенные фичи/моды были взаимозаменяемы, фиксируем **манифест + точки расширения**:
```jsonc
// games/nexus/plugins/firestorm/plugin.json
{ "id": "firestorm", "apiVersion": "1.x", "kind": "ability",
  "entry": "https://cdn.example/firestorm@1.2.0/entry.js",  // federation-remote
  "permissions": ["combat.read", "particles.emit"],          // что можно (как iframe sandbox)
  "hooks": ["onCastAbility"] }
```
```js
// хост: реестр плагинов — единый узкий контракт (Unix: "одно дело")
registry.register(manifest, async (host) => {
  const mod = await import(manifest.entry);
  return mod.activate(host.scopedApi(manifest.permissions));  // выдаём только разрешённое
});
```

## Предложения и варианты реализации

### Дерево решения «какую ступень брать»
```pseudo
function chooseNesting(item):
  if item.isOurSharedCode:                 return WORKSPACE        # ст.1
  if item.isForeign and item.tiny:         return VENDOR           # ст.0
  if item.isForeign and item.needsExactVersion:
        return preferSubtreeUnless(consumersOK_withSubmodule)      # ст.3 / ст.2
  if item.isUI and item.untrusted:         return IFRAME           # ст.4
  if item.isFeature and item.deployIndependently: return FEDERATION # ст.5
  if item.isOtherRuntime or item.untrustedLogic:  return SANDBOX    # ст.6
```

### Рекомендации для NEXUS (конкретно)
- **`shared/` → ст. 1 (воркспейс).** Ввести `package.json` с `workspaces` и `exports`,
  заменить относительные `../shared/...` импорты на `@nexus/shared/...`.
- **Три варианта v1/v2/v3 → подпроекты-воркспейсы.** Каждый со своим `index`/бандлом, общий
  код только из `@nexus/shared`. Это даёт независимую сборку варианта (см. [NX-SYS-006]).
- **Чужие движки/утилиты → ст. 3 (subtree) по умолчанию**, ст. 2 (submodule) только если код
  шарится между несколькими нашими репо.
- **Сторонние виджеты (лидерборд, донат) → ст. 4 (iframe sandbox)**.
- **Будущие фичи-плагины и пользовательские моды → ст. 5/6** через манифест-контракт выше;
  связь с эхо-мультиплеером и UGC — [NX-INN-003].

### Анти-паттерны (чего не делать)
- Не вкладывать НАШ общий код submodule'ом внутрь монорепо — это ст. 1, не ст. 2.
- Не использовать `postMessage(..., '*')` и `sandbox="allow-scripts allow-same-origin"`
  одновременно для недоверенного iframe — это снимает изоляцию.
- Не смешивать версии `@nexus/shared` без `singleton` в federation — получишь две копии
  состояния движка и неуловимые баги.

## Что нового и какие кирпичики
- **НОВОЕ (новое измерение):** ESM **Module Federation** и контейнеры/WASM-песочница —
  поздняя композиция и жёсткая изоляция независимо собранных частей **в браузере и рантайме**.
  Это «крылышко» поверх давно изобретённого «автомобиля» — статической линковки и `<script>`.
- **Проверенные кирпичики (колесо/авто, не переизобретаем):**
  - **Unix-философия** маленьких программ, делающих одно дело, и склейки через узкие контракты
    (пайпы, файлы) — прямой предок реестра плагинов и контракта `postMessage`.
  - **git submodule/subtree** (1990–2010-е), **vendoring** (вернул Go), **монорепо-воркспейсы**
    (npm/pnpm/Yarn), **iframe** (с 1990-х) — всё это зрелые, скучные, надёжные механизмы.
- **Источники:** c20-proven (Unix, модульность, версионирование), humanities (теория границ
  и инкапсуляции как управление сложностью).
- **Чего нет/редко в других проектах:** явная **лестница из 6 ступеней с правилом выбора по
  матрице «граница × версия × язык»**, специально привязанная к полиглот-монорепо игры, где
  под одной крышей живут JS-клиент, PHP-бэкенд, Python-генераторы и SQL.

## Риски, открытые вопросы
- **Версионный контракт federation/плагинов** — главный риск: рассинхрон хост↔remote. Нужна
  политика semver и runtime-проверка `apiVersion`. Открыто: где валидировать — на хосте или в манифесте?
- **submodule-боль в CI и у новых контрибьюторов** — возможно, везде предпочесть subtree.
- **WASM-песочница для модов** — какой минимальный безопасный import-surface? Пересечение с
  модерацией UGC из [NX-INN-003].
- **Стоит ли вообще вводить бандлер** (ради `singleton` в federation), или хватит нативных
  import maps для текущего масштаба? Решается вместе со сборкой [NX-SYS-006].
- **Граница «папка vs репозиторий» для трёх вариантов** — оставить в одном репо (текущее) или
  выделить, если команды/рои начнут мешать друг другу.

## Комментарии
Комментирует структуру монорепо из [NX-ARCH#sec1-structure] и замечания ревью
[NX-REVIEW#sec2-monorepo]. Развёрнутая ветка обсуждения — в отдельном `NX-CMT-###` при появлении.

## Связанные документы
- [NX-POLY-001 Язык под роль (полиглот-обзор)](NX-POLY-001-language-per-role.md)
- [NX-POLY-003 Механизмы interop между языками](NX-POLY-003-interop.md)
- [NX-SYS-006 Сборка, бандлинг и деплой](../30-systems/NX-SYS-006-save-versioning-modding.md)
- [NX-INN-003 Асинхронный эхо-мультиплеер (UGC/моды)](../20-innovation/NX-INN-003-echo-multiplayer.md)
- [NX-VIS-002 Философия дизайна (модульность)](../10-vision/NX-VIS-002-design-philosophy.md)
- [NX-SPEC-002 Спека контракта плагинов](../40-specs/NX-SPEC-002-ecs-archetypes.md)
