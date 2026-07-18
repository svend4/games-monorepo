// WordGrove — FTUE-онбординг первого запуска (Проход Д, релизный слой).
//
// Оверлей коуч-марок по шагам FTUE главы 07 §4 («первые 5 минут»): протяжка по
// колесу → первое слово, открытие клетки сетки, бонусное слово → жёлуди, подсказка
// (Лампа), и ГДЕ живёт апселл подписки — с честной оговоркой «не в первую сессию»
// (01 §3 «честная реклама», 06 §5.1, 07 §4.2: до ур.5 ноль офферов, пейволл — день 2).
//
// РЕЛИЗНЫЙ СЛОЙ, НЕ ЛОМАЮЩИЙ ЯДРО: модуль полностью самодостаточен — сам вставляет
// свой <style>, свою кнопку «❔ пройти обучение снова» в HUD, свой оверлей. Не трогает
// ядро/мету/монетизацию/экономику и их сейвы; читает только свой ключ localStorage
// (`wordgrove.onboarding.v1`, тот же префикс `wordgrove.`). Отсутствие ключа = первый
// запуск = показать (СОВМЕСТИМО со старыми сейвами Прохода А/Б/В/Г: у них ключа нет).
//
// Подключается в index.html ПОСЛЕДНИМ (после game.js): к моменту его исполнения DOM,
// ядро и HUD уже построены, цели коуч-марок (#wheel-area, #grid-area, #hud-acorns,
// #btn-hint, #btn-shop) существуют. Никаких сборщиков и CDN. Русский UI.

(function () {
  'use strict';

  var OB = {
    FLAG_KEY: 'wordgrove.onboarding.v1', // префикс игры; отсутствие = показать
    SHOW_DELAY_MS: 500,                  // дать лэйауту устаканиться после старта ядра
    ACCENT: '#ffd54f'
  };

  // ---------------------------------------------------------------------------
  // Шаги FTUE (07 §4). Порядок и содержание — «первые 5 минут»: приветствие →
  // 5 обучающих шагов (колесо/сетка/жёлуди/подсказка/подписка) → старт.
  // target: id элемента-цели для подсветки (null = центрированный шаг без цели).
  // ---------------------------------------------------------------------------
  var STEPS = [
    {
      target: null,
      title: 'Добро пожаловать в WordGrove 🌿',
      body: 'Релакс-кроссворд: складывай слова из букв по кругу и заполняй сетку. ' +
            'Пара подсказок за полминуты — и можно спокойно играть.'
    },
    {
      target: 'wheel-area',
      title: 'Собери первое слово',
      body: 'Зажми букву в колесе и веди пальцем по соседним — след соединит буквы, ' +
            'слово покажется над колесом. Отпусти, чтобы проверить. Провёл в центр — отмена.'
    },
    {
      target: 'grid-area',
      title: 'Заполняй кроссворд',
      body: 'Верное слово вписывается в клетки сетки. Открой все слова уровня — ' +
            'и монеты 🪙 твои. Ни таймеров, ни спешки.'
    },
    {
      target: 'hud-acorns',
      title: 'Бонусные слова не пропадают',
      body: 'Собрал слово из тех же букв, но его нет в сетке? Оно даёт жёлуди 🌰 в копилку. ' +
            'Копилку потом обменяешь на монеты — ни одно слово не впустую.'
    },
    {
      target: 'btn-hint',
      title: 'Застрял — зажги Лампу',
      body: 'Лампа 💡 откроет одну случайную букву за монеты. Позже её можно будет получать ' +
            'бесплатно за короткое видео — по желанию, без давления.'
    },
    {
      target: 'btn-shop',
      title: 'WordGrove Club — когда сам захочешь',
      body: 'Здесь живёт клуб: премиум-кроссворд дня и игра без рекламы. ' +
            'Сейчас ничего не навязываем — осваивайся спокойно, предложение подождёт.'
    },
    {
      target: null,
      title: 'Готово 🎉',
      body: 'Собери первое слово из букв колеса. Обучение всегда можно повторить ' +
            'кнопкой ❔ вверху экрана.'
    }
  ];

  // ---------------------------------------------------------------------------
  // Персист флага (свой ключ, свой try/catch — не зависит от чужих модулей).
  // ---------------------------------------------------------------------------
  function isDone() {
    try {
      var raw = localStorage.getItem(OB.FLAG_KEY);
      if (!raw) return false;
      var o = JSON.parse(raw);
      return !!(o && o.done);
    } catch (e) { return false; }
  }
  function markDone() {
    try {
      localStorage.setItem(OB.FLAG_KEY, JSON.stringify({ done: true, v: 1, ts: Date.now() }));
    } catch (e) { /* приватный режим / переполнение — молча, онбординг не критичен */ }
  }

  // Лёгкий трекинг ftue_step (09 §2) — заглушка в консоль, если Economy доступен.
  function track(stepIdx) {
    if (window.Economy && typeof window.Economy.track === 'function') {
      var s = STEPS[stepIdx];
      window.Economy.track('ftue_step', { step: stepIdx + 1, of: STEPS.length, id: (s && s.target) || 'intro' });
    }
  }

  // ---------------------------------------------------------------------------
  // Стили модуля (инъекция — слой самодостаточен, style.css не трогаем).
  // ---------------------------------------------------------------------------
  function injectStyle() {
    if (document.getElementById('wg-ob-style')) return;
    var css =
      '#wg-ob{position:fixed;inset:0;z-index:9999;pointer-events:auto;' +
      'font-family:"Segoe UI",system-ui,-apple-system,Roboto,sans-serif;}' +
      '#wg-ob.wg-ob-hidden{display:none;}' +
      '.wg-ob-scrim{position:absolute;inset:0;background:rgba(15,40,18,0.62);pointer-events:none;}' +
      '.wg-ob-ring{position:absolute;border:3px solid ' + OB.ACCENT + ';border-radius:14px;' +
      'box-shadow:0 0 0 100vmax rgba(15,40,18,0.62),0 0 18px rgba(255,213,79,0.75);' +
      'pointer-events:none;transition:left .25s ease,top .25s ease,width .25s ease,height .25s ease;}' +
      '.wg-ob-card{position:absolute;left:50%;transform:translateX(-50%);width:min(340px,90vw);' +
      'background:#fff;color:#1b5e20;border-radius:18px;padding:18px 20px;' +
      'box-shadow:0 12px 40px rgba(0,0,0,0.35);pointer-events:auto;animation:wg-ob-pop .22s ease-out;}' +
      '@keyframes wg-ob-pop{from{transform:translateX(-50%) scale(.9);opacity:0;}' +
      'to{transform:translateX(-50%) scale(1);opacity:1;}}' +
      '.wg-ob-step{font-size:12px;font-weight:700;color:#7cb342;letter-spacing:.04em;' +
      'text-transform:uppercase;margin-bottom:6px;}' +
      '.wg-ob-title{font-size:20px;color:#2e7d32;margin:0 0 8px;line-height:1.2;}' +
      '.wg-ob-body{font-size:15px;line-height:1.45;color:#33691e;margin:0 0 14px;}' +
      '.wg-ob-actions{display:flex;align-items:center;gap:8px;}' +
      '.wg-ob-spacer{flex:1 1 auto;}' +
      '.wg-ob-actions button{border:none;border-radius:22px;font-weight:700;cursor:pointer;font-family:inherit;}' +
      '.wg-ob-next{background:#43a047;color:#fff;padding:10px 22px;font-size:15px;box-shadow:0 4px 0 #2e7d32;}' +
      '.wg-ob-next:active{transform:translateY(2px);box-shadow:0 2px 0 #2e7d32;}' +
      '.wg-ob-back{background:#eee;color:#455a64;padding:9px 16px;font-size:14px;}' +
      '.wg-ob-skip{background:transparent;color:#78909c;padding:8px 4px;font-size:13px;text-decoration:underline;}' +
      '.wg-ob-progress{display:flex;gap:5px;margin-top:14px;justify-content:center;}' +
      '.wg-ob-dot{width:7px;height:7px;border-radius:50%;background:#c8e6c9;transition:background .2s;}' +
      '.wg-ob-dot.on{background:#43a047;}' +
      '#btn-help{width:34px;height:34px;border:none;border-radius:50%;background:rgba(255,255,255,0.65);' +
      'color:#1b5e20;font-size:16px;font-weight:700;cursor:pointer;flex:0 0 auto;}' +
      '#btn-help:hover{background:#fff;}';
    var st = document.createElement('style');
    st.id = 'wg-ob-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ---------------------------------------------------------------------------
  // Кнопка «пройти обучение снова» в HUD (релейбл + запуск тура).
  // ---------------------------------------------------------------------------
  function injectHelpButton() {
    if (document.getElementById('btn-help')) return;
    var host = document.getElementById('hud-right');
    if (!host) return;
    var btn = document.createElement('button');
    btn.id = 'btn-help';
    btn.type = 'button';
    btn.title = 'Пройти обучение снова';
    btn.textContent = '❔';
    btn.addEventListener('click', function () { start(true); });
    host.appendChild(btn);
  }

  // ---------------------------------------------------------------------------
  // Оверлей (строится один раз, дальше показ/скрытие).
  // ---------------------------------------------------------------------------
  var els = null;
  var idx = 0;
  var active = false;

  function buildOverlay() {
    if (els) return;
    var root = document.createElement('div');
    root.id = 'wg-ob';
    root.className = 'wg-ob-hidden';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Обучение WordGrove');

    var scrim = document.createElement('div');
    scrim.className = 'wg-ob-scrim';

    var ring = document.createElement('div');
    ring.className = 'wg-ob-ring';
    ring.style.display = 'none';

    var card = document.createElement('div');
    card.className = 'wg-ob-card';

    var stepEl = document.createElement('div');
    stepEl.className = 'wg-ob-step';
    var titleEl = document.createElement('h3');
    titleEl.className = 'wg-ob-title';
    var bodyEl = document.createElement('p');
    bodyEl.className = 'wg-ob-body';

    var actions = document.createElement('div');
    actions.className = 'wg-ob-actions';
    var skipBtn = document.createElement('button');
    skipBtn.className = 'wg-ob-skip';
    skipBtn.type = 'button';
    skipBtn.textContent = 'Пропустить';
    var spacer = document.createElement('span');
    spacer.className = 'wg-ob-spacer';
    var backBtn = document.createElement('button');
    backBtn.className = 'wg-ob-back';
    backBtn.type = 'button';
    backBtn.textContent = 'Назад';
    var nextBtn = document.createElement('button');
    nextBtn.className = 'wg-ob-next';
    nextBtn.type = 'button';
    nextBtn.textContent = 'Дальше';
    actions.appendChild(skipBtn);
    actions.appendChild(spacer);
    actions.appendChild(backBtn);
    actions.appendChild(nextBtn);

    var progress = document.createElement('div');
    progress.className = 'wg-ob-progress';
    var dots = [];
    for (var i = 0; i < STEPS.length; i++) {
      var d = document.createElement('span');
      d.className = 'wg-ob-dot';
      progress.appendChild(d);
      dots.push(d);
    }

    card.appendChild(stepEl);
    card.appendChild(titleEl);
    card.appendChild(bodyEl);
    card.appendChild(actions);
    card.appendChild(progress);
    root.appendChild(scrim);
    root.appendChild(ring);
    root.appendChild(card);
    document.body.appendChild(root);

    skipBtn.addEventListener('click', finish);
    backBtn.addEventListener('click', function () { go(idx - 1); });
    nextBtn.addEventListener('click', function () {
      if (idx >= STEPS.length - 1) finish();
      else go(idx + 1);
    });

    els = {
      root: root, scrim: scrim, ring: ring, card: card,
      step: stepEl, title: titleEl, body: bodyEl,
      skip: skipBtn, back: backBtn, next: nextBtn, dots: dots
    };
  }

  // Позиционирование подсветки + карточки под текущий шаг.
  function positionStep() {
    if (!els) return;
    var step = STEPS[idx];
    var target = step.target ? document.getElementById(step.target) : null;
    var rect = target ? target.getBoundingClientRect() : null;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var pad = 8;

    els.card.style.display = 'block';

    if (rect && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < vh) {
      els.ring.style.display = 'block';
      els.scrim.style.display = 'none';
      els.ring.style.left = (rect.left - pad) + 'px';
      els.ring.style.top = (rect.top - pad) + 'px';
      els.ring.style.width = (rect.width + pad * 2) + 'px';
      els.ring.style.height = (rect.height + pad * 2) + 'px';

      var ch = els.card.offsetHeight;
      var below = (rect.top + rect.height / 2) < vh * 0.5;
      var top = below ? (rect.bottom + pad + 14) : (rect.top - pad - 14 - ch);
      top = Math.max(10, Math.min(top, vh - ch - 10));
      els.card.style.top = top + 'px';
    } else {
      // центрированный шаг (или цель вне вьюпорта) — полный дим, карточка по центру
      els.ring.style.display = 'none';
      els.scrim.style.display = 'block';
      var ch2 = els.card.offsetHeight;
      els.card.style.top = Math.max(10, (vh - ch2) / 2) + 'px';
    }
  }

  function render() {
    var step = STEPS[idx];
    els.step.textContent = 'Шаг ' + (idx + 1) + ' из ' + STEPS.length;
    els.title.innerHTML = step.title;
    els.body.innerHTML = step.body;
    els.back.style.visibility = (idx === 0) ? 'hidden' : 'visible';
    var last = (idx === STEPS.length - 1);
    els.next.textContent = last ? 'Начать игру' : 'Дальше';
    els.skip.style.display = last ? 'none' : '';
    for (var i = 0; i < els.dots.length; i++) {
      els.dots[i].className = 'wg-ob-dot' + (i === idx ? ' on' : '');
    }
    positionStep();
    try { els.next.focus(); } catch (e) {}
    track(idx);
  }

  function go(i) {
    if (i < 0) i = 0;
    if (i > STEPS.length - 1) i = STEPS.length - 1;
    idx = i;
    render();
  }

  function onResize() { if (active) positionStep(); }
  function onKey(e) {
    if (!active) return;
    if (e.key === 'Escape') { finish(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      if (idx >= STEPS.length - 1) finish(); else go(idx + 1);
    } else if (e.key === 'ArrowLeft') { go(idx - 1); }
  }

  function start(force) {
    if (active) return;
    if (!force && isDone()) return;
    buildOverlay();
    if (!els) return;
    idx = 0;
    active = true;
    els.root.classList.remove('wg-ob-hidden');
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    document.addEventListener('keydown', onKey);
    // дать карточке отрисоваться, затем позиционировать по актуальным rect
    render();
    requestAnimationFrame(positionStep);
  }

  function finish() {
    active = false;
    markDone();
    if (els) els.root.classList.add('wg-ob-hidden');
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    document.removeEventListener('keydown', onKey);
  }

  // Публичный мост (для отладки / внешнего запуска), не обязателен ядру.
  window.WGOnboarding = {
    start: function () { start(true); },
    isDone: isDone,
    reset: function () {
      try { localStorage.removeItem(OB.FLAG_KEY); } catch (e) {}
    }
  };

  // ---------------------------------------------------------------------------
  // Инициализация.
  // ---------------------------------------------------------------------------
  function init() {
    injectStyle();
    injectHelpButton();
    if (!isDone()) {
      setTimeout(function () { start(false); }, OB.SHOW_DELAY_MS);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
