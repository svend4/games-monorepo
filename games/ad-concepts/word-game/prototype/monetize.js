/* =============================================================================
 * WordGrove — слой МОНЕТИЗАЦИИ (Проход В): реклама-заглушки + IAP + подписка
 * -----------------------------------------------------------------------------
 * ⚠️  ВСЁ ЗДЕСЬ — СИМУЛЯЦИЯ. НИКАКИХ реальных рекламных SDK, сетей и платежей.
 *     «Показ рекламы» = экранный оверлей-заглушка с отсчётом 3–5 сек (в проде тут
 *     AppLovin MAX / AdMob — 06 §6, §8). «Покупка»/«подписка» = мгновенная выдача
 *     товара без денег и платёжных провайдеров (в проде — App Store / Play Billing).
 *     На всех экранах стоит слово «СИМУЛЯЦИЯ». Каждый смоделированный показ/покупка
 *     генерирует выручку по eCPM/прайсу из главы 06 (случайная величина вокруг
 *     бенчмарка с учётом гео) и логируется в дашборд (analytics.js).
 * -----------------------------------------------------------------------------
 * Реализует 06-monetization.md: §3 (карта плейсментов RV/INT/BAN), §4 (правила капа
 * interstitial), §5 (платная полка — подписка WordGrove Club как главный продукт,
 * Remove Ads, полка монет), §7 (гео-стратегия), §8 (eCPM-матрица, гео-переключатель).
 *
 * Поверх готовых Проходов А+Б: ядро (game.js) и мету (meta.js) НЕ переписывает —
 * только ДОБАВЛЯЕТ монетизацию. Интеграция — без правки логики ядра/меты:
 *   • монеты   — через мост window.WG (game.js): addCoins / getCoins / getLevel …;
 *   • копилка  — через window.Economy (economy.js);
 *   • трекинг  — через window.Economy.track (снейк-кейс событий, 09 §1);
 *   • переходы — перехват кликов «Дальше ▶» (interstitial) и «Открыть копилку»
 *                (rewarded RV-5) в capture-фазе + повторная отправка клика с флагом
 *                bypass, чтобы штатный обработчик ядра/меты отработал после ролика;
 *   • RV-2 «×2 монеты» — инъекция кнопки в оверлей победы через MutationObserver;
 *   • RV-1 «Бесплатная Лампа» и клубный «безлимит подсказок» — через добавочный хук
 *     window.WG.revealFreeLetter() (открывает букву без списания монет).
 *
 * Подключается в index.html ПОСЛЕ economy.js и ПЕРЕД meta.js/game.js.
 *
 * СОВМЕСТИМОСТЬ САВОВ: состояние монетизации живёт в ОТДЕЛЬНОМ ключе
 * 'wordgrove.monetize.v1' (тот же префикс игры). Сейвы Прохода А ('wordgrove.save.v1'),
 * экономики ('wordgrove.economy.v1') и меты ('wordgrove.meta.v1') не трогает. Нет
 * ключа/полей → дефолты (sanitize ниже), старые сейвы игру не ломают.
 * ========================================================================== */
'use strict';

/* ============================ КОНФИГ МОНЕТИЗАЦИИ ==========================
 * Числа — из главы 06. Менять только синхронно со спекой (в проде — remote config). */

var WGMON = {
  STORAGE_KEY: 'wordgrove.monetize.v1',

  /* --- eCPM-матрица (06 §8.1), $ за 1000 показов ---
   * tier1 — Tier-1 (US/UK/CA/AU): blended rewarded US ≈ $17,8 (06 §8.1), interstitial
   *   blended US ≈ $14, banner US Android ≈ $0,55.
   * tier23 — Tier-2/3 (модель 06 §8.1): RW $6, INT $4, BAN $0,15.
   * blend — бленд 60% T1 / 40% T2-3 (06 §8.2), к которому привязаны цели 09:
   *   RW 0,6·17,8+0,4·6 ≈ $13; INT 0,6·14+0,4·4 ≈ $10; BAN 0,6·0,55+0,4·0,15 ≈ $0,40. */
  ECPM: {
    rw:     { tier1: 17.80, blend: 13.00, tier23: 6.00 },
    int:    { tier1: 14.00, blend: 10.00, tier23: 4.00 },
    banner: { tier1: 0.55,  blend: 0.40,  tier23: 0.15 }
  },
  ECPM_JITTER: 0.25,               // ±25% случайный разброс выручки вокруг бенчмарка

  GEO_LABELS: { tier1: 'Tier-1 (US/UK/CA/AU)', blend: 'Бленд 60/40', tier23: 'Tier-2/3' },
  GEO_ORDER: ['tier1', 'blend', 'tier23'],
  DEFAULT_GEO: 'blend',            // бленд — чтобы KPI сходились с целями 09 (blended)

  /* --- Правила interstitial I-1 (06 §4), зашиты кодом ---
   * Прототипные величины ниже проды (быстрее тестировать); прод-значения в примечаниях. */
  INT: {
    MIN_LEVEL_INDEX: 2,            // не раньше 3-го уровня (прод: индекс 5 = уровень 6, 06 §4 п.2)
    MIN_INTERVAL_MS: 45000,        // ≥45 сек между показами (прод: 180 сек T1 / 120 T2-3, 06 §4 п.3)
    AFTER_RW_MS: 30000,            // не в течение 30 сек после rewarded (06 §4 п.4)
    SESSION_CAP: 12,               // дневной кап 12 — жёсткий (06 §4 п.10)
    SECONDS: 4,                    // длительность симуляции показа
    SKIP_AFTER: 2                  // кнопка «Пропустить» появляется через N сек
  },

  /* --- Rewarded (06 §3.1) --- */
  RW: {
    SECONDS: 5,                    // rewarded video 15–30 сек → в прототипе 5 сек
    RV1_DAILY_CAP: 4,              // «Бесплатная Лампа»: 1/уровень, ≤4/день (RV-1)
    RV6_DAILY_CAP: 1              // «Заморозка стрика»: серия ≤1/нед — в прототипе 1/день (RV-6)
  },

  BANNER: {
    REFRESH_MS: 45000,             // adaptive banner refresh 45 сек (06 §3.3)
    MIN_LEVEL_INDEX: 1             // B-1 с уровня 2 (прод: с уровня 11 в T1 / 6 в T2-3, 06 §3.3/§7)
  },

  /* --- Подписка WordGrove Club (06 §5.1) — ГЛАВНЫЙ платный продукт --- */
  SUB: {
    monthly: { id: 'sub_month', price: 8.99,  days: 30,  label: 'Месяц' },
    yearly:  { id: 'sub_year',  price: 49.99, days: 365, label: 'Год (−54%)' },
    trialDays: 7,                  // 7 дней бесплатного триала
    storeCut: 0.30,               // −30% стора (net; 06 §5.1)
    coinBonusPct: 0.20,           // +20% монет со всех наград (06 §5.1, перк 5)
    perks: [
      'Ноль interstitial и баннеров',
      'Ежедневный премиум-кроссворд 9×9 с темой',
      'Безлимит Ламп (подсказки бесплатно)',
      'Автооткрытие копилки жёлудей',
      '+20% монет со всех наград',
      'Авто-заморозка стрика · архив daily 7 дней'
    ]
  },

  /* --- Remove Ads (06 §5.2) — разовая --- */
  REMOVE_ADS: { id: 'remove_ads', price: 9.99 },

  /* --- Полка монет (06 §5.3). price — локализованная tier-цена стора ($US).
   * В прототипе бустеры/темы/открытки — косметические флаги (у economy.js нет
   * инвентаря бустеров), но КОЛИЧЕСТВО МОНЕТ выдаётся реально через window.WG. --- */
  IAP: [
    { id: 'coins_handful', price: 0.99,  title: 'Горсть монет', coins: 600,
      desc: '600 🪙 · импульсная первая покупка', badge: 'СТАРТ' },
    { id: 'coins_starter', price: 2.99,  title: 'Стартовый набор', coins: 1800, once: true,
      desc: '1800 🪙 + 3 Лампы + 2 Прицела + бейдж · 1 раз', badge: 'ЛУЧШИЙ СТАРТ', cosmetic: { badge: true } },
    { id: 'coins_pouch',   price: 4.99,  title: 'Кошель', coins: 3500,
      desc: '3500 🪙 · стандарт' },
    { id: 'coins_chest',   price: 9.99,  title: 'Сундук', coins: 8000,
      desc: '8000 🪙 + 5 Ракет · основной объём', highlight: true },
    { id: 'coins_chest_t', price: 19.99, title: 'Сундук + тема', coins: 18000,
      desc: '18 000 🪙 + 12 Ракет + тема оформления', cosmetic: { skin: 'chest_theme' } },
    { id: 'coins_region',  price: 49.99, title: 'Ларец региона', coins: 50000,
      desc: '50 000 🪙 + 30 Ракет + эксклюзивная открытка', cosmetic: { skin: 'region_card' } },
    { id: 'coins_master',  price: 99.99, title: 'Мешок мастера', coins: 120000,
      desc: '120 000 🪙 + все бустеры ×20 + рамка профиля', badge: 'ЯКОРЬ', cosmetic: { frame: true } }
  ],

  /* --- Цели KPI (09 §3, 06 §8) для сравнения в дашборде --- */
  TARGETS: {
    intPerDau: 3.2, rwPerDau: 1.5, bannerPerDau: 9.0,       // показы/DAU (09 §3)
    adArpdau: 0.055, subArpdau: 0.019, iapArpdau: 0.011,    // ARPDAU-компоненты (06 §8.3)
    blendedArpdau: 0.085,
    ecpm: { rw: 17.80, int: 14.00, banner: 0.55 },          // eCPM US (06 §8.1)
    revSplit: { ad: 65, sub: 22, iap: 13 }                  // целевой сплит выручки (06 §1, §8.3)
  }
};

/* ============================== ХРАНИЛИЩЕ ================================= */

window.WGMonStore = (function () {

  function defaults() {
    return {
      v: 1,
      removeAds: false,
      subscription: { active: false, plan: '', trial: false, since: '', lastDaily: '' },
      geoTier: WGMON.DEFAULT_GEO,
      freezeTokens: 0,
      skins: [],
      frame: false,
      badge: false,
      starterBought: false,
      day: { date: '', int: 0, rv1: 0, rv6: 0 },
      lifetime: { adRev: 0, iapRev: 0, subRev: 0, imp: { int: 0, rw: 0, banner: 0 }, iapCount: 0 }
    };
  }

  function num(v, def, min) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) n = def;
    if (min !== undefined && n < min) n = min;
    return n;
  }
  function intv(v, def, min) { return Math.floor(num(v, def, min)); }
  function strv(v) { return typeof v === 'string' ? v : ''; }
  function boolv(v) { return !!v; }

  /* Санитизация: валидный, но повреждённый JSON не должен дать NaN/Infinity в
   * выручке дашборда или сломать счётчики/капы. */
  function sanitize(s) {
    var d = defaults();
    if (!s || typeof s !== 'object') return d;
    var sub = (s.subscription && typeof s.subscription === 'object') ? s.subscription : {};
    var day = (s.day && typeof s.day === 'object') ? s.day : {};
    var lt = (s.lifetime && typeof s.lifetime === 'object') ? s.lifetime : {};
    var imp = (lt.imp && typeof lt.imp === 'object') ? lt.imp : {};
    var geo = strv(s.geoTier);
    if (WGMON.GEO_ORDER.indexOf(geo) === -1) geo = WGMON.DEFAULT_GEO;
    return {
      v: intv(s.v, 1, 1),
      removeAds: boolv(s.removeAds),
      subscription: {
        active: boolv(sub.active), plan: strv(sub.plan), trial: boolv(sub.trial),
        since: strv(sub.since), lastDaily: strv(sub.lastDaily)
      },
      geoTier: geo,
      freezeTokens: intv(s.freezeTokens, 0, 0),
      skins: Array.isArray(s.skins) ? s.skins : [],
      frame: boolv(s.frame),
      badge: boolv(s.badge),
      starterBought: boolv(s.starterBought),
      day: { date: strv(day.date), int: intv(day.int, 0, 0), rv1: intv(day.rv1, 0, 0), rv6: intv(day.rv6, 0, 0) },
      lifetime: {
        adRev: num(lt.adRev, 0, 0), iapRev: num(lt.iapRev, 0, 0), subRev: num(lt.subRev, 0, 0),
        imp: { int: intv(imp.int, 0, 0), rw: intv(imp.rw, 0, 0), banner: intv(imp.banner, 0, 0) },
        iapCount: intv(lt.iapCount, 0, 0)
      }
    };
  }

  var state = defaults();
  try {
    var raw = localStorage.getItem(WGMON.STORAGE_KEY);
    if (raw) state = sanitize(JSON.parse(raw));
  } catch (e) { state = defaults(); }

  function save() {
    try { localStorage.setItem(WGMON.STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* приватный режим / квота — игра продолжается */ }
  }

  return { state: state, save: save, reset: function () { state = defaults(); save(); return state; } };
})();

/* ============================== МОНЕТИЗАЦИЯ ============================== */

window.Monetize = (function () {

  var S = window.WGMonStore.state;

  /* Счётчики ТЕКУЩЕЙ СЕССИИ (сброс при перезагрузке) — основа дашборда 09:
   * сессия трактуется как «этот игрок = 1 симулированный DAU за день». */
  function freshSession() {
    return {
      startedAt: Date.now(),
      imp: { int: 0, rw: 0, banner: 0 },
      revByFormat: { int: 0, rw: 0, banner: 0 },
      adRev: 0, iapRev: 0, subRev: 0, iapCount: 0,
      offers: { shown: 0, accepted: 0 },
      intCapped: 0, lastCapRule: ''
    };
  }
  var session = freshSession();

  var sessionStart = Date.now();
  var lastInterstitialMs = 0;
  var lastRewardedMs = 0;

  /* Пер-оверлейные/пер-уровневые флаги rewarded. */
  var rv1LastKey = '';           // ключ уровня, на котором использовали RV-1 (1/уровень)
  var bypassClick = false;       // пропуск перехвата при повторной отправке клика

  /* --------------------------- Утилиты --------------------------- */

  function el(id) { return document.getElementById(id); }
  function setText(id, t) { var e = el(id); if (e) e.textContent = t; }
  function track(ev, p) {
    try { if (window.Economy && window.Economy.track) window.Economy.track(ev, p || {}); }
    catch (e) { /* no-op */ }
  }
  function toast(msg) {
    if (window.WG && window.WG.toast) { window.WG.toast(msg); return; }
    var t = el('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 1900);
  }
  function nowMs() { return Date.now(); }

  function p2(n) { return n < 10 ? '0' + n : '' + n; }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }
  function ensureDay() {
    var t = todayStr();
    if (S.day.date !== t) {
      S.day = { date: t, int: 0, rv1: 0, rv6: 0 };
      window.WGMonStore.save();
    }
  }

  function coreLevel() {
    try { return (window.WG && window.WG.getLevel) ? window.WG.getLevel() : 0; } catch (e) { return 0; }
  }
  function isDaily() {
    try { return !!(window.WG && window.WG.isDailyMode && window.WG.isDailyMode()); } catch (e) { return false; }
  }
  function levelKey() { return isDaily() ? ('daily:' + todayStr()) : ('c' + coreLevel()); }

  function geoLabel() { return WGMON.GEO_LABELS[S.geoTier] || S.geoTier; }
  function ecpmFor(fmt) {
    var rowByFmt = WGMON.ECPM[fmt] || {};
    return rowByFmt[S.geoTier] !== undefined ? rowByFmt[S.geoTier] : (rowByFmt.blend || 0);
  }
  function genRevenue(fmt) {
    var base = ecpmFor(fmt);
    var j = 1 + (Math.random() * 2 - 1) * WGMON.ECPM_JITTER;   // ±jitter вокруг бенчмарка
    return base * j / 1000;
  }
  function subscribed() { return !!(S.subscription && S.subscription.active); }
  function adsRemoved() { return !!S.removeAds || subscribed(); }

  /* +20% монет со всех НАГРАД для подписчиков (06 §5.1). Применяется к монетам,
   * которые начисляет сам слой монетизации (rewarded RV-2 и т.п.), не к покупкам. */
  function rewardCoins(base) {
    return subscribed() ? Math.round(base * (1 + WGMON.SUB.coinBonusPct)) : Math.round(base);
  }
  function grantCoins(base, source) {
    var n = rewardCoins(base);
    if (window.WG && window.WG.addCoins) window.WG.addCoins(n, source);
    return n;
  }

  function refreshDash() { try { if (window.Dashboard) window.Dashboard.refresh(); } catch (e) { /* no-op */ } }

  /* --------------------------- Учёт показов --------------------------- */

  function recordImpression(fmt, placement) {
    var rev = genRevenue(fmt);
    session.imp[fmt]++;
    session.revByFormat[fmt] += rev;
    session.adRev += rev;
    S.lifetime.imp[fmt]++;
    S.lifetime.adRev += rev;
    window.WGMonStore.save();
    track('ad_revenue', { format: fmt, placement: placement, network: 'applovin_max', ecpm_cents: Math.round(ecpmFor(fmt) * 100), geo: S.geoTier });
    updateBannerEcpm();
    refreshDash();
    return rev;
  }

  /* ===================== СИМУЛЯЦИЯ ПОКАЗА (ОВЕРЛЕЙ) ===================== */
  /* Одна за раз. int — авто-закрытие/skip; rw — до конца, затем «Забрать». */

  var adTimer = null;

  function showAdSim(opts, onComplete) {
    var ov = el('adOverlay');
    if (!ov) { onComplete(); return; }
    setText('adSimFormat', opts.formatLabel);
    setText('adSimPitch', opts.pitch || 'В проде здесь крутится реальная сеть: AppLovin MAX / AdMob (06 §6, §8).');
    setText('adSimEcpm', 'eCPM (' + geoLabel() + '): $' + ecpmFor(opts.fmt).toFixed(2) + ' / 1000');
    var skip = el('adSimSkip'), claim = el('adSimClaim');
    skip.classList.add('hidden'); claim.classList.add('hidden');
    ov.classList.remove('hidden');
    updateBannerVisibility();

    var remaining = opts.seconds;
    setText('adSimTimer', remaining);
    var done = false;
    function finish() {
      if (done) return; done = true;
      if (adTimer) { clearInterval(adTimer); adTimer = null; }
      ov.classList.add('hidden');
      updateBannerVisibility();
      onComplete();
    }
    skip.onclick = function () { if (opts.kind === 'int') finish(); };
    claim.onclick = function () { if (opts.kind === 'rw') finish(); };

    if (adTimer) clearInterval(adTimer);
    adTimer = setInterval(function () {
      remaining--;
      if (remaining <= 0) {
        setText('adSimTimer', '0');
        clearInterval(adTimer); adTimer = null;
        if (opts.kind === 'int') {
          skip.textContent = 'Закрыть ✕';
          skip.classList.remove('hidden');
          setTimeout(finish, 400);            // interstitial закрывается сам
        } else {
          claim.classList.remove('hidden');   // rewarded: досмотрел → «Забрать награду»
        }
        return;
      }
      setText('adSimTimer', remaining);
      if (opts.kind === 'int' && remaining <= opts.seconds - WGMON.INT.SKIP_AFTER) {
        skip.textContent = 'Пропустить ✕';
        skip.classList.remove('hidden');
      }
    }, 1000);
  }

  /* Общий прогон rewarded-показа: оффер принят → симуляция → выдача награды. */
  function playRewarded(placement, formatLabel, pitch, onReward) {
    // «Приняли» (accepted) уже засчитано вызывающей стороной (offer*/handlePiggyClick);
    // здесь НЕ инкрементируем повторно — иначе accept rate в дашборде удваивается.
    track('ad_start', { placement: placement, network: 'applovin_max' });
    showAdSim({ kind: 'rw', fmt: 'rw', seconds: WGMON.RW.SECONDS, formatLabel: formatLabel, pitch: pitch },
      function () {
        var rev = recordImpression('rw', placement);
        lastRewardedMs = nowMs();
        track('ad_complete', { placement: placement });
        if (onReward) onReward(rev);
        refreshDash();
      });
  }

  /* ========================= INTERSTITIAL I-1 (06 §4) ===================== */

  /* Код блокирующего правила или null (можно показывать). */
  function interstitialBlockReason() {
    if (adsRemoved()) return 'remove_ads';
    if (isDaily()) return 'daily';                                  // не после дневного (06 §4 п.5)
    if (coreLevel() < WGMON.INT.MIN_LEVEL_INDEX) return 'ftue_level';
    ensureDay();
    if (S.day.int >= WGMON.INT.SESSION_CAP) return 'session_cap';
    if (nowMs() - lastInterstitialMs < WGMON.INT.MIN_INTERVAL_MS) return 'interval';
    if (nowMs() - lastRewardedMs < WGMON.INT.AFTER_RW_MS) return 'after_rw';
    return null;
  }

  /* Перехват клика «Дальше ▶» (#ov-next) на оверлее победы: если показ уместен —
   * гасим переход, крутим ролик, затем повторно кликаем кнопку (bypass) — штатный
   * nextLevel() ядра отработает сам. Иначе — не мешаем ядру. */
  function handleNextClick(e, btn) {
    var reason = interstitialBlockReason();
    if (reason === null) {
      e.preventDefault(); e.stopPropagation();
      track('ad_offer', { placement: 'I-1' });
      showAdSim({ kind: 'int', fmt: 'int', seconds: WGMON.INT.SECONDS,
        formatLabel: 'Interstitial · I-1 (между уровнями)' },
        function () {
          var rev = recordImpression('int', 'I-1');
          lastInterstitialMs = nowMs();
          ensureDay();
          S.day.int++;
          window.WGMonStore.save();
          toast('Interstitial засчитан · +$' + rev.toFixed(4));
          bypassClick = true;
          btn.click();                        // повторный клик → штатный переход ядра
          bypassClick = false;                // страховка, если click не всплыл
        });
      return;
    }
    // Диагностика недопоказа (09 §1.3 знаменатель) — только «настоящие» капы.
    if (reason !== 'ftue_level' && reason !== 'remove_ads' && reason !== 'daily') {
      session.intCapped++;
      session.lastCapRule = reason;
      track('ad_capped', { placement: 'I-1', cap_rule: reason });
      refreshDash();
    }
    // preventDefault не вызываем → клик уходит в штатный обработчик nextLevel().
  }

  /* ========================== REWARDED (06 §3.1) ====================== */

  /* --- RV-1 «Бесплатная Лампа»: открыть букву за просмотр (1/уровень, ≤4/день) --- */
  function rv1Available() {
    ensureDay();
    if (isDaily()) return S.day.rv1 < WGMON.RW.RV1_DAILY_CAP;      // в дневном кап только дневной
    return S.day.rv1 < WGMON.RW.RV1_DAILY_CAP && rv1LastKey !== levelKey();
  }
  function offerFreeLamp() {
    if (!window.WG || !window.WG.revealFreeLetter) { toast('Ядро не готово'); return; }
    ensureDay();
    if (S.day.rv1 >= WGMON.RW.RV1_DAILY_CAP) { toast('Лимит бесплатной Лампы на сегодня (' + WGMON.RW.RV1_DAILY_CAP + ')'); return; }
    if (!isDaily() && rv1LastKey === levelKey()) { toast('Бесплатная Лампа — 1 раз на уровень'); return; }
    session.offers.shown++;         // RV-1: показ = момент клика по кнопке (нет отдельной карточки-оффера)
    session.offers.accepted++;      // приём оффера (кнопку жмут добровольно)
    track('ad_offer', { placement: 'RV-1' });
    playRewarded('RV-1', 'Rewarded · RV-1 «Бесплатная Лампа»',
      'Досмотри — откроем случайную букву в сетке бесплатно.', function () {
        var ok = window.WG.revealFreeLetter();
        if (ok) {
          S.day.rv1++;
          rv1LastKey = levelKey();
          window.WGMonStore.save();
          track('hint_use', { type: 'lamp', source: 'rv' });
          toast('💡 Буква открыта за просмотр (RV-1)');
        } else {
          toast('Открывать нечего — уровень почти решён');
        }
        updateInLevelRv();
      });
  }

  /* --- RV-2 «×2 монеты за уровень» на оверлее победы (инъекция кнопки) --- */
  function offerDoubleCoins(reward, btnEl) {
    if (btnEl && btnEl.disabled) return;
    session.offers.accepted++;
    track('ad_offer', { placement: 'RV-2' });
    playRewarded('RV-2', 'Rewarded · RV-2 «×2 монеты за уровень»',
      'Досмотри — удвоим монеты, заработанные на этом уровне.', function () {
        var extra = grantCoins(reward, 'rv2');          // + ещё «reward» монет (×2), с клубным +20%
        if (btnEl) {
          btnEl.disabled = true;
          btnEl.classList.add('rv-used');
          btnEl.innerHTML = '✓ Удвоено: +' + extra + ' 🪙';
        }
        toast('💰 +' + extra + ' 🪙 (×2 монеты за уровень)');
      });
  }

  /* --- RV-6 «Продолжить серию» (заморозка стрика) в магазине --- */
  function offerFreezeStreak() {
    ensureDay();
    if (S.day.rv6 >= WGMON.RW.RV6_DAILY_CAP) { toast('Лимит «Заморозки стрика» на сегодня'); return; }
    session.offers.accepted++;
    track('ad_offer', { placement: 'RV-6' });
    playRewarded('RV-6', 'Rewarded · RV-6 «Заморозка стрика»',
      'Досмотри — заморозим стрик, чтобы продолжить серию без потерь.', function () {
        S.freezeTokens++;
        S.day.rv6++;
        window.WGMonStore.save();
        track('streak_saved', { save_source: 'rv' });
        toast('🧊 Заморозка стрика получена — серия защищена');
        renderShop();
      });
  }

  /* --- RV-5 «Открыть копилку»: перехват клика по кнопке меты (data-action=open-piggy) --- */
  function handlePiggyClick(e, elBtn) {
    if (adsRemoved()) {
      // Подписка «Автооткрытие копилки» — открываем без рекламы (06 §5.1, перк 4).
      return; // не мешаем: штатный обработчик меты откроет копилку бесплатно
    }
    var acorns = 0;
    try { acorns = window.Economy ? window.Economy.getAcorns() : 0; } catch (er) { acorns = 0; }
    if (acorns <= 0) return;        // пусто — пусть мета отработает штатно
    e.preventDefault(); e.stopPropagation();
    session.offers.shown++;         // RV-5: показ = перехват клика по копилке (нет отдельной карточки-оффера)
    session.offers.accepted++;
    track('ad_offer', { placement: 'RV-5' });
    playRewarded('RV-5', 'Rewarded · RV-5 «Открыть копилку жёлудей»',
      'Досмотри — откроем копилку и конвертируем жёлуди в монеты.', function () {
        bypassClick = true;
        elBtn.click();              // повторный клик → мета откроет копилку штатно
        bypassClick = false;        // страховка, если click не всплыл
      });
  }

  /* ============================== БАННЕР B-1 (06 §3.3) =================== */

  function anyFullscreenOpen() {
    var ids = ['overlay', 'meta-screen', 'shopScreen', 'dashboardScreen', 'adOverlay'];
    for (var i = 0; i < ids.length; i++) {
      var e = el(ids[i]);
      if (e && !e.classList.contains('hidden')) return true;
    }
    return false;
  }
  function bannerAllowed() {
    if (adsRemoved()) return false;                      // подписка/Remove Ads прячут баннер
    if (isDaily()) return false;                         // не на дневном кроссворде (06 §3.3)
    if (coreLevel() < WGMON.BANNER.MIN_LEVEL_INDEX) return false;
    if (anyFullscreenOpen()) return false;               // не под полноэкранными оверлеями
    return true;
  }
  function updateBannerVisibility() {
    var bar = el('adBanner');
    if (!bar) return;
    var appEl = el('app');
    if (bannerAllowed()) {
      bar.classList.remove('hidden');
      if (appEl) appEl.classList.add('has-banner');
    } else {
      bar.classList.add('hidden');
      if (appEl) appEl.classList.remove('has-banner');
    }
    updateBannerEcpm();
  }
  function updateBannerEcpm() {
    setText('adBannerEcpm', '$' + ecpmFor('banner').toFixed(2) + ' · ' + geoLabel());
  }
  function startBannerLoop() {
    updateBannerVisibility();
    setInterval(function () {
      updateBannerVisibility();
      if (typeof document.hidden === 'boolean' && document.hidden) return;
      if (!bannerAllowed()) return;                      // не считаем показ, когда баннер скрыт
      recordImpression('banner', 'B-1');                 // авто-рефреш = 1 показ
    }, WGMON.BANNER.REFRESH_MS);
  }

  /* ============================== ПОДПИСКА / IAP (06 §5) ================= */

  function findSku(id) {
    for (var i = 0; i < WGMON.IAP.length; i++) if (WGMON.IAP[i].id === id) return WGMON.IAP[i];
    return null;
  }

  /* Подписка WordGrove Club (06 §5.1). trial=true — 7 дней бесплатно (выручка 0 до
   * конверсии); иначе сразу платная. Net-выручку списываем амортизированно за день
   * («ценность одного дня подписчика»), чтобы дашборд не искажался ламповой суммой. */
  function subscribe(plan, asTrial) {
    var p = plan === 'yearly' ? WGMON.SUB.yearly : WGMON.SUB.monthly;
    S.subscription.active = true;
    S.subscription.plan = plan;
    S.subscription.trial = !!asTrial;
    if (!S.subscription.since) S.subscription.since = todayStr();
    window.WGMonStore.save();
    if (asTrial) {
      track('trial_start', { plan: plan, price_tier: p.price });
      toast('СИМУЛЯЦИЯ: WordGrove Club — триал 7 дней активен');
    } else {
      track('sub_convert', { plan: plan, price_tier: p.price });
      bookSubDay(p);
      toast('СИМУЛЯЦИЯ: подписка WordGrove Club оформлена (' + p.label + ')');
    }
    updateBannerVisibility();
    renderShop();
    refreshDash();
  }
  function bookSubDay(p) {
    // Амортизированный net за день = цена·(1−стор)/дней плана.
    var net = p.price * (1 - WGMON.SUB.storeCut) / p.days;
    session.subRev += net;
    S.lifetime.subRev += net;
    S.subscription.lastDaily = todayStr();
    window.WGMonStore.save();
  }
  function cancelSubscription() {
    S.subscription.active = false;
    S.subscription.trial = false;
    window.WGMonStore.save();
    track('sub_cancel', { plan: S.subscription.plan });
    updateBannerVisibility();
    renderShop();
    refreshDash();
    toast('СИМУЛЯЦИЯ: подписка отменена');
  }

  function buyRemoveAds() {
    if (S.removeAds) { toast('Remove Ads уже куплен'); return; }
    S.removeAds = true;
    var price = WGMON.REMOVE_ADS.price;
    session.iapRev += price; session.iapCount++;
    S.lifetime.iapRev += price; S.lifetime.iapCount++;
    window.WGMonStore.save();
    track('remove_ads_purchase', { price_usd: price });
    track('iap_purchase', { sku: WGMON.REMOVE_ADS.id, price_usd: price, is_first_purchase: S.lifetime.iapCount === 1 });
    toast('СИМУЛЯЦИЯ: реклама убрана навсегда · $' + price.toFixed(2));
    updateBannerVisibility();
    renderShop();
    refreshDash();
  }

  function purchaseIap(id) {
    var sku = findSku(id);
    if (!sku) return;
    if (sku.once && sku.id === 'coins_starter' && S.starterBought) { toast('Стартовый набор — одноразовый'); return; }
    track('iap_purchase', { sku: id, price_usd: sku.price, is_first_purchase: S.lifetime.iapCount === 0 });
    if (sku.coins && window.WG && window.WG.addCoins) window.WG.addCoins(sku.coins, 'iap');
    if (sku.cosmetic) {
      if (sku.cosmetic.skin && S.skins.indexOf(sku.cosmetic.skin) === -1) S.skins.push(sku.cosmetic.skin);
      if (sku.cosmetic.frame) S.frame = true;
      if (sku.cosmetic.badge) S.badge = true;
    }
    if (sku.id === 'coins_starter') S.starterBought = true;

    session.iapRev += sku.price; session.iapCount++;
    S.lifetime.iapRev += sku.price; S.lifetime.iapCount++;
    window.WGMonStore.save();
    toast('СИМУЛЯЦИЯ: куплено «' + sku.title + '» · +' + (sku.coins || 0) + ' 🪙 · $' + sku.price.toFixed(2));
    renderShop();
    refreshDash();
  }

  /* ============================== РЕНДЕР МАГАЗИНА ======================= */

  function renderShop() {
    // Шапка: баланс монет.
    setText('shopCoins', (window.WG && window.WG.getCoins) ? String(window.WG.getCoins()) : '0');

    // --- Подписка WordGrove Club (герой) ---
    var subCard = el('subCard');
    if (subCard) {
      var perks = '';
      for (var i = 0; i < WGMON.SUB.perks.length; i++) perks += '<li>' + WGMON.SUB.perks[i] + '</li>';
      var m = WGMON.SUB.monthly, y = WGMON.SUB.yearly;
      var html = '<div class="sub-badge">ГЛАВНЫЙ ПРОДУКТ · СИМУЛЯЦИЯ</div>' +
        '<h3 class="sub-title">👑 WordGrove Club</h3>' +
        '<ul class="sub-perks">' + perks + '</ul>';
      if (subscribed()) {
        var planLabel = S.subscription.plan === 'yearly' ? y.label : m.label;
        html += '<div class="sub-active">✅ Активна' + (S.subscription.trial ? ' (триал 7 дней)' : '') +
          ' · план: ' + planLabel + '</div>' +
          '<button type="button" class="sub-cancel" data-mon="sub-cancel">Отменить подписку</button>';
      } else {
        html += '<div class="sub-prices">' +
          '<button type="button" class="sub-buy trial" data-mon="sub-trial">Начать 7 дней бесплатно' +
          '<span class="sub-sub">затем ' + m.label + ' $' + m.price.toFixed(2) + '/мес</span></button>' +
          '<button type="button" class="sub-buy year" data-mon="sub-year">Годовой $' + y.price.toFixed(2) +
          '<span class="sub-sub">' + y.label + ' · выгоднее</span></button>' +
          '</div>';
      }
      subCard.innerHTML = html;
    }

    // --- Remove Ads ---
    var ra = el('removeAdsCard');
    if (ra) {
      ra.innerHTML = '<div class="ra-top"><span class="ra-title">🚫 Убрать рекламу навсегда</span>' +
        '<span class="ra-sub">Отключает interstitial + баннер (rewarded остаётся). Не включает премиум-контент.</span></div>' +
        (S.removeAds
          ? '<button type="button" class="ra-buy done" disabled>✓ куплено</button>'
          : '<button type="button" class="ra-buy" data-mon="remove-ads">$' + WGMON.REMOVE_ADS.price.toFixed(2) + '</button>');
    }

    // --- RV-6 rewarded в магазине ---
    ensureDay();
    var rv6 = el('rv6Status');
    if (rv6) {
      rv6.innerHTML = 'Заморозок стрика: <b>' + S.freezeTokens + '</b> · сегодня RV-6: ' + S.day.rv6 + '/' + WGMON.RW.RV6_DAILY_CAP;
    }
    var rv6btn = el('rv6Btn');
    if (rv6btn) rv6btn.disabled = S.day.rv6 >= WGMON.RW.RV6_DAILY_CAP;

    // --- Полка монет ---
    var list = el('iapList');
    if (list) {
      var h = '';
      for (var k = 0; k < WGMON.IAP.length; k++) {
        var sku = WGMON.IAP[k];
        var owned = (sku.id === 'coins_starter' && S.starterBought);
        var cls = 'iapCard' + (sku.highlight ? ' hot' : '') + (owned ? ' owned' : '');
        h += '<div class="' + cls + '">';
        h += '<div class="iapTop"><span class="iapTitle">' + sku.title + '</span>';
        if (sku.badge) h += '<span class="iapBadge">' + sku.badge + '</span>';
        h += '</div>';
        h += '<div class="iapDesc">' + sku.desc + '</div>';
        if (owned) h += '<button type="button" class="iapBuy done" disabled>✓ куплено</button>';
        else h += '<button type="button" class="iapBuy" data-sku="' + sku.id + '">$' + sku.price.toFixed(2) + '</button>';
        h += '</div>';
      }
      list.innerHTML = h;
    }

    var st = el('shopStatus');
    if (st) {
      var bits = [];
      bits.push(adsRemoved() ? '🚫 Реклама выключена' : '📺 Реклама включена');
      bits.push(subscribed() ? '👑 Клуб активен' : 'Без подписки');
      if (S.removeAds) bits.push('Remove Ads ✓');
      st.innerHTML = 'СИМУЛЯЦИЯ · ' + bits.join(' · ');
    }
  }

  /* ============================== ЭКРАНЫ ================================= */

  function openShop() {
    ensureDay();
    session.offers.shown++;                              // RV-6 виден в магазине
    var sc = el('shopScreen'); if (sc) sc.classList.remove('hidden');
    updateBannerVisibility();
    renderShop();
    refreshDash();
  }
  function closeShop() {
    var sc = el('shopScreen'); if (sc) sc.classList.add('hidden');
    updateBannerVisibility();
  }

  /* ===================== ИНЪЕКЦИЯ RV-2 В ОВЕРЛЕЙ ПОБЕДЫ ================= */

  function maybeInjectDouble() {
    var panel = el('overlay-panel');
    var ov = el('overlay');
    if (!panel || !ov || ov.classList.contains('hidden')) return;
    var next = el('ov-next');                            // есть только на оверлее победы кампании
    if (!next) return;
    if (isDaily()) return;                               // на дневном RV-2 не показываем (свой поток)
    if (panel.querySelector('.rv2-inject')) return;      // уже вставлено

    // Сумма монет уровня = сумма чисел в строках .reward-line (устойчиво к значениям).
    var reward = 0;
    var lines = panel.querySelectorAll('.reward-line');
    for (var i = 0; i < lines.length; i++) {
      var mm = (lines[i].textContent || '').match(/\+(\d+)/);
      if (mm) reward += parseInt(mm[1], 10);
    }
    if (!reward || !isFinite(reward)) reward = 20;

    session.offers.shown++;                              // RV-2 показан
    track('ad_offer', { placement: 'RV-2' });
    var btn = document.createElement('button');
    btn.className = 'rv2-inject';
    btn.type = 'button';
    btn.innerHTML = '📺 ×2 монеты за уровень (+' + reward + ' 🪙)<span class="rv2-sub">RV-2 · СИМУЛЯЦИЯ</span>';
    btn.addEventListener('click', function () { offerDoubleCoins(reward, btn); });
    next.parentNode.insertBefore(btn, next);
    refreshDash();
  }

  /* ============================== IN-LEVEL RV-1 ========================= */

  function updateInLevelRv() {
    var b = el('btn-rv1');
    if (!b) return;
    if (adsRemoved()) {
      // Подписчику Лампа и так бесплатна (безлимит) — кнопка RV-1 не нужна.
      b.classList.add('hidden');
      return;
    }
    b.classList.remove('hidden');
    b.classList.toggle('poor', !rv1Available());
  }

  /* ============================== ПРИВЯЗКА UI =========================== */

  function bindUi() {
    // Вход в магазин / дашборд из HUD.
    var shopBtn = el('btn-shop'); if (shopBtn) shopBtn.addEventListener('click', openShop);
    var shopClose = el('shopCloseBtn'); if (shopClose) shopClose.addEventListener('click', closeShop);

    // RV-1 в игре.
    var rv1 = el('btn-rv1'); if (rv1) rv1.addEventListener('click', offerFreeLamp);

    // RV-6 в магазине.
    var rv6 = el('rv6Btn'); if (rv6) rv6.addEventListener('click', offerFreezeStreak);

    // Делегирование действий магазина (подписка / remove-ads / полка).
    var shop = el('shopScreen');
    if (shop) shop.addEventListener('click', function (e) {
      var t = e.target;
      var monBtn = t && t.closest ? t.closest('[data-mon]') : null;
      if (monBtn) {
        var a = monBtn.getAttribute('data-mon');
        if (a === 'sub-trial') subscribe('monthly', true);
        else if (a === 'sub-year') subscribe('yearly', false);
        else if (a === 'sub-cancel') cancelSubscription();
        else if (a === 'remove-ads') buyRemoveAds();
        return;
      }
      var buy = t && t.closest ? t.closest('.iapBuy') : null;
      if (buy && !buy.disabled) purchaseIap(buy.getAttribute('data-sku'));
    });

    /* Перехват кликов ядра/меты в capture-фазе:
     *  • #ov-next        → interstitial I-1 перед переходом на след. уровень;
     *  • [data-action=open-piggy] → rewarded RV-5 перед открытием копилки;
     *  • #btn-hint       → клубный «безлимит подсказок» (бесплатная Лампа подписчику). */
    document.addEventListener('click', function (e) {
      if (bypassClick) { bypassClick = false; return; }   // повторная отправка — пропускаем
      var t = e.target;
      var next = t && t.closest ? t.closest('#ov-next') : null;
      if (next) { handleNextClick(e, next); return; }
      var piggy = t && t.closest ? t.closest('[data-action="open-piggy"]') : null;
      if (piggy) { handlePiggyClick(e, piggy); return; }
      var hint = t && t.closest ? t.closest('#btn-hint') : null;
      if (hint && subscribed() && window.WG && window.WG.revealFreeLetter) {
        e.preventDefault(); e.stopPropagation();
        var ok = window.WG.revealFreeLetter();
        toast(ok ? '👑 Клубная подсказка (безлимит)' : 'Открывать нечего');
      }
    }, true);

    // Наблюдатель за оверлеем: вставляем RV-2 при появлении экрана победы.
    if (typeof MutationObserver === 'function') {
      var ov = el('overlay');
      if (ov) new MutationObserver(function () {
        if (!ov.classList.contains('hidden')) setTimeout(maybeInjectDouble, 0);
        updateBannerVisibility();
      }).observe(ov, { attributes: true, attributeFilter: ['class'], childList: false });
      var panel = el('overlay-panel');
      if (panel) new MutationObserver(function () {
        setTimeout(maybeInjectDouble, 0);
      }).observe(panel, { childList: true });

      // Смена уровня (текст HUD) → обновляем состояние кнопки RV-1 и баннер.
      var hudLv = el('hud-level');
      if (hudLv) new MutationObserver(function () {
        updateInLevelRv();
        updateBannerVisibility();
      }).observe(hudLv, { childList: true, characterData: true, subtree: true });

      // Открытие/закрытие меты → перерисовать баннер (баннер прячется под метой).
      // #meta-screen строится ЛЕНИВО (meta.js грузится ПОСЛЕ monetize.js и создаёт
      // экран при первом Meta.open()), поэтому здесь его ещё нет — дожидаемся вставки
      // в #app, иначе баннер не реагировал бы на открытие/закрытие меты.
      function watchMeta(node) {
        new MutationObserver(function () { updateBannerVisibility(); })
          .observe(node, { attributes: true, attributeFilter: ['class'] });
      }
      var metaScr = el('meta-screen');
      if (metaScr) {
        watchMeta(metaScr);
      } else {
        var appEl = el('app');
        if (appEl) {
          var appObs = new MutationObserver(function () {
            var ms = el('meta-screen');
            if (ms) { appObs.disconnect(); watchMeta(ms); updateBannerVisibility(); }
          });
          appObs.observe(appEl, { childList: true });
        }
      }
    }
  }

  /* --------------------------- Инициализация ----------------------- */
  ensureDay();
  bindUi();
  renderShop();
  updateInLevelRv();
  window.addEventListener('load', function () {
    startBannerLoop();
    updateInLevelRv();
  });

  /* Публичный API для дашборда (analytics.js) и отладки. */
  return {
    MON: WGMON,
    getSession: function () { return session; },
    getStore: function () { return S; },
    getTargets: function () { return WGMON.TARGETS; },
    getGeo: function () { return S.geoTier; },
    geoLabel: geoLabel,
    ecpmFor: ecpmFor,
    adsRemoved: adsRemoved,
    subscribed: subscribed,
    setGeo: function (tier) {
      if (WGMON.GEO_ORDER.indexOf(tier) === -1) return;
      S.geoTier = tier;
      window.WGMonStore.save();
      updateBannerEcpm();
      refreshDash();
    },
    openShop: openShop, closeShop: closeShop,
    resetSession: function () { session = freshSession(); refreshDash(); },
    // ре-экспорт для отладки/тестов:
    offerFreeLamp: offerFreeLamp, offerFreezeStreak: offerFreezeStreak,
    subscribe: subscribe, cancelSubscription: cancelSubscription,
    buyRemoveAds: buyRemoveAds, purchaseIap: purchaseIap
  };
})();
