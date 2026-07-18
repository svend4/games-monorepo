/* =============================================================================
 * Block Surge — FTUE-ОНБОРДИНГ (Проход Д, релизная финализация)
 * -----------------------------------------------------------------------------
 * Реализует «первые 5 минут» из 07-ux-ui-ftue.md §3 как оверлей-коуч-марки
 * поверх готового прототипа Проходов А+Б+В+Г. НИЧЕГО не переписывает в ядре,
 * мете и монетизации — только ДОБАВЛЯЕТ обучающий слой. Подключается в
 * index.html ПОСЛЕ game.js (использует глобалы ядра для геометрии подсветки:
 * window.CFG / BOARD_X / BOARD_Y / DOCK_Y / GRID_W / W / H / slotRect — все они
 * объявлены `var`/`function` на верхнем уровне game.js, т.е. живут на window).
 *
 * ПОВЕДЕНИЕ:
 *  - Показывается на ПЕРВОМ запуске: флаг «онбординг пройден» лежит в
 *    localStorage под префиксом игры (`blocksurge_ftue`). ОТСУТСТВИЕ флага =
 *    показать (совместимо со старыми сейвами Проходов А/Б/В/Г — у них этого
 *    ключа нет, ядро/мета/монетизация читают свои ключи и не ломаются).
 *  - Пропускается кнопкой «Пропустить» на любом шаге; проходится до конца
 *    кнопкой «Готово · играть». Оба случая ставят флаг (больше не всплывает).
 *  - Кнопка «Пройти обучение снова» (в мете, #ftueReplayBtn) запускает тур
 *    заново ВНЕ зависимости от флага.
 *
 * Оверлей блокирует ввод в игру, пока он открыт (коуч-марки читаются, а не
 * перебиваются ходами) — поэтому онбординг не может случайно сломать состояние
 * партии. Подсветка (spotlight) чисто визуальная: показывает, ГДЕ элемент, но
 * не двигает игру. Шаги, тайминги и тексты — строго из 07 §3 (+ правила рекламы
 * 06 §3). Русский UI, чистый DOM, без сборщиков и внешних зависимостей.
 * ========================================================================== */
'use strict';

window.Onboarding = (function () {

  var FTUE_KEY = 'blocksurge_ftue';   // префикс игры — как best/meta/monetize/softlaunch

  /* --------------------------- Флаг «пройдено» ---------------------------- */

  function isDone() {
    try { return !!localStorage.getItem(FTUE_KEY); } catch (e) { return false; }
  }
  function markDone(how) {
    try {
      localStorage.setItem(FTUE_KEY, JSON.stringify({ done: true, v: 1, how: how || 'complete', ts: Date.now() }));
    } catch (e) { /* приватный режим / переполнение — не критично, покажем ещё раз */ }
  }

  /* ---------------------- Геометрия целей подсветки ----------------------- */
  /* DOM-цели меряем напрямую; регионы внутри канваса (рука/поле/гнездо бомбы) —
   * переводим из логических координат ядра в экранные через rect канваса. */

  function domRect(sel) {
    var el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el || !el.getBoundingClientRect) return null;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) return null;   // скрытый/несмонтированный
    return r;
  }

  function canvasRect(lx, ly, lw, lh) {
    var cv = document.getElementById('game');
    if (!cv || !window.W || !window.H) return null;
    var r = cv.getBoundingClientRect();
    if (r.width <= 0) return null;
    var sx = r.width / window.W, sy = r.height / window.H;
    return { left: r.left + lx * sx, top: r.top + ly * sy, width: lw * sx, height: lh * sy };
  }

  function dockRect() {   // «рука»: три гнезда фигур + гнездо бомбы (нижняя полоса канваса)
    if (window.BOARD_X === undefined || window.DOCK_Y === undefined || !window.GRID_W || !window.CFG) return null;
    return canvasRect(window.BOARD_X, window.DOCK_Y, window.GRID_W, window.CFG.DOCK_H);
  }
  function boardRect() {  // поле 8×8
    if (window.BOARD_X === undefined || window.BOARD_Y === undefined || !window.GRID_W) return null;
    return canvasRect(window.BOARD_X, window.BOARD_Y, window.GRID_W, window.GRID_W);
  }
  function bombSlotRect() {   // 4-е гнездо дока — куда приходит кристальная бомба
    if (typeof window.slotRect !== 'function') return dockRect();
    var s = window.slotRect(3);
    return canvasRect(s.x, s.y, s.w, s.h);
  }

  /* ------------------------------- ШАГИ ---------------------------------- */
  /* Ровно по 07 §3 (первые 5 минут). meta — привязка к шагу/таймингу книги. */

  var STEPS = [
    {
      id: 'shapes',
      meta: '07 §3 · шаги 1–2 · 0:00–0:05',
      title: 'Клади фигуры на поле',
      text: 'Внизу — твоя рука из фигур. Перетащи любую на сетку 8×8. Зелёная подсветка — сюда можно, красная — нельзя. Ни регистраций, ни таймеров: играем сразу и без спешки.',
      target: dockRect
    },
    {
      id: 'line',
      meta: '07 §3 · шаги 3–4 · 0:20–0:45',
      title: 'Собирай ряды и столбцы',
      text: 'Заполни ряд или столбец целиком — он очистится и освободит место под новые фигуры. Это весь цикл: собрал линию → получил очки и монеты. Ошибиться не страшно, поле прощает.',
      target: boardRect
    },
    {
      id: 'surge',
      meta: '07 §3 · шаги 5–6 · 2:30',
      title: 'Комбо заряжает «Прилив»',
      text: 'Очистки в ходах подряд дают комбо ×2 · ×3 · ×5 и заполняют шкалу «Прилив» вот здесь, сверху. Планировать цепочки очисток — главный навык Block Surge.',
      target: '#surgeWrap'
    },
    {
      id: 'crystal',
      meta: '07 §3 · шаг 7 · 3:00–4:30',
      title: 'Полный «Прилив» → кристалл',
      text: 'Когда шкала заполнится, в четвёртое гнездо дока придёт кристальная бомба. Перетащи её на поле — она взорвёт область 3×3 и добавит очков. Это кульминация партии.',
      target: bombSlotRect
    },
    {
      id: 'coins',
      meta: '07 §3 · шаг 8 · 4:30',
      title: 'Монеты и награды',
      text: 'За очистки, комбо и партии капают монеты — счётчик слева вверху. На них берут бустеры-спасатели, а карта «Путешествия», серия дней и ежедневные миссии ждут в меню «Мета».',
      target: '.coinBox'
    },
    {
      id: 'ads',
      meta: '06 §3 · 07 §3 (минуты 5–10)',
      title: 'Реклама — по желанию и позже',
      text: 'Ролики за награду («Второй шанс», «×2 монеты», бесплатный бустер) — всегда добровольны и всегда выгодны. Первый такой ролик появится, только когда ты освоишь правила; реклама между партиями — не раньше 6-го уровня и 8-й минуты. Никаких фейковых крестиков.',
      target: '#openMetaBtn'
    }
  ];

  /* ------------------------------ DOM тур -------------------------------- */

  var idx = 0;
  var built = false;
  var visible = false;
  var els = {};

  function build() {
    if (built) return;

    var ov = document.createElement('div');
    ov.id = 'ftueOverlay';
    ov.className = 'hidden';
    ov.setAttribute('aria-hidden', 'true');

    var spot = document.createElement('div');
    spot.id = 'ftueSpot';

    var card = document.createElement('div');
    card.id = 'ftueCard';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'ftueTitle');
    card.innerHTML =
      '<div class="ftueTag">Обучение · первые 5 минут (07 §3)</div>' +
      '<div class="ftueStepMeta" id="ftueStepMeta"></div>' +
      '<h3 id="ftueTitle"></h3>' +
      '<p id="ftueText"></p>' +
      '<div class="ftueDots" id="ftueDots"></div>' +
      '<div class="ftueBtns">' +
        '<button id="ftueSkip" type="button" class="ftueSkipBtn">Пропустить</button>' +
        '<span class="ftueSpacer"></span>' +
        '<button id="ftueBack" type="button" class="ftueNavBtn">← Назад</button>' +
        '<button id="ftueNext" type="button" class="ftueNavBtn ftuePrimary">Далее →</button>' +
      '</div>';

    ov.appendChild(spot);
    ov.appendChild(card);
    document.body.appendChild(ov);

    // Клик по затемнению — не проваливается в игру (оверлей ловит ввод сам).
    ov.addEventListener('click', function (e) { if (e.target === ov) e.stopPropagation(); });

    els.overlay = ov;
    els.spot = spot;
    els.card = card;
    els.stepMeta = card.querySelector('#ftueStepMeta');
    els.title = card.querySelector('#ftueTitle');
    els.text = card.querySelector('#ftueText');
    els.dots = card.querySelector('#ftueDots');
    els.skip = card.querySelector('#ftueSkip');
    els.back = card.querySelector('#ftueBack');
    els.next = card.querySelector('#ftueNext');

    els.skip.addEventListener('click', function () { finish('skip'); });
    els.back.addEventListener('click', back);
    els.next.addEventListener('click', next);

    // Дотсы (индикатор шагов) — по числу шагов.
    for (var i = 0; i < STEPS.length; i++) {
      var d = document.createElement('span');
      d.className = 'ftueDot';
      els.dots.appendChild(d);
    }

    built = true;
  }

  /* ------------------------- Позиционирование ---------------------------- */

  function resolveTarget(t) {
    if (!t) return null;
    try { return typeof t === 'function' ? t() : domRect(t); }
    catch (e) { return null; }
  }

  function positionSpot(rect) {
    var spot = els.spot;
    if (!rect) { els.overlay.classList.add('ftue-nospot'); spot.style.display = 'none'; return; }
    els.overlay.classList.remove('ftue-nospot');
    spot.style.display = 'block';
    var pad = 8;
    spot.style.left = (rect.left - pad) + 'px';
    spot.style.top = (rect.top - pad) + 'px';
    spot.style.width = (rect.width + pad * 2) + 'px';
    spot.style.height = (rect.height + pad * 2) + 'px';
  }

  function positionCard(rect) {
    var card = els.card;
    card.style.left = '50%';
    if (!rect) {
      card.style.top = '50%';
      card.style.bottom = 'auto';
      card.style.transform = 'translate(-50%, -50%)';
      return;
    }
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var spotMid = rect.top + rect.height / 2;
    card.style.transform = 'translateX(-50%)';
    if (spotMid < vh / 2) {   // цель в верхней половине → карточка снизу
      card.style.top = 'auto';
      card.style.bottom = '24px';
    } else {                  // цель в нижней половине → карточка сверху
      card.style.bottom = 'auto';
      card.style.top = '24px';
    }
  }

  function render() {
    if (!visible) return;
    var step = STEPS[idx];
    els.stepMeta.textContent = 'Шаг ' + (idx + 1) + ' из ' + STEPS.length + ' · ' + step.meta;
    els.title.textContent = step.title;
    els.text.textContent = step.text;

    var dots = els.dots.children;
    for (var i = 0; i < dots.length; i++) {
      dots[i].className = 'ftueDot' + (i === idx ? ' active' : (i < idx ? ' done' : ''));
    }

    els.back.disabled = idx === 0;
    els.back.style.visibility = idx === 0 ? 'hidden' : 'visible';
    els.next.textContent = idx === STEPS.length - 1 ? 'Готово · играть ▶' : 'Далее →';

    var rect = resolveTarget(step.target);
    positionSpot(rect);
    positionCard(rect);

    track('view', step.id);
  }

  /* ------------------------------ Управление ----------------------------- */

  function show(startAt) {
    build();
    idx = startAt || 0;
    visible = true;
    els.overlay.classList.remove('hidden');
    els.overlay.setAttribute('aria-hidden', 'false');
    // Ждём кадр, чтобы канвас/лейаут точно измерились после снятия display:none.
    requestAnimationFrame(function () { render(); });
    track('start', STEPS[idx] ? STEPS[idx].id : 'start');
  }

  function hide() {
    visible = false;
    if (els.overlay) {
      els.overlay.classList.add('hidden');
      els.overlay.setAttribute('aria-hidden', 'true');
    }
  }

  function next() {
    if (idx >= STEPS.length - 1) { finish('complete'); return; }
    idx++;
    render();
  }
  function back() {
    if (idx <= 0) return;
    idx--;
    render();
  }
  function finish(how) {
    markDone(how);
    hide();
    track(how === 'skip' ? 'skip' : 'complete', STEPS[idx] ? STEPS[idx].id : 'end');
  }

  /* Публичный запуск «пройти заново» — игнорирует флаг. */
  function start() { show(0); }

  /* Автозапуск на первом запуске — только если флаг не стоит. */
  function maybeAutoStart() { if (!isDone()) show(0); }

  /* ------------------------------ Аналитика ------------------------------ */
  /* Событие ftue_step из 09 §2 — грунт под KPI FTUE (07 §3: завершение шагов). */
  function track(action, id) {
    if (window.Analytics && typeof window.Analytics.track === 'function') {
      try { window.Analytics.track('ftue_step', { action: action, step: idx + 1, id: id }); }
      catch (e) { /* no-op */ }
    }
  }

  /* ---------------------------- Инициализация ---------------------------- */

  function init() {
    var replay = document.getElementById('ftueReplayBtn');
    if (replay) {
      replay.addEventListener('click', function () {
        if (window.Meta && typeof window.Meta.closeMeta === 'function') window.Meta.closeMeta();
        start();
      });
    }
    // Перепозиционируем при ресайзе/повороте, пока тур открыт.
    window.addEventListener('resize', function () { if (visible) render(); });
    // rAF после load: канвас уже получил свой style.width от game.js, лейаут стабилен.
    requestAnimationFrame(maybeAutoStart);
  }

  if (document.readyState === 'complete') init();
  else window.addEventListener('load', init);

  return {
    start: start,
    isDone: isDone,
    steps: STEPS.length,
    // для отладки/тестов: сбросить флаг, чтобы онбординг всплыл заново
    _reset: function () { try { localStorage.removeItem(FTUE_KEY); } catch (e) { /* no-op */ } }
  };
})();
