/* =============================================================================
 * Block Surge — слой МОНЕТИЗАЦИИ (Проход В): реклама + IAP
 * -----------------------------------------------------------------------------
 * ⚠️  ВСЁ ЗДЕСЬ — СИМУЛЯЦИЯ. НИКАКИХ реальных рекламных SDK, сетей и платежей.
 *     «Показ рекламы» = экранный оверлей-заглушка с отсчётом 3–5 сек (в проде
 *     тут AppLovin MAX / AdMob, 06 §8). «Покупка» = мгновенная выдача товара
 *     без денег и платёжных провайдеров. На всех экранах стоит слово
 *     «СИМУЛЯЦИЯ». Каждый смоделированный показ/покупка генерирует выручку по
 *     eCPM/прайсу из главы 06 и логируется в дашборд (Проход В, analytics.js).
 * -----------------------------------------------------------------------------
 * Реализует 06-monetization.md §2 (карта плейсментов), §3 (правила капа
 * interstitial), §4 (eCPM по формату/гео), §5 (полка IAP), §7 (частично —
 * remove-ads/подписка отключают INT+BAN). Поверх готовых Проходов А+Б: ядро
 * (game.js) и мету (meta.js) НЕ переписывает — только добавляет монетизацию.
 *
 * Подключается в index.html ПОСЛЕ economy.js и ПЕРЕД game.js. К моменту вызовов
 * из обработчиков объекты window.Store / window.Economy / window.Analytics уже
 * существуют (economy.js), а window.newGame / window.board и т.д. — уже после
 * загрузки game.js (мы дёргаем их только в рантайме, из обработчиков событий).
 *
 * СОВМЕСТИМОСТЬ САВА: состояние монетизации живёт в ОТДЕЛЬНОМ ключе
 * 'blocksurge_monetize' (тот же префикс игры). Схему Прохода Б ('blocksurge_meta')
 * и рекорд Прохода А ('blocksurge_best') не трогает. Отсутствие ключа/полей →
 * дефолты (sanitize ниже), поэтому старые сейвы игру не ломают.
 * ========================================================================== */
'use strict';

/* ============================ КОНФИГ МОНЕТИЗАЦИИ ==========================
 * Числа — из главы 06. Менять только синхронно со спекой. */

var MON = {
  STORAGE_KEY: 'blocksurge_monetize',

  /* --- eCPM-бенчмарки (06 §4), $ за 1000 показов ---
   * tier1 — точки США/Tier-1 из ТЗ (rewarded ~$16, interstitial ~$14, banner
   * ~$0.5); tier23 = tier1 × 0.4 (правило ТЗ, укладывается в диапазоны 06 §4:
   * RW $4–7, INT $3–5, BAN $0.10–0.25); blend — столбец «Blend 60/40» 06 §4
   * (RW $13 / INT $10 / BAN $0.40), к которому привязаны цели главы 09. */
  ECPM: {
    rw:     { tier1: 16.00, blend: 13.00, tier23: 6.40 },
    int:    { tier1: 14.00, blend: 10.00, tier23: 5.60 },
    banner: { tier1: 0.50,  blend: 0.40,  tier23: 0.20 }
  },
  ECPM_JITTER: 0.25,               // ±25% случайный разброс выручки вокруг бенчмарка

  GEO_LABELS: { tier1: 'Tier-1 (US/JP/DE/UK)', blend: 'Бленд 60/40', tier23: 'Tier-2/3' },
  GEO_ORDER: ['tier1', 'blend', 'tier23'],
  DEFAULT_GEO: 'blend',            // бленд — чтобы KPI совпадали с целями 09 (blended)

  /* --- Правила interstitial (06 §3), зашиты кодом, а не конфигом кампаний --- */
  INT: {
    FTUE_GAMES: 2,                 // не показывать, пока сыграно < N партий (прокси «первых 5 уровней», 06 §3.1)
    FTUE_MS: 30000,                // и первые N мс сессии (прод: 8 мин lifetime, 06 §3.1)
    MIN_GAMES_BETWEEN: 1,          // не чаще 1 показа на каждые (N+1) партий (частотный кап)
    MIN_INTERVAL_MS: 90000,        // ≥90 сек между interstitial (06 §3.3)
    AFTER_RW_MS: 60000,            // ≥60 сек после rewarded (06 §3.4)
    AFTER_IAP_MS: 24 * 3600 * 1000, // не после покупки в сессии (06 §3.6) — сутки
    SESSION_CAP: 10,               // ≤10/день (06 §3.1; день 1 — 5, здесь прототипный кап 10)
    SECONDS: 4,                    // длительность симуляции показа (skippable ≤5 сек, 06 §2.1)
    SKIP_AFTER: 2                  // кнопка «Пропустить» появляется через N сек
  },

  /* --- Rewarded (06 §2.2): 4 плейсмента --- */
  RW: {
    SECONDS: 5,                    // rewarded video 15–30 сек → в прототипе 5 сек
    RW1_PER_GAME: 1,               // «Второй шанс»: 1/партию (06 §2.2, RW-1)
    RW2_DAILY_CAP: 3,              // «×2 монеты за партию»: 3/день (RW-2)
    RW3_DAILY_CAP: 2,              // «Бесплатный бустер»: 1/день + 1 на боссе → 2 (RW-3)
    RW4_DAILY_CAP: 2,              // «×2 награда стрика/миссии»: 2/день суммарно (RW-4)
    RW4_BONUS_COINS: 100           // альтернатива «спасти серию» — 100 монет (06 §2.2, RW-4)
  },

  BANNER: {
    REFRESH_MS: 15000              // авто-рефреш баннера (прод: 30 сек, 06 §2.3)
  },

  /* --- Полка IAP (06 §5). price — локализованная tier-цена стора ($US).
   * grant: coins / boosters{id:n} / removeAds / subscription / skin / frame / pass.
   * Витрина сегментируется (06 §5: ≤6 SKU), здесь показываем полный каталог для
   * теста. --- */
  IAP: [
    { id: 'starter', price: 0.99,  title: 'Стартовый набор', desc: '600 монет + Молот · окно D3–D10, одноразовый',
      grant: { coins: 600, boosters: { hammer: 1 } }, badge: 'ЛУЧШИЙ СТАРТ' },
    { id: 'coins_s', price: 1.99,  title: 'Пак монет S', desc: '1 200 монет · импульсная докупка',
      grant: { coins: 1200 } },
    { id: 'piggy',   price: 2.99,  title: 'Копилка', desc: 'до 3 000 монет · «свои жалко»',
      grant: { coins: 3000 } },
    { id: 'remove_ads', price: 4.99, title: 'Remove Ads', desc: 'Навсегда убирает interstitial + баннер (rewarded остаётся)',
      grant: { removeAds: true }, highlight: true, badge: 'ГЛАВНЫЙ SKU' },
    { id: 'season_pass', price: 4.99, title: 'Season Pass', desc: 'Платная ветка трека + 1 000 монет + 3 бустера',
      grant: { coins: 1000, boosters: { undo: 1, swap: 1, hammer: 1 }, pass: true } },
    { id: 'coins_m', price: 4.99,  title: 'Пак M', desc: '3 500 монет + 2 бустера',
      grant: { coins: 3500, boosters: { swap: 1, hammer: 1 } } },
    { id: 'coins_l', price: 9.99,  title: 'Пак L', desc: '8 000 монет + 5 бустеров',
      grant: { coins: 8000, boosters: { undo: 2, swap: 1, hammer: 2 } } },
    { id: 'coins_xl', price: 19.99, title: 'Пак XL', desc: '18 000 монет + 12 бустеров + эксклюзивный скин',
      grant: { coins: 18000, boosters: { undo: 4, swap: 4, hammer: 4 }, skin: 'aurora' } },
    { id: 'coins_xxl', price: 49.99, title: 'Пак XXL', desc: '50 000 монет + 30 бустеров · хвост китов',
      grant: { coins: 50000, boosters: { undo: 10, swap: 10, hammer: 10 } } },
    { id: 'mega', price: 99.99, title: 'Мега-сундук сезона', desc: '110 000 монет + все скины сезона + рамка профиля',
      grant: { coins: 110000, boosters: { undo: 20, swap: 20, hammer: 20 }, skin: 'season', frame: true }, badge: 'ЯКОРЬ' },
    { id: 'sub', price: 7.99, title: 'Подписка Surge Premium', desc: 'No ads + 200 монет/день + эксклюзивная тема (в мес)',
      grant: { subscription: true, coins: 200 }, highlight: true, badge: 'ПОДПИСКА' }
  ],

  /* --- Цели KPI (09 §4) для сравнения в дашборде --- */
  TARGETS: {
    intPerDau: 7.0, rwPerDau: 1.8, bannerPerDau: 35,
    adArpdau: 0.105, iapArpdau: 0.045, blendedArpdau: 0.15,
    ecpm: { rw: 13, int: 10, banner: 0.40 },
    adShare: 70
  }
};

/* ============================== ХРАНИЛИЩЕ ================================= */

window.MonStore = (function () {

  function defaults() {
    return {
      v: 1,
      removeAds: false,
      subscription: { active: false, since: '', lastDaily: '' },
      geoTier: MON.DEFAULT_GEO,
      skins: [],
      frame: false,
      pass: false,
      day: { date: '', int: 0, rw2: 0, rw3: 0, rw4: 0 },
      lifetime: { adRev: 0, iapRev: 0, imp: { int: 0, rw: 0, banner: 0 }, iapCount: 0 }
    };
  }

  function num(v, def, min) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) n = def;
    if (min !== undefined && n < min) n = min;
    return n;
  }
  function int(v, def, min) { return Math.floor(num(v, def, min)); }
  function str(v) { return typeof v === 'string' ? v : ''; }
  function bool(v) { return !!v; }

  /* Санитизация: валидный, но повреждённый JSON не должен дать NaN/Infinity в
   * выручке дашборда или сломать счётчики. */
  function sanitize(s) {
    var d = defaults();
    if (!s || typeof s !== 'object') return d;
    var sub = (s.subscription && typeof s.subscription === 'object') ? s.subscription : {};
    var day = (s.day && typeof s.day === 'object') ? s.day : {};
    var lt = (s.lifetime && typeof s.lifetime === 'object') ? s.lifetime : {};
    var imp = (lt.imp && typeof lt.imp === 'object') ? lt.imp : {};
    var geo = str(s.geoTier);
    if (MON.GEO_ORDER.indexOf(geo) === -1) geo = MON.DEFAULT_GEO;
    return {
      v: int(s.v, 1, 1),
      removeAds: bool(s.removeAds),
      subscription: { active: bool(sub.active), since: str(sub.since), lastDaily: str(sub.lastDaily) },
      geoTier: geo,
      skins: Array.isArray(s.skins) ? s.skins : [],
      frame: bool(s.frame),
      pass: bool(s.pass),
      day: {
        date: str(day.date),
        int: int(day.int, 0, 0), rw2: int(day.rw2, 0, 0),
        rw3: int(day.rw3, 0, 0), rw4: int(day.rw4, 0, 0)
      },
      lifetime: {
        adRev: num(lt.adRev, 0, 0), iapRev: num(lt.iapRev, 0, 0),
        imp: { int: int(imp.int, 0, 0), rw: int(imp.rw, 0, 0), banner: int(imp.banner, 0, 0) },
        iapCount: int(lt.iapCount, 0, 0)
      }
    };
  }

  var state = defaults();
  try {
    var raw = localStorage.getItem(MON.STORAGE_KEY);
    if (raw) state = sanitize(JSON.parse(raw));
  } catch (e) { state = defaults(); }

  function save() {
    try { localStorage.setItem(MON.STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* приватный режим / переполнение — игра продолжается */ }
  }

  return { state: state, save: save, reset: function () { state = defaults(); save(); return state; } };
})();

/* ============================== МОНЕТИЗАЦИЯ ============================== */

window.Monetize = (function () {

  var S = window.MonStore.state;
  var A = window.Analytics;

  /* Счётчики ТЕКУЩЕЙ СЕССИИ (сброс при перезагрузке) — основа дашборда 09:
   * сессия трактуется как «этот игрок = 1 симулированный DAU за день». */
  function freshSession() {
    return {
      startedAt: Date.now(),
      imp: { int: 0, rw: 0, banner: 0 },
      revByFormat: { int: 0, rw: 0, banner: 0 },
      adRev: 0, iapRev: 0, iapCount: 0,
      offers: { shown: 0, accepted: 0 },
      intCapped: 0,
      lastCapRule: ''
    };
  }
  var session = freshSession();

  var sessionStart = Date.now();
  var lastInterstitialMs = 0;
  var lastInterstitialGame = -999;
  var lastRewardedMs = 0;
  var lastIapMs = 0;

  /* Пер-партийные флаги rewarded (сброс при старте новой партии). */
  var revivedThisGame = false;
  var rw2UsedThisGame = false;

  /* --------------------------- Утилиты --------------------------- */

  function el(id) { return document.getElementById(id); }
  function setText(id, t) { var e = el(id); if (e) e.textContent = t; }
  function track(ev, p) { try { if (A) A.track(ev, p || {}); } catch (e) { /* no-op */ } }
  function toast(msg) {
    if (window.showToast) { window.showToast(msg); return; }
    var t = el('toast'); if (!t) return;
    t.textContent = msg; t.classList.remove('hidden');
    setTimeout(function () { t.classList.add('hidden'); }, 2000);
  }
  function nowMs() { return Date.now(); }

  function p2(n) { return n < 10 ? '0' + n : '' + n; }
  /* «Сегодня» с учётом тестового сдвига дней Прохода Б (кнопка «Новый день»):
   * так «Новый день (тест)» сбрасывает и дневные капы рекламы — удобно тестить. */
  function todayStr() {
    var off = 0;
    try { off = (window.Store && window.Store.state.meta.simOffset) || 0; } catch (e) { off = 0; }
    var d = new Date();
    d.setDate(d.getDate() + off);
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }
  function ensureDay() {
    var t = todayStr();
    if (S.day.date !== t) {
      S.day = { date: t, int: 0, rw2: 0, rw3: 0, rw4: 0 };
      window.MonStore.save();
    }
  }
  function metaGamesPlayed() {
    try { return window.Store.state.stats.gamesPlayed || 0; } catch (e) { return 0; }
  }

  function geoLabel() { return MON.GEO_LABELS[S.geoTier] || S.geoTier; }
  function ecpmFor(fmt) {
    var row = MON.ECPM[fmt] || {};
    return row[S.geoTier] !== undefined ? row[S.geoTier] : (row.blend || 0);
  }
  function genRevenue(fmt) {
    var base = ecpmFor(fmt);
    var j = 1 + (Math.random() * 2 - 1) * MON.ECPM_JITTER;   // ±jitter вокруг бенчмарка
    return base * j / 1000;
  }
  function adsRemoved() { return !!S.removeAds || !!(S.subscription && S.subscription.active); }

  function refreshDash() { try { if (window.Dashboard) window.Dashboard.refresh(); } catch (e) { /* no-op */ } }

  /* --------------------------- Учёт показов --------------------------- */

  function recordImpression(fmt, placement) {
    var rev = genRevenue(fmt);
    session.imp[fmt]++;
    session.revByFormat[fmt] += rev;
    session.adRev += rev;
    S.lifetime.imp[fmt]++;
    S.lifetime.adRev += rev;
    window.MonStore.save();
    track('ad_impression', {
      format: fmt, placement: placement, network: 'applovin_max',
      ecpm: ecpmFor(fmt), watched_pct: 100
    });
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
    setText('adSimPitch', opts.pitch || 'В проде здесь крутится реальная сеть: AppLovin MAX / AdMob (06 §8).');
    setText('adSimEcpm', 'eCPM (' + geoLabel() + '): $' + ecpmFor(opts.fmt).toFixed(2) + ' / 1000');
    var skip = el('adSimSkip'), claim = el('adSimClaim');
    skip.classList.add('hidden'); claim.classList.add('hidden');
    ov.classList.remove('hidden');

    var remaining = opts.seconds;
    setText('adSimTimer', remaining);
    var done = false;
    function finish() {
      if (done) return; done = true;
      if (adTimer) { clearInterval(adTimer); adTimer = null; }
      ov.classList.add('hidden');
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
      if (opts.kind === 'int' && remaining <= opts.seconds - MON.INT.SKIP_AFTER) {
        skip.textContent = 'Пропустить ✕';
        skip.classList.remove('hidden');
      }
    }, 1000);
  }

  /* ========================= INTERSTITIAL (06 §3) ===================== */

  /* Возвращает код блокирующего правила или null (можно показывать). */
  function interstitialBlockReason() {
    if (adsRemoved()) return 'remove_ads';
    if (metaGamesPlayed() < MON.INT.FTUE_GAMES) return 'ftue_games';
    if (nowMs() - sessionStart < MON.INT.FTUE_MS) return 'ftue_time';
    ensureDay();
    if (S.day.int >= MON.INT.SESSION_CAP) return 'session_cap';
    if (metaGamesPlayed() - lastInterstitialGame < MON.INT.MIN_GAMES_BETWEEN) return 'frequency';
    if (nowMs() - lastInterstitialMs < MON.INT.MIN_INTERVAL_MS) return 'interval';
    if (nowMs() - lastRewardedMs < MON.INT.AFTER_RW_MS) return 'after_rw';
    if (nowMs() - lastIapMs < MON.INT.AFTER_IAP_MS) return 'after_iap';
    return null;
  }

  /* Пытается показать interstitial. true — показ идёт, cb вызовется после;
   * false — показа не будет, вызывающий продолжает свой поток сам. */
  function tryInterstitial(cb) {
    var reason = interstitialBlockReason();
    if (reason === null) {
      showAdSim({
        kind: 'int', fmt: 'int', seconds: MON.INT.SECONDS,
        formatLabel: 'Interstitial · INT-2 (между партиями)'
      }, function () {
        var rev = recordImpression('int', 'INT-2');
        lastInterstitialMs = nowMs();
        lastInterstitialGame = metaGamesPlayed();
        S.day.int++;
        window.MonStore.save();
        toast('Interstitial засчитан · +$' + rev.toFixed(4));
        cb();
      });
      return true;
    }
    // Диагностика недопоказа (09 §2.3 ad_capped) — только «настоящие» капы.
    if (reason !== 'ftue_games' && reason !== 'ftue_time' && reason !== 'remove_ads') {
      session.intCapped++;
      session.lastCapRule = reason;
      track('ad_capped', { placement: 'INT-2', cap_rule: reason });
      refreshDash();
    }
    return false;
  }

  /* ========================== REWARDED (06 §2.2) ====================== */

  function rwCapLeft(kind) {
    ensureDay();
    if (kind === 'rw1') return !revivedThisGame;
    if (kind === 'rw2') return !rw2UsedThisGame && S.day.rw2 < MON.RW.RW2_DAILY_CAP;
    if (kind === 'rw3') return S.day.rw3 < MON.RW.RW3_DAILY_CAP;
    if (kind === 'rw4') return S.day.rw4 < MON.RW.RW4_DAILY_CAP;
    return true;
  }

  /* Общий прогон rewarded-показа: оффер → приём → симуляция → выдача награды. */
  function playRewarded(placement, formatLabel, pitch, onReward) {
    session.offers.accepted++;
    track('ad_offer', { placement: placement, shown: true, accepted: true });
    showAdSim({
      kind: 'rw', fmt: 'rw', seconds: MON.RW.SECONDS,
      formatLabel: formatLabel, pitch: pitch
    }, function () {
      var rev = recordImpression('rw', placement);
      lastRewardedMs = nowMs();
      if (onReward) onReward(rev);
      refreshDash();
    });
  }

  /* --- RW-1: «Второй шанс» на экране game over — освободить поле и продолжить --- */
  function offerRevive() {
    if (window.gameOver !== true) { toast('Партия ещё идёт'); return; }
    if (!rwCapLeft('rw1')) { toast('«Второй шанс» уже использован в этой партии'); return; }
    // Прячем экран итога на время показа, затем оживляем ту же партию.
    var over = el('overlay'); if (over) over.classList.add('hidden');
    playRewarded('RW-1', 'Rewarded · RW-1 «Второй шанс»',
      'Досмотри — освободим место на поле и продолжим партию.', function () {
        reviveBoard();
        revivedThisGame = true;
        toast('💚 Поле освобождено — играй дальше!');
      });
  }

  /* Освобождение места: чистим 2 самые заполненные строки и 2 столбца
   * (аналог «+2 ряда +2 столбца», 06 §2.2 RW-1), затем свежая разрешимая тройка. */
  function reviveBoard() {
    var b = window.board;
    if (!b || !b.length) return;
    var n = b.length, r, c;
    function rowFill(i) { var k = 0; for (var j = 0; j < n; j++) if (b[i][j] !== 0) k++; return k; }
    function colFill(j) { var k = 0; for (var i = 0; i < n; i++) if (b[i][j] !== 0) k++; return k; }
    var rows = [], cols = [];
    for (r = 0; r < n; r++) rows.push({ i: r, f: rowFill(r) });
    for (c = 0; c < n; c++) cols.push({ i: c, f: colFill(c) });
    rows.sort(function (a, z) { return z.f - a.f; });
    cols.sort(function (a, z) { return z.f - a.f; });
    var i2;
    for (i2 = 0; i2 < 2 && i2 < rows.length; i2++) { var rr = rows[i2].i; for (c = 0; c < n; c++) b[rr][c] = 0; }
    for (i2 = 0; i2 < 2 && i2 < cols.length; i2++) { var cc = cols[i2].i; for (r = 0; r < n; r++) b[r][cc] = 0; }

    window.gameOver = false;
    if (window.dealHand) window.dealHand();            // гарантированно разрешимая тройка (ядро)
    if (window.refreshPlaceable) window.refreshPlaceable();
    if (window.updateHUD) window.updateHUD();
  }

  /* --- RW-2: «×2 монеты за партию» на экране game over --- */
  function offerDoubleCoins() {
    if (!rwCapLeft('rw2')) { toast('Лимит «×2 монеты» на сегодня исчерпан'); return; }
    var earned = 0;
    try { earned = window.Economy ? window.Economy.getEarnedThisGame() : 0; } catch (e) { earned = 0; }
    playRewarded('RW-2', 'Rewarded · RW-2 «×2 монеты за партию»',
      'Досмотри — удвоим монеты, заработанные в этой партии.', function () {
        var bonus = earned > 0 ? earned : 20;          // подстраховка, если партия без монет
        if (window.Economy) window.Economy.addCoins(bonus, 'rw2', false);
        rw2UsedThisGame = true;
        S.day.rw2++;
        window.MonStore.save();
        setText('overCoins', String(earned + bonus) + ' (×2)');
        updateGameOverButtons();
        toast('💰 +' + bonus + '🪙 (×2 монеты за партию)');
      });
  }

  /* --- RW-3: «Бесплатный бустер» (Молот) в мета-экране --- */
  function offerFreeBooster() {
    if (!rwCapLeft('rw3')) { toast('Лимит бесплатных бустеров на сегодня'); return; }
    playRewarded('RW-3', 'Rewarded · RW-3 «Бесплатный бустер»',
      'Досмотри — получи бустер Молот бесплатно.', function () {
        if (window.Economy) window.Economy.addBooster('hammer', 1, 'rw');
        S.day.rw3++;
        window.MonStore.save();
        if (window.Meta) { window.Meta.renderBoosterBar(); window.Meta.renderMeta(); }
        updateMetaAdStatus();
        toast('🔨 +1 Молот (бесплатно за rewarded)');
      });
  }

  /* --- RW-4: «×2 награда стрика/миссии» в мета-экране --- */
  function offerDoubleStreak() {
    if (!rwCapLeft('rw4')) { toast('Лимит «×2 награда» на сегодня'); return; }
    playRewarded('RW-4', 'Rewarded · RW-4 «×2 награда дня»',
      'Досмотри — удвой бонус дня / спаси серию (' + MON.RW.RW4_BONUS_COINS + ' монет).', function () {
        if (window.Economy) window.Economy.addCoins(MON.RW.RW4_BONUS_COINS, 'rw', false);
        S.day.rw4++;
        window.MonStore.save();
        if (window.Meta) window.Meta.renderMeta();
        updateMetaAdStatus();
        toast('🔥 +' + MON.RW.RW4_BONUS_COINS + '🪙 (×2 награда дня)');
      });
  }

  /* ============================== БАННЕР (06 §2.3) =================== */

  function mainScreenActive() {
    // Баннер «крутится» только на игровом экране — не под полноэкранными оверлеями.
    var ids = ['overlay', 'metaScreen', 'iapScreen', 'dashboardScreen', 'adOverlay'];
    for (var i = 0; i < ids.length; i++) {
      var e = el(ids[i]);
      if (e && !e.classList.contains('hidden')) return false;
    }
    return true;
  }

  function updateBannerVisibility() {
    var bar = el('adBanner');
    if (!bar) return;
    if (adsRemoved()) bar.classList.add('hidden');
    else bar.classList.remove('hidden');
    updateBannerEcpm();
  }
  function updateBannerEcpm() {
    setText('adBannerEcpm', 'eCPM $' + ecpmFor('banner').toFixed(2) + ' · ' + geoLabel());
  }

  function startBannerLoop() {
    updateBannerVisibility();
    setInterval(function () {
      if (adsRemoved()) return;
      if (typeof document.hidden === 'boolean' && document.hidden) return;
      if (!mainScreenActive()) return;                 // не считаем показ под оверлеем
      recordImpression('banner', 'BAN-1');             // авто-рефреш = 1 показ
    }, MON.BANNER.REFRESH_MS);
  }

  /* ============================== IAP (06 §5) ======================= */

  function findSku(id) {
    for (var i = 0; i < MON.IAP.length; i++) if (MON.IAP[i].id === id) return MON.IAP[i];
    return null;
  }

  function skuOwned(sku) {
    if (sku.grant && sku.grant.removeAds) return !!S.removeAds;
    if (sku.grant && sku.grant.subscription) return !!(S.subscription && S.subscription.active);
    return false;   // расходуемые паки — покупаются повторно
  }

  function setRemoveAds(on) {
    S.removeAds = !!on;
    window.MonStore.save();
    track('remove_ads_state', { on: !!on });
    updateBannerVisibility();
  }
  function setSubscription(on) {
    S.subscription.active = !!on;
    if (on && !S.subscription.since) S.subscription.since = todayStr();
    window.MonStore.save();
    track('subscription_event', { type: on ? 'start' : 'cancel' });
    updateBannerVisibility();
  }

  function purchase(id) {
    var sku = findSku(id);
    if (!sku) return;
    track('iap_initiated', { sku: id, price_usd: sku.price });
    var g = sku.grant || {}, k;
    if (g.coins && window.Economy) window.Economy.addCoins(g.coins, 'iap', false);
    if (g.boosters && window.Economy) for (k in g.boosters) window.Economy.addBooster(k, g.boosters[k], 'iap');
    if (g.removeAds) setRemoveAds(true);
    if (g.subscription) { setSubscription(true); grantDailyPerks(true); }
    if (g.skin && S.skins.indexOf(g.skin) === -1) S.skins.push(g.skin);
    if (g.frame) S.frame = true;
    if (g.pass) S.pass = true;

    session.iapRev += sku.price;
    session.iapCount++;
    S.lifetime.iapRev += sku.price;
    S.lifetime.iapCount++;
    lastIapMs = nowMs();
    window.MonStore.save();

    track('iap_completed', { sku: id, price_usd: sku.price });
    toast('СИМУЛЯЦИЯ: куплено «' + sku.title + '» · $' + sku.price.toFixed(2));
    if (window.Meta) window.Meta.renderBoosterBar();
    if (window.Economy) window.Economy.refreshCoinHud();
    renderShelf();
    refreshDash();
  }

  /* Подписка: +200 монет/день (06 §5). Выдаём при покупке и в новый день. */
  function grantDailyPerks(force) {
    if (!(S.subscription && S.subscription.active)) return;
    var t = todayStr();
    if (!force && S.subscription.lastDaily === t) return;
    S.subscription.lastDaily = t;
    window.MonStore.save();
    if (window.Economy) window.Economy.addCoins(200, 'subscription', false);
    track('subscription_event', { type: 'daily_grant' });
  }

  function renderShelf() {
    var list = el('iapList');
    if (list) {
      var html = '';
      for (var i = 0; i < MON.IAP.length; i++) {
        var sku = MON.IAP[i];
        var owned = skuOwned(sku);
        var cls = 'iapCard' + (sku.highlight ? ' hot' : '') + (owned ? ' owned' : '');
        html += '<div class="' + cls + '">';
        html += '<div class="iapTop"><span class="iapTitle">' + sku.title + '</span>';
        if (sku.badge) html += '<span class="iapBadge">' + sku.badge + '</span>';
        html += '</div>';
        html += '<div class="iapDesc">' + sku.desc + '</div>';
        if (owned) {
          html += '<button type="button" class="iapBuy done" disabled>✓ активно</button>';
        } else {
          html += '<button type="button" class="iapBuy" data-sku="' + sku.id + '">$' + sku.price.toFixed(2) + '</button>';
        }
        html += '</div>';
      }
      list.innerHTML = html;
    }
    var st = el('iapStatus');
    if (st) {
      var bits = [];
      bits.push(S.removeAds ? '🚫 Реклама убрана' : '📺 Реклама включена');
      bits.push(S.subscription.active ? '⭐ Подписка активна' : 'Без подписки');
      if (S.skins.length) bits.push('🎨 скинов: ' + S.skins.length);
      st.innerHTML = 'СИМУЛЯЦИЯ · ' + bits.join(' · ');
    }
    setText('iapCoins', window.Economy ? String(window.Economy.getCoins()) : '0');
  }

  /* ===================== СОСТОЯНИЕ КНОПОК ЭКРАНОВ ==================== */

  function updateGameOverButtons() {
    var cont = el('rwContinueBtn'), dbl = el('rwDoubleBtn');
    if (cont) {
      var canRev = rwCapLeft('rw1');
      cont.disabled = !canRev;
      cont.classList.toggle('used', !canRev);
    }
    if (dbl) {
      var earned = 0;
      try { earned = window.Economy ? window.Economy.getEarnedThisGame() : 0; } catch (e) { earned = 0; }
      var canDbl = rwCapLeft('rw2') && earned > 0;
      dbl.disabled = !canDbl;
      dbl.classList.toggle('used', rw2UsedThisGame);
    }
  }

  function updateMetaAdStatus() {
    var e = el('metaAdStatus');
    if (!e) return;
    ensureDay();
    e.innerHTML = 'Сегодня rewarded: RW-3 ' + S.day.rw3 + '/' + MON.RW.RW3_DAILY_CAP
      + ' · RW-4 ' + S.day.rw4 + '/' + MON.RW.RW4_DAILY_CAP
      + (adsRemoved() ? ' · 🚫 INT+BAN убраны' : '');
    var b = el('rwBoosterBtn'); if (b) b.disabled = !rwCapLeft('rw3');
    var s = el('rwStreakBtn'); if (s) s.disabled = !rwCapLeft('rw4');
  }

  /* Оффер «показан» при появлении экрана (для воронки rewarded 09 §3). */
  function onGameOverShown() {
    session.offers.shown += 2;                          // RW-1 + RW-2 видны
    track('ad_offer', { placement: 'RW-1', shown: true });
    track('ad_offer', { placement: 'RW-2', shown: true });
    updateGameOverButtons();
    refreshDash();
  }
  function onMetaShown() {
    session.offers.shown += 2;                          // RW-3 + RW-4 видны
    updateMetaAdStatus();
    refreshDash();
  }

  function resetPerGameAdState() {
    revivedThisGame = false;
    rw2UsedThisGame = false;
  }

  /* ============================== ПРИВЯЗКА =========================== */

  function openIap() {
    ensureDay(); grantDailyPerks(false);
    var sc = el('iapScreen'); if (sc) sc.classList.remove('hidden');
    updateBannerVisibility();
    renderShelf();
  }
  function closeIap() {
    var sc = el('iapScreen'); if (sc) sc.classList.add('hidden');
    updateBannerVisibility();
  }

  function bindUi() {
    // Rewarded на экране game over.
    var cont = el('rwContinueBtn'); if (cont) cont.addEventListener('click', offerRevive);
    var dbl = el('rwDoubleBtn'); if (dbl) dbl.addEventListener('click', offerDoubleCoins);

    // Rewarded в мета-экране.
    var rwB = el('rwBoosterBtn'); if (rwB) rwB.addEventListener('click', offerFreeBooster);
    var rwS = el('rwStreakBtn'); if (rwS) rwS.addEventListener('click', offerDoubleStreak);

    // Вход в магазин/дашборд.
    var openShop = el('openShopBtn'); if (openShop) openShop.addEventListener('click', openIap);
    var metaShop = el('metaShopBtn'); if (metaShop) metaShop.addEventListener('click', openIap);
    var iapClose = el('iapCloseBtn'); if (iapClose) iapClose.addEventListener('click', closeIap);

    // Делегирование покупок на полке.
    var list = el('iapList');
    if (list) list.addEventListener('click', function (e) {
      var t = e.target;
      var btn = t && t.closest ? t.closest('.iapBuy') : null;
      if (btn && !btn.disabled) purchase(btn.getAttribute('data-sku'));
    });

    // Interstitial-перехват клика «Играть заново» на экране итога (capture, чтобы
    // опередить newGame ядра). Если показ уместен — гасим переход, крутим ролик,
    // затем стартуем партию. Иначе — не мешаем ядру.
    document.addEventListener('click', function (e) {
      var t = e.target;
      var btn = t && t.closest ? t.closest('button') : null;
      if (!btn) return;
      if (btn.id === 'againBtn') {
        if (tryInterstitial(function () { resetPerGameAdState(); if (window.newGame) window.newGame(); })) {
          e.stopPropagation();
          e.preventDefault();
        } else {
          resetPerGameAdState();     // показа нет — ядро само рестартует
        }
      } else if (btn.id === 'restartBtn') {
        resetPerGameAdState();        // ручной рестарт: без interstitial (не после экрана итога)
      }
    }, true);

    // Наблюдатель за появлением экранов — оффер «показан» + актуализация кнопок.
    if (typeof MutationObserver === 'function') {
      var over = el('overlay');
      if (over) new MutationObserver(function () {
        if (!over.classList.contains('hidden')) onGameOverShown();
      }).observe(over, { attributes: true, attributeFilter: ['class'] });

      var meta = el('metaScreen');
      if (meta) new MutationObserver(function () {
        if (!meta.classList.contains('hidden')) onMetaShown();
      }).observe(meta, { attributes: true, attributeFilter: ['class'] });
    }
  }

  /* --------------------------- Инициализация ----------------------- */
  ensureDay();
  grantDailyPerks(false);
  bindUi();
  updateMetaAdStatus();
  renderShelf();
  window.addEventListener('load', startBannerLoop);

  /* Публичный API для дашборда (analytics.js) и отладки. */
  return {
    MON: MON,
    getSession: function () { return session; },
    getStore: function () { return S; },
    getTargets: function () { return MON.TARGETS; },
    getGeo: function () { return S.geoTier; },
    geoLabel: geoLabel,
    ecpmFor: ecpmFor,
    adsRemoved: adsRemoved,
    setGeo: function (tier) {
      if (MON.GEO_ORDER.indexOf(tier) === -1) return;
      S.geoTier = tier;
      window.MonStore.save();
      updateBannerEcpm();
      refreshDash();
    },
    purchase: purchase,
    openIap: openIap, closeIap: closeIap,
    resetSession: function () { session = freshSession(); refreshDash(); },
    // ре-экспорт rewarded для отладки/тестов:
    offerRevive: offerRevive, offerDoubleCoins: offerDoubleCoins,
    offerFreeBooster: offerFreeBooster, offerDoubleStreak: offerDoubleStreak
  };
})();
