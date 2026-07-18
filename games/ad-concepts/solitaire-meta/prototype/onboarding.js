/* =====================================================================
 * Orchard Peaks — FTUE-онбординг (Проход Д, global)
 * ---------------------------------------------------------------------
 * Коуч-марки первого запуска по главе 07 §7.3 «первые 5 минут». Отдельный
 * модуль, подключён в index.html ПОСЛЕ game.js: к моменту его DOMContentLoaded
 * ядро уже разложило стартовую раздачу, поэтому подсветки указывают на реальные
 * элементы стола.
 *
 * Дизайн под аудиторию 45+ (07 §7.4): крупный шрифт, спокойный темп, никаких
 * таймеров, явные кнопки «Далее» и «Пропустить обучение» ≥ 88 pt высотой,
 * тёплый тон (07 §7.5). Один шаг = одна мысль; правило ±1 → серия/множитель →
 * первая карта урожая → зачем сад → первый заказ сада.
 *
 * СОВМЕСТИМОСТЬ СЕЙВОВ. Флаг «онбординг пройден» лежит в localStorage под
 * префиксом игры — ключ orchardPeaks.onboarding. ОТСУТСТВИЕ ключа = показать
 * (старые сейвы Проходов А–Г онбординга не имеют → он покажется один раз).
 * Модуль ничего не читает и не пишет в чужое состояние (economy/meta/monetize),
 * не трогает #overlay ядра и мета-экран — только собственный слой #onb-overlay.
 *
 * Ядро/мета/монетизацию НЕ ломает: онбординг лишь накрывает экран поверх и
 * снимается по «Далее»/«Пропустить». Повторно не мешает — флаг persist.
 * ===================================================================== */
(function () {
  'use strict';

  var STORAGE_KEY = 'orchardPeaks.onboarding';
  var VERSION = 1;                // растить при смене набора шагов → покажется снова

  /* ---------- Шаги FTUE (07 §7.3) ---------- */
  /* target: функция → DOM-элемент для подсветки (null = центрированная карточка).
     Разрешается лениво на каждом шаге, чтобы учесть текущий расклад. */
  var STEPS = [
    {
      mascot: '🌳',
      title: 'Добро пожаловать в сад',
      body: 'Вам достался в наследство запущенный сад тёти Марты — с теплицей, ' +
            'прудом и пасекой. Каждая партия в солитере — это день работы в саду. ' +
            'Пёс Бисквит уже ждёт. Давайте разложим первую партию.',
      target: null,
      cta: 'Показать, как играть'
    },
    {
      mascot: '🃏',
      title: 'Главное правило: на 1 выше или ниже',
      body: 'Внизу лежит карта сброса. Убирайте со стола любую открытую карту, ' +
            'чей номинал на 1 больше или на 1 меньше её. Туз и Король — соседи, ' +
            'круг замыкается. Ошиблись — кнопка «↩ Отмена» простит.',
      target: function () { return byId('waste-card'); },
      cta: 'Далее'
    },
    {
      mascot: '🂠',
      title: 'Нет хода — берите из колоды',
      body: 'Если подходящей карты на столе нет, откройте новую из колоды слева. ' +
            'Спешить некуда: здесь нет таймеров и штрафов за паузу. Играйте в ' +
            'своём темпе, хоть с чашкой кофе.',
      target: function () { return byId('stock-card'); },
      cta: 'Далее'
    },
    {
      mascot: '✨',
      title: 'Серия и множитель',
      body: 'Убирайте карты подряд, не заглядывая в колоду — растёт серия, а с ней ' +
            'множитель наград. Чем длиннее цепочка, тем больше монет за партию. ' +
            'Мягкое золотое свечение подскажет, что серия пошла.',
      target: function () { return closestHudItem('hud-chain'); },
      cta: 'Далее'
    },
    {
      mascot: '🍎',
      title: 'Карты урожая — зачем нужен сад',
      body: 'Карты со значком 🍎 приносят урожай. Урожай — не очки: это то, чем вы ' +
            'оживляете сад. Он копится в корзине наверху и сохраняется, даже если ' +
            'партия не сложилась.',
      target: function () {
        var badge = document.querySelector('#peaks .apple-badge');
        if (badge && badge.closest) {
          var card = badge.closest('.card');
          if (card) return card;
        }
        return closestHudItem('hud-harvest');
      },
      cta: 'Далее'
    },
    {
      mascot: '🌱',
      title: 'Первый заказ сада',
      body: 'Откройте «🌳 Сад» и выполните первый заказ — «расчистить крыльцо». ' +
            'Урожай уходит в заказ, крыльцо преображается на глазах, а следом ' +
            'открывается новая клумба. Так растёт вся история сада.',
      target: function () { return byId('btn-garden'); },
      cta: 'Далее'
    },
    {
      mascot: '🍎',
      title: 'Готово — сад ваш',
      body: 'Вот и всё, что нужно для начала. Играйте спокойно, в удобном ритме. ' +
            'Захотите освежить правила — нажмите «❓ Обучение» в верхней панели в ' +
            'любой момент. Доброго урожая!',
      target: null,
      cta: 'Начать играть'
    }
  ];

  /* ---------- Состояние модуля ---------- */
  var active = false;
  var idx = 0;
  var repositionBound = null;

  /* ---------- Утилиты ---------- */
  function byId(id) { return document.getElementById(id); }

  function closestHudItem(innerId) {
    var el = byId(innerId);
    if (el && el.closest) {
      var item = el.closest('.hud-item');
      if (item) return item;
    }
    return el;
  }

  function readFlag() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;                 // отсутствие = не пройдено
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  /* Пройдено, только если флаг есть И версия совпадает (иначе покажем обновлённый). */
  function isDone() {
    var f = readFlag();
    return !!(f && f.done && f.version === VERSION);
  }

  function markDone(skipped) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        done: true,
        version: VERSION,
        skipped: !!skipped,
        at: Date.now()
      }));
    } catch (e) { /* приватный режим/квота — не критично, покажем снова */ }
  }

  function trackSafe(name, payload) {
    try {
      if (window.Analytics && typeof window.Analytics.track === 'function') {
        window.Analytics.track(name, payload || {});
      }
    } catch (e) { /* аналитика опциональна */ }
  }

  /* ---------- Инъекция стилей (self-contained, без правки style.css) ---------- */
  function injectStyles() {
    if (byId('onb-style')) return;
    var css =
      '#onb-overlay{position:fixed;inset:0;z-index:600;display:none;' +
      'font-family:"Segoe UI",Verdana,system-ui,sans-serif;color:#2d3327;}' +
      '#onb-overlay.on{display:block;}' +
      /* «дыра»-подсветка: гигантская тень затемняет всё, кроме окна вокруг цели */
      '#onb-hole{position:absolute;border-radius:14px;pointer-events:none;' +
      'box-shadow:0 0 0 9999px rgba(28,33,22,0.62);' +
      'outline:3px solid #d9a521;outline-offset:3px;' +
      'transition:top .28s ease,left .28s ease,width .28s ease,height .28s ease;}' +
      '#onb-hole.no-ring{outline:none;border-radius:0;}' +
      /* карточка-подсказка */
      '#onb-card{position:absolute;max-width:min(92vw,440px);width:max-content;' +
      'background:#fffdf4;border:2px solid #7a8a5f;border-radius:18px;' +
      'box-shadow:0 12px 40px rgba(0,0,0,0.35);padding:20px 22px 18px;' +
      'box-sizing:border-box;}' +
      '#onb-card .onb-mascot{font-size:40px;line-height:1;margin-bottom:6px;}' +
      '#onb-card h2{margin:0 0 8px;font-size:23px;font-weight:700;color:#2d3327;}' +
      '#onb-card p{margin:0 0 16px;font-size:19px;line-height:1.45;color:#3a4033;}' +
      '#onb-dots{display:flex;gap:8px;margin:0 0 14px;}' +
      '#onb-dots i{width:11px;height:11px;border-radius:50%;background:#cdd6b6;' +
      'display:inline-block;transition:background .2s;}' +
      '#onb-dots i.cur{background:#5f9e3e;}' +
      '#onb-actions{display:flex;flex-direction:column;gap:10px;}' +
      '.onb-btn{font-family:inherit;font-size:20px;font-weight:700;' +
      'min-height:56px;padding:12px 22px;border-radius:14px;cursor:pointer;' +
      'border:2px solid transparent;width:100%;}' +
      '.onb-next{background:linear-gradient(180deg,#8fbf6b,#5f9e3e);color:#fff;' +
      'border-color:#4c7336;}' +
      '.onb-next:hover{filter:brightness(1.06);}' +
      '.onb-skip{background:#fffdf4;color:#5a6048;border-color:#b9c49f;' +
      'font-weight:600;font-size:17px;min-height:48px;}' +
      '.onb-skip:hover{background:#f3edd4;}' +
      '#onb-card .onb-step-label{font-size:15px;color:#8a9072;margin-bottom:2px;}' +
      '@media (max-width:520px){#onb-card{max-width:94vw;padding:18px 18px 16px;}' +
      '#onb-card h2{font-size:21px;}#onb-card p{font-size:18px;}}';
    var st = document.createElement('style');
    st.id = 'onb-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------- Построение DOM оверлея ---------- */
  function buildDom() {
    if (byId('onb-overlay')) return;
    var ov = document.createElement('div');
    ov.id = 'onb-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Обучение Orchard Peaks');

    var hole = document.createElement('div');
    hole.id = 'onb-hole';

    var card = document.createElement('div');
    card.id = 'onb-card';
    card.innerHTML =
      '<div class="onb-step-label" id="onb-step-label"></div>' +
      '<div class="onb-mascot" id="onb-mascot" aria-hidden="true"></div>' +
      '<h2 id="onb-title"></h2>' +
      '<p id="onb-body"></p>' +
      '<div id="onb-dots" aria-hidden="true"></div>' +
      '<div id="onb-actions">' +
      '<button type="button" class="onb-btn onb-next" id="onb-next"></button>' +
      '<button type="button" class="onb-btn onb-skip" id="onb-skip">Пропустить обучение</button>' +
      '</div>';

    ov.appendChild(hole);
    ov.appendChild(card);
    document.body.appendChild(ov);

    byId('onb-next').addEventListener('click', onNext);
    byId('onb-skip').addEventListener('click', onSkip);
    ov.addEventListener('keydown', onKey);
    // клик по затемнению НЕ закрывает (спокойный ведомый темп; выход — явной кнопкой)
  }

  /* ---------- Позиционирование подсветки и карточки ---------- */
  function layout() {
    var step = STEPS[idx];
    var hole = byId('onb-hole');
    var card = byId('onb-card');
    if (!hole || !card) return;

    var vw = window.innerWidth, vh = window.innerHeight;
    var target = null;
    try { target = step.target ? step.target() : null; } catch (e) { target = null; }
    var rect = null;
    if (target && target.getBoundingClientRect) {
      var r = target.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh) rect = r;
    }

    var pad = 8;
    if (rect) {
      hole.classList.remove('no-ring');
      hole.style.top = (rect.top - pad) + 'px';
      hole.style.left = (rect.left - pad) + 'px';
      hole.style.width = (rect.width + pad * 2) + 'px';
      hole.style.height = (rect.height + pad * 2) + 'px';
    } else {
      // без цели: 0-размерная дыра по центру → ровное затемнение всего экрана
      hole.classList.add('no-ring');
      hole.style.top = (vh / 2) + 'px';
      hole.style.left = (vw / 2) + 'px';
      hole.style.width = '0px';
      hole.style.height = '0px';
    }

    // карточку измеряем после наполнения текстом (см. showStep) — здесь позиционируем
    var cw = card.offsetWidth || 380;
    var ch = card.offsetHeight || 260;
    var margin = 16;
    var left, top;

    if (rect) {
      left = clamp(rect.left + rect.width / 2 - cw / 2, margin, vw - cw - margin);
      var below = rect.bottom + margin;
      var above = rect.top - ch - margin;
      if (below + ch <= vh - margin) {
        top = below;                        // под целью
      } else if (above >= margin) {
        top = above;                        // над целью
      } else {
        top = clamp(vh / 2 - ch / 2, margin, vh - ch - margin); // не влезло — по центру
      }
    } else {
      left = clamp(vw / 2 - cw / 2, margin, vw - cw - margin);
      top = clamp(vh / 2 - ch / 2, margin, vh - ch - margin);
    }
    card.style.left = Math.round(left) + 'px';
    card.style.top = Math.round(top) + 'px';
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ---------- Отрисовка шага ---------- */
  function showStep() {
    var step = STEPS[idx];
    byId('onb-step-label').textContent = 'Шаг ' + (idx + 1) + ' из ' + STEPS.length;
    byId('onb-mascot').textContent = step.mascot;
    byId('onb-title').textContent = step.title;
    byId('onb-body').textContent = step.body;
    byId('onb-next').textContent = step.cta || 'Далее';

    var dots = byId('onb-dots');
    dots.innerHTML = '';
    for (var i = 0; i < STEPS.length; i++) {
      var d = document.createElement('i');
      if (i === idx) d.className = 'cur';
      dots.appendChild(d);
    }

    // дважды: первый проход даёт корректные offsetWidth/Height карточки
    layout();
    requestAnimationFrame(layout);

    trackSafe('ftue_step', { step: idx + 1, total: STEPS.length, id: 'onb_' + (idx + 1) });
    var nextBtn = byId('onb-next');
    if (nextBtn && nextBtn.focus) { try { nextBtn.focus(); } catch (e) {} }
  }

  /* ---------- Обработчики ---------- */
  function onNext() {
    if (idx >= STEPS.length - 1) { finish(false); return; }
    idx++;
    showStep();
  }

  function onSkip() { finish(true); }

  function onKey(e) {
    if (!active) return;
    if (e.key === 'Escape') { e.preventDefault(); finish(true); }
    else if (e.key === 'Enter') { e.preventDefault(); onNext(); }
  }

  /* ---------- Старт / завершение ---------- */
  function start(isReplay) {
    if (active) return;
    injectStyles();
    buildDom();
    idx = 0;
    active = true;
    var ov = byId('onb-overlay');
    ov.classList.add('on');
    document.body.classList.add('onb-active');

    repositionBound = function () { if (active) layout(); };
    window.addEventListener('resize', repositionBound);
    window.addEventListener('scroll', repositionBound, true);

    showStep();
    trackSafe('ftue_start', { replay: !!isReplay, version: VERSION });
    if (ov.focus) { try { ov.setAttribute('tabindex', '-1'); ov.focus(); } catch (e) {} }
  }

  function finish(skipped) {
    if (!active) return;
    active = false;
    markDone(skipped);
    var ov = byId('onb-overlay');
    if (ov) ov.classList.remove('on');
    document.body.classList.remove('onb-active');
    if (repositionBound) {
      window.removeEventListener('resize', repositionBound);
      window.removeEventListener('scroll', repositionBound, true);
      repositionBound = null;
    }
    trackSafe('ftue_finish', { skipped: !!skipped, last_step: idx + 1 });
  }

  /* ---------- Кнопка «пройти обучение снова» ---------- */
  function wireReplayButton() {
    var btn = byId('btn-tutorial');
    if (!btn) return;
    btn.addEventListener('click', function () {
      // перезапуск доступен всегда, даже если онбординг уже был пройден
      if (active) return;
      start(true);
    });
  }

  /* ---------- Автозапуск на первом запуске ---------- */
  function boot() {
    wireReplayButton();
    if (!isDone()) {
      // небольшой отложенный запуск: даём ядру дорисовать HUD/раздачу и мета-инициализацию
      setTimeout(function () {
        if (!isDone() && !active) start(false);
      }, 350);
    }
  }

  /* Публичный API — программный повтор/сброс из UI или консоли. */
  window.Onboarding = {
    start: function () { start(true); },
    isDone: isDone,
    reset: function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    },
    version: VERSION
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();                                  // на случай позднего подключения
  }
})();
