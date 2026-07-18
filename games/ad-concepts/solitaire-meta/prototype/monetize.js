/* =============================================================================
 * Orchard Peaks — слой МОНЕТИЗАЦИИ (Проход В)  ⚠ ВСЁ — СИМУЛЯЦИЯ ⚠
 * -----------------------------------------------------------------------------
 * Реализует главу 06-monetization.md (§6.2–§6.7) поверх готовых Проходов А+Б.
 * Ядро (game.js) и мета/экономика (meta.js/economy.js) НЕ переписываются — этот
 * файл лишь ДОБАВЛЯЕТ рекламу-заглушки, IAP-полку, подписку/remove-ads и трекинг
 * монетизации. Подключается в index.html ПОСЛЕ economy.js и ПЕРЕД game.js
 * (после meta.js), поэтому к первым вызовам из game.js window.Monetize готов.
 *
 *  ┌───────────────────────────────────────────────────────────────────────┐
 *  │  ЭТО ПРОТОТИП. РЕКЛАМА И ПОКУПКИ — ТОЛЬКО ЗАГЛУШКИ (СИМУЛЯЦИЯ):          │
 *  │   • НЕТ реальных SDK/рекламных сетей. «Показ рекламы» = экранный        │
 *  │     оверлей с отсчётом 3–5 c. В проде здесь AppLovin MAX / AdMob        │
 *  │     (06 §6.8). Каждый смоделированный показ генерирует ВЫРУЧКУ по        │
 *  │     eCPM из главы 06 §6.7 (случайная величина вокруг бенчмарка,         │
 *  │     с учётом гео-переключателя Tier-1 / Tier-2-3).                      │
 *  │   • НЕТ реальных платежей/биллинга. «Покупка» = мгновенная симуляция    │
 *  │     без денег: товар выдаётся сразу, выручка идёт в модель.             │
 *  │  Экраны рекламы и покупок помечены словом «СИМУЛЯЦИЯ».                  │
 *  └───────────────────────────────────────────────────────────────────────┘
 *
 * Состояние (remove-ads, подписка, счётчики показов, выручка, гео) живёт в
 * localStorage под ключом orchardPeaks.monetize. Схема СОВМЕСТИМА со старыми
 * сейвами: отсутствие ключа/полей → дефолты (deepMerge). Проходы А+Б без этого
 * файла продолжают работать; все вызовы Monetize из game.js защищены проверкой
 * существования (window.Monetize && ...).
 * ========================================================================== */
'use strict';

/* ============================ КОНФИГ МОНЕТИЗАЦИИ ============================ */
/* Числа — из главы 06. Менять номинал/капы/eCPM только синхронно со спекой:
 * §6.2 карта плейсментов, §6.3 правила interstitial, §6.4 полка IAP,
 * §6.5 подписка/remove-ads, §6.6 стратегия по гео, §6.7 ожидаемые eCPM. */

var MON = {
  STORE_KEY: 'orchardPeaks.monetize',

  /* --- eCPM-бенчмарки, USD (06 §6.7). Base-сценарий: rewarded $16.0 /
   *     interstitial $12.0 (blended Tier-1 микс). Tier-2/3 — середины полос
   *     rewarded $3–7 и interstitial $2–5 (06 §6.7). --- */
  ECPM: {
    tier1:  { rewarded: 16.0, interstitial: 12.0 },
    tier23: { rewarded: 5.0,  interstitial: 3.5 }
  },
  /* eCPM-floor запроса (06 §6.6 / §6.3 п.8): дешёвый показ не стоит риска. */
  ECPM_FLOOR: {
    tier1:  { rewarded: 10.0, interstitial: 6.0 },
    tier23: { rewarded: 1.5,  interstitial: 2.0 }
  },
  ECPM_SPREAD: 0.35,          // ± разброс ставки вокруг бенчмарка (реализм аукциона)
  FAIL_RATE: { rewarded: 0.0, interstitial: 0.03 },  // доля «не загрузилось» (fill < 100%)

  /* --- Правила interstitial INT1 (06 §6.3). Все — remote config в проде. --- */
  INT_START_LEVEL:    12,     // §6.3.1: пройден уровень ≥ 12
  INT_INSTALL_AGE_H:  24,     // §6.3.1: игрок в игре ≥ 24 ч (день 1 — святое)
  INT_MIN_INTERVAL_S: 180,    // §6.3.2: ≥ 3 минуты с прошлого INT
  INT_MIN_LEVELS:     2,      // §6.3.2: ≥ 2 завершённых уровня с прошлого INT
  INT_DAILY_CAP:      8,      // §6.3.3: ≤ 8 показов/день
  INT_SESSION_CAP:    3,      // §6.3.3: ≤ 3 показа в одной сессии
  REWARDED_FATIGUE_S: 60,     // §6.3.6: не в течение 60 c после rewarded
  PAYER_REST_H:       72,     // §6.3.7: окно «покоя плательщика» после IAP

  /* --- Капы rewarded (06 §6.2). RW1/RW2 — по уровню (в game.js), без дн.капа. --- */
  RW_DAILY_CAP: { RW3: 2, RW4: 1, RW5: 3, RW6: 3 },

  /* --- Длительность оверлея-симуляции, c (задание: 3–5 c). --- */
  AD_SECONDS: { rewarded: 5, interstitial: 3 },

  /* --- Плейсменты (06 §6.2). name/desc — для оверлея и полки. --- */
  PLACEMENTS: {
    RW1:  { name: 'Второй шанс',        format: 'rewarded',     desc: 'Продолжить уровень из тупика (стол ≥ 60% чист)' },
    RW2:  { name: 'Удвоить награду',    format: 'rewarded',     desc: '×2 монеты за пройденный уровень' },
    RW3:  { name: 'Бустер до уровня',   format: 'rewarded',     desc: 'Бесплатный бустер в раздачу' },
    RW4:  { name: 'Колесо ярмарки',     format: 'rewarded',     desc: 'Крутить колесо за бонус монет' },
    RW5:  { name: '×2 жетоны ярмарки',  format: 'rewarded',     desc: 'Удвоить жетоны ивента (пт–вс)' },
    RW6:  { name: 'Кошелёк садовода',   format: 'rewarded',     desc: 'Пополнить монеты, когда баланс мал' },
    INT1: { name: 'Межуровневый',       format: 'interstitial', desc: 'Возврат на карту сада после победы' }
  },

  /* --- Тюнинг наград rewarded --- */
  RW6_GRANT_FACTOR: 0.8,      // §6.2: грант 0.8·E(n) монет
  RW4_WHEEL: [100, 200, 300, 500, 800, 1200],  // сектора колеса ярмарки (монеты)
  RW3_BOOSTERS: ['basket', 'joker'],           // что даёт бесплатный бустер
  RW5_TOKENS_COINS: 400,      // ×2 жетоны ≈ бонус монет (жетонов в прототипе нет)

  /* --- Подписка «Клуб садовода» и remove-ads (06 §6.4/§6.5) --- */
  CLUB_DAILY_COINS:   500,    // 500 монет/день на входе
  CLUB_HARVEST_BONUS: 0.5,    // +50% урожая
  REMOVE_ADS_BONUS:   500,    // +500 монет при покупке remove_ads

  /* --- Копилка piggy_greenhouse (06 §6.4) --- */
  PIGGY_RATE:   0.05,         // копит 5% от выигрышей монет
  PIGGY_UNLOCK: 4000,         // вскрытие от 4 000 монет
  PIGGY_CAP:    15000,        // cap 15 000

  /* --- Полка IAP (06 §6.4). price — USD (СИМУЛЯЦИЯ, деньги не списываются).
   *     Содержимое спеки, где нет прямого аналога в прототипе, отражено монетами/
   *     бустерами/карточками гербария (наиболее близкие ресурсы Прохода Б). --- */
  IAP: [
    { sku: 'coins_s',         price: 0.99,  kind: 'coins',      label: 'Горсть монет',        coins: 800,                          note: 'Порог входа, импульс' },
    { sku: 'starter_pack',    price: 2.99,  kind: 'bundle',     label: 'Стартовый набор',     coins: 2500, joker: 3, basket: 2, card: 1, once: true, note: 'Разово, окно D3–D21 · главный конвертер 1-го платежа' },
    { sku: 'piggy_greenhouse',price: 3.99,  kind: 'piggy',      label: 'Теплица-копилка',                                          note: 'Копит 5% выигрышей · вскрытие от 4000 · cap 15000' },
    { sku: 'coins_m',         price: 4.99,  kind: 'bundle',     label: 'Кошель монет',        coins: 4500, joker: 1,               note: 'Рабочая лошадка' },
    { sku: 'remove_ads',      price: 6.99,  kind: 'remove_ads', label: 'Убрать рекламу',      coins: 500,                          note: 'Навсегда · убирает interstitial (rewarded остаются) +500💰' },
    { sku: 'club_month',      price: 7.99,  kind: 'sub',        label: 'Клуб садовода',                                            note: 'Подписка/мес · без INT · +50% урожая · 500💰/день' },
    { sku: 'coins_l',         price: 9.99,  kind: 'bundle',     label: 'Сундук монет',        coins: 10000, joker: 3, basket: 3,    note: 'Основной объём выручки' },
    { sku: 'almanac_premium', price: 7.99,  kind: 'bundle',     label: 'Premium-альманах',    coins: 3000, card: 2,                note: 'Сезонный трек альманаха' },
    { sku: 'coins_xl',        price: 19.99, kind: 'bundle',     label: 'Кит-лайт',            coins: 22000, joker: 6, basket: 4, card: 1, note: '' },
    { sku: 'event_bundle',    price: 12.99, kind: 'bundle',     label: 'Ивентовый набор',     coins: 9000, basket: 2,               note: 'Ротация номиналов по E(n)' },
    { sku: 'coins_xxl',       price: 49.99, kind: 'bundle',     label: 'Кит',                 coins: 60000, joker: 9, basket: 9, card: 2, note: '' },
    { sku: 'coins_max',       price: 99.99, kind: 'bundle',     label: 'Топ-кит «Фонтан Марты»', coins: 130000, joker: 9, basket: 9, card: 3, note: 'Статус в лиге' }
  ]
};

window.Monetize = (function () {

  /* ============================== ХРАНИЛИЩЕ ============================== */
  function defaults() {
    return {
      v: 1,
      geoTier: 'tier1',                       // 'tier1' | 'tier23' (гео-переключатель)
      eventWeekend: false,                    // симуляция ивента пт–вс (для RW5)
      removeAds: false,                       // куплен remove_ads
      sub: { active: false, monthNo: 0, startTs: 0 },   // подписка «Клуб садовода»
      installTs: 0,                           // «дата установки» (для правила ≥24ч)
      piggy: { owned: false, balance: 0 },    // теплица-копилка
      club: { lastGrantDate: '' },            // дата последнего 500💰/день подписчику
      payer: { first: false, lastPurchaseTs: 0 },       // окно покоя плательщика
      daily: { date: '', int: 0, rw: {} },    // суточные капы (переживают перезагрузку)
      life: { adRevenue: 0, iapRevenue: 0, imps: {}, rev: {}, purchases: {} }  // lifetime
    };
  }

  function deepMerge(base, over) {
    if (over === null || over === undefined) return base;
    if (typeof base !== 'object' || Array.isArray(base) || base === null) {
      return over === undefined ? base : over;
    }
    var out = {}, k;
    for (k in base) out[k] = base[k];
    for (k in over) {
      if (k in base && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
          && over[k] && typeof over[k] === 'object' && !Array.isArray(over[k])) {
        out[k] = deepMerge(base[k], over[k]);
      } else if (over[k] !== undefined) {
        out[k] = over[k];
      }
    }
    return out;
  }

  function fin(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }

  function sanitize(st) {
    var d = defaults();
    if (st.geoTier !== 'tier1' && st.geoTier !== 'tier23') st.geoTier = 'tier1';
    st.removeAds = !!st.removeAds;
    st.eventWeekend = !!st.eventWeekend;
    if (!st.sub || typeof st.sub !== 'object') st.sub = d.sub;
    st.sub.active = !!st.sub.active;
    st.sub.monthNo = Math.max(0, Math.floor(fin(st.sub.monthNo, 0)));
    st.installTs = Math.max(0, fin(st.installTs, 0));
    if (!st.piggy || typeof st.piggy !== 'object') st.piggy = d.piggy;
    st.piggy.owned = !!st.piggy.owned;
    st.piggy.balance = Math.max(0, Math.min(MON.PIGGY_CAP, fin(st.piggy.balance, 0)));
    if (!st.club || typeof st.club !== 'object') st.club = d.club;
    if (!st.payer || typeof st.payer !== 'object') st.payer = d.payer;
    st.payer.first = !!st.payer.first;
    st.payer.lastPurchaseTs = Math.max(0, fin(st.payer.lastPurchaseTs, 0));
    if (!st.daily || typeof st.daily !== 'object') st.daily = d.daily;
    if (!st.daily.rw || typeof st.daily.rw !== 'object' || Array.isArray(st.daily.rw)) st.daily.rw = {};
    st.daily.int = Math.max(0, Math.floor(fin(st.daily.int, 0)));
    if (!st.life || typeof st.life !== 'object') st.life = d.life;
    st.life.adRevenue = Math.max(0, fin(st.life.adRevenue, 0));
    st.life.iapRevenue = Math.max(0, fin(st.life.iapRevenue, 0));
    if (!st.life.imps || typeof st.life.imps !== 'object') st.life.imps = {};
    if (!st.life.rev || typeof st.life.rev !== 'object') st.life.rev = {};
    if (!st.life.purchases || typeof st.life.purchases !== 'object') st.life.purchases = {};
    return st;
  }

  var state;
  (function load() {
    var raw = null;
    try { raw = localStorage.getItem(MON.STORE_KEY); } catch (e) { raw = null; }
    if (raw) {
      try { state = deepMerge(defaults(), JSON.parse(raw)); }
      catch (e) { state = defaults(); }
    } else {
      state = defaults();
    }
    sanitize(state);
  })();

  function save() {
    try { localStorage.setItem(MON.STORE_KEY, JSON.stringify(state)); }
    catch (e) { /* приватный режим / переполнение — продолжаем без сейва */ }
  }

  /* ---- Сессионные счётчики (in-memory, сбрасываются при перезагрузке) ---- */
  function freshSession() {
    return {
      adRevenue: 0, iapRevenue: 0,
      imps: {}, rev: {}, offers: {}, opps: {}, blocks: {},
      started: 0, completed: 0, failed: 0, purchases: 0,
      ecpmSum: { rewarded: 0, interstitial: 0 },
      ecpmN:   { rewarded: 0, interstitial: 0 },
      lastIntTs: 0, intSession: 0, levelsSinceInt: 99, lastRewardedCloseTs: 0,
      startTs: Date.now()
    };
  }
  var session = freshSession();

  /* ============================== УТИЛИТЫ ============================== */
  function bump(obj, key) { obj[key] = (obj[key] || 0) + 1; }
  function addRev(obj, key, v) { obj[key] = (obj[key] || 0) + v; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function sumVals(obj) { var s = 0; for (var k in obj) s += obj[k]; return s; }
  function sumRW(map) { var s = 0, a = ['RW1','RW2','RW3','RW4','RW5','RW6']; for (var i = 0; i < a.length; i++) s += (map[a[i]] || 0); return s; }
  function findIap(sku) { for (var i = 0; i < MON.IAP.length; i++) if (MON.IAP[i].sku === sku) return MON.IAP[i]; return null; }
  function A() { return window.Analytics; }
  function Ec() { return window.Economy; }

  function simOffset() {
    return (window.Store && window.Store.state && window.Store.state.stats
      && window.Store.state.stats.simDayOffset) || 0;
  }
  function nowMs() { return Date.now() + simOffset() * 86400000; }
  function today() {
    var dt = new Date(nowMs());
    var m = String(dt.getMonth() + 1).padStart(2, '0');
    var da = String(dt.getDate()).padStart(2, '0');
    return dt.getFullYear() + '-' + m + '-' + da;
  }
  function refreshDaily() {
    var t = today();
    if (state.daily.date !== t) { state.daily.date = t; state.daily.int = 0; state.daily.rw = {}; save(); }
  }

  /* ---- pub/sub: дашборд/полка перерисовываются на любое изменение ---- */
  var subs = [];
  function subscribe(fn) { if (typeof fn === 'function') subs.push(fn); }
  function notify() { for (var i = 0; i < subs.length; i++) { try { subs[i](); } catch (e) {} } }

  /* ---- лёгкий тост (собственный элемент, чтобы не конфликтовать с game.js) ---- */
  var toastEl = null, toastTimer = null;
  function ensureToast() {
    if (toastEl) return;
    toastEl = document.createElement('div');
    toastEl.id = 'mon-toast';
    document.body.appendChild(toastEl);
  }
  function gtoast(msg) {
    ensureToast();
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2100);
  }

  /* ============================== eCPM-МОДЕЛЬ (06 §6.7) ============================== */
  /* Случайная ставка вокруг бенчмарка выбранного гео. Rewarded «заполняется» не
   * ниже floor (высокий fill); interstitial возвращает сырую ставку — floor
   * проверяется отдельно правилом 6.3 п.8. */
  function rollEcpm(format) {
    var base = MON.ECPM[state.geoTier][format];
    var v = base * (1 + (Math.random() * 2 - 1) * MON.ECPM_SPREAD);
    if (format === 'rewarded') v = Math.max(MON.ECPM_FLOOR[state.geoTier].rewarded, v);
    return Math.max(0, v);
  }
  function geoLabel() { return state.geoTier === 'tier1' ? 'Tier-1' : 'Tier-2/3'; }

  /* ============================== ОВЕРЛЕЙ-СИМУЛЯЦИЯ ПОКАЗА ============================== */
  var adActive = false, adTimer = null;
  var adScreen, adPlace, adDesc, adCount, adNote, adClose, adTag;

  function ensureAdDom() {
    if (adScreen) return;
    adScreen = document.createElement('div');
    adScreen.id = 'ad-screen';
    adScreen.className = 'hidden';
    adScreen.innerHTML =
      '<div class="ad-box">' +
        '<div class="ad-simtag" id="ad-tag">СИМУЛЯЦИЯ РЕКЛАМЫ</div>' +
        '<div class="ad-icon">📺</div>' +
        '<div class="ad-place" id="ad-place">—</div>' +
        '<div class="ad-desc" id="ad-desc">—</div>' +
        '<div class="ad-count" id="ad-count">5</div>' +
        '<div class="ad-note" id="ad-note">в проде здесь показ AppLovin MAX / AdMob</div>' +
        '<button class="ad-close" id="ad-close" type="button" disabled>Реклама…</button>' +
      '</div>';
    document.body.appendChild(adScreen);
    adPlace = document.getElementById('ad-place');
    adDesc  = document.getElementById('ad-desc');
    adCount = document.getElementById('ad-count');
    adNote  = document.getElementById('ad-note');
    adClose = document.getElementById('ad-close');
    adTag   = document.getElementById('ad-tag');
  }

  /* Универсальный показ: pid — плейсмент, ecpm — ставка, onDone(success). */
  function showAd(pid, ecpm, onDone) {
    onDone = onDone || function () {};
    if (adActive) { onDone(false); return; }
    ensureAdDom();
    var p = MON.PLACEMENTS[pid], fmt = p.format;
    adActive = true;

    bump(session.offers, pid);
    try { A().track('ad_offer_shown', { placement_id: pid }); } catch (e) {}
    session.started++;
    try { A().track('ad_started', { placement_id: pid, network: 'sim' }); } catch (e) {}

    adTag.textContent = fmt === 'rewarded' ? 'СИМУЛЯЦИЯ · REWARDED' : 'СИМУЛЯЦИЯ · INTERSTITIAL';
    adPlace.textContent = p.name + ' · ' + geoLabel();
    adDesc.textContent = p.desc;
    adScreen.classList.remove('hidden');

    var failed = Math.random() < (MON.FAIL_RATE[fmt] || 0);
    if (failed) {
      adCount.textContent = '×';
      adNote.textContent = 'Реклама не загрузилась (fill < 100%) — награды нет';
      adClose.disabled = false;
      adClose.textContent = 'Закрыть';
      adClose.onclick = function () {
        if (!adActive) return;                     // защита от повторного клика/закрытия
        adScreen.classList.add('hidden'); adActive = false;
        session.failed++;
        try { A().track('ad_failed', { placement_id: pid, network: 'sim' }); } catch (e) {}
        notify(); onDone(false);
      };
      notify();
      return;
    }

    var secs = MON.AD_SECONDS[fmt] || 4, remain = secs;
    adCount.textContent = remain;
    adNote.textContent = 'в проде здесь показ AppLovin MAX / AdMob';
    adClose.disabled = true;
    adClose.textContent = 'Реклама… ' + remain + ' c';
    if (adTimer) clearInterval(adTimer);
    adTimer = setInterval(function () {
      remain--;
      if (remain > 0) { adCount.textContent = remain; adClose.textContent = 'Реклама… ' + remain + ' c'; return; }
      clearInterval(adTimer); adTimer = null;
      adCount.textContent = '✓';
      adClose.disabled = false;
      adClose.textContent = fmt === 'rewarded' ? 'Забрать награду ✓' : 'Закрыть ✕';
    }, 1000);

    adClose.onclick = function () {
      if (adTimer || !adActive) return;          // отсчёт не окончен ИЛИ уже закрыто (нет дубля награды)
      adScreen.classList.add('hidden'); adActive = false;
      session.completed++;
      bookImpression(pid, ecpm);
      try { A().track('ad_completed', { placement_id: pid, network: 'sim', ecpm_usd: round2(ecpm) }); } catch (e) {}
      if (fmt === 'rewarded') session.lastRewardedCloseTs = Date.now();
      notify(); onDone(true);
    };
    notify();
  }

  /* Запись выручки показа: eCPM/1000 в сессию и lifetime, счётчики по плейсменту. */
  function bookImpression(pid, ecpm) {
    var fmt = MON.PLACEMENTS[pid].format;
    var rev = ecpm / 1000;
    session.adRevenue += rev;
    bump(session.imps, pid); addRev(session.rev, pid, rev);
    session.ecpmSum[fmt] += ecpm; session.ecpmN[fmt] += 1;
    state.life.adRevenue += rev;
    bump(state.life.imps, pid); addRev(state.life.rev, pid, rev);
    save();
  }

  function trackOpportunity(pid, eligible, reason) {
    bump(session.opps, pid);
    if (!eligible) bump(session.blocks, reason || '?');
    try { A().track('ad_opportunity', { placement_id: pid, eligible: !!eligible, block_reason: reason || null }); } catch (e) {}
  }

  /* ============================== REWARDED (06 §6.2) ============================== */
  function rwUsedToday(pid) { refreshDaily(); return state.daily.rw[pid] || 0; }
  function bumpDaily(pid) { refreshDaily(); state.daily.rw[pid] = (state.daily.rw[pid] || 0) + 1; save(); }

  /* Разрешён ли rewarded по дневному капу/условиям (RW1/RW2 — по уровню в game.js). */
  function rewardedAllowed(pid) {
    if (pid === 'RW1' || pid === 'RW2') return true;
    if (pid === 'RW5' && !state.eventWeekend) return false;
    var cap = MON.RW_DAILY_CAP[pid];
    if (cap == null) return true;
    return rwUsedToday(pid) < cap;
  }

  /* Базовый показ rewarded: проверка капа → оффер → показ → onReward(success). */
  function showRewarded(pid, opts, onReward) {
    onReward = onReward || function () {};
    if (adActive) { onReward(false); return; }
    if (!rewardedAllowed(pid)) {
      trackOpportunity(pid, false, 'cap');
      gtoast('Лимит этой награды на сегодня исчерпан');
      onReward(false); return;
    }
    trackOpportunity(pid, true, null);
    var ecpm = rollEcpm('rewarded');
    showAd(pid, ecpm, function (success) {
      if (success && (pid in MON.RW_DAILY_CAP)) bumpDaily(pid);
      onReward(!!success);
    });
  }

  /* --- Самодостаточные rewarded-действия (награда внутри Monetize) --- */
  function rwWallet() {          // RW6 «Кошелёк садовода»: грант 0.8·E(n)
    var n = Ec().getLevel();
    var grant = Math.round((MON.RW6_GRANT_FACTOR * Ec().entryCost(n)) / 10) * 10;
    showRewarded('RW6', {}, function (ok) {
      if (!ok) return;
      Ec().addCoins(grant, 'rw6');
      gtoast('Кошелёк садовода: +' + grant + ' 💰');
      updateBarButtons();
    });
  }
  function rwBooster() {         // RW3 «Бустер до уровня»
    showRewarded('RW3', {}, function (ok) {
      if (!ok) return;
      var id = MON.RW3_BOOSTERS[Math.floor(Math.random() * MON.RW3_BOOSTERS.length)];
      var def = Ec().ECON.BOOSTERS[id];
      Ec().addBooster(id, 1, 'rw3');
      gtoast('Бустер за рекламу: +1 ' + def.emoji + ' ' + def.name);
    });
  }
  function rwWheel() {           // RW4 «Колесо ярмарки»
    showRewarded('RW4', {}, function (ok) {
      if (!ok) return;
      var v = MON.RW4_WHEEL[Math.floor(Math.random() * MON.RW4_WHEEL.length)];
      Ec().addCoins(v, 'rw4_wheel');
      gtoast('🎡 Колесо ярмарки: +' + v + ' 💰');
    });
  }
  function rwEventTokens(cb) {   // RW5 «×2 жетоны ярмарки» (ивент пт–вс)
    showRewarded('RW5', {}, function (ok) {
      if (ok) { Ec().addCoins(MON.RW5_TOKENS_COINS, 'rw5_tokens'); gtoast('×2 жетоны ярмарки: +' + MON.RW5_TOKENS_COINS + ' 💰'); }
      if (cb) cb(ok);
    });
  }

  /* ============================== INTERSTITIAL (06 §6.3) ============================== */
  function installAgeOk() {
    if (simOffset() >= 1) return true;           // «Новый день (тест)» из меты снимает гейт дня 1
    return state.installTs > 0 && (Date.now() - state.installTs) >= MON.INT_INSTALL_AGE_H * 3600000;
  }
  function payerRestActive() {
    return state.payer.lastPurchaseTs > 0 && (Date.now() - state.payer.lastPurchaseTs) < MON.PAYER_REST_H * 3600000;
  }

  /* Возвращает причину, по которой INT1 показывать НЕЛЬЗЯ (или null — можно). */
  function interstitialBlockReason() {
    if (state.removeAds) return 'remove_ads';                     // §6.3.7
    if (state.sub.active) return 'subscriber';                    // §6.3.7
    var lvl = Ec().getLevel();
    if (lvl < MON.INT_START_LEVEL) return 'уровень<' + MON.INT_START_LEVEL;   // §6.3.1
    if (!installAgeOk()) return 'установка<24ч';                  // §6.3.1
    if (session.levelsSinceInt < MON.INT_MIN_LEVELS) return 'уровней<' + MON.INT_MIN_LEVELS;  // §6.3.2
    if (session.lastIntTs > 0 && (Date.now() - session.lastIntTs) / 1000 < MON.INT_MIN_INTERVAL_S) return 'интервал<180c';  // §6.3.2
    refreshDaily();
    if ((state.daily.int || 0) >= MON.INT_DAILY_CAP) return 'дн.кап';         // §6.3.3
    if (session.intSession >= MON.INT_SESSION_CAP) return 'сессия-кап';       // §6.3.3
    if (session.lastRewardedCloseTs > 0 && (Date.now() - session.lastRewardedCloseTs) / 1000 < MON.REWARDED_FATIGUE_S) return 'усталость-rw';  // §6.3.6
    if (payerRestActive()) return 'покой-плательщика';            // §6.3.7
    return null;
  }

  /* INT1 на возврате к саду после победы (06 §6.2). Тихо пропускается при любом
   * нарушении правил §6.3 — вызывающий получает onDone() в любом случае. */
  function maybeInterstitial(onDone) {
    onDone = onDone || function () {};
    if (adActive) { onDone(); return; }
    var reason = interstitialBlockReason();
    var ecpm = null;
    if (!reason) {
      ecpm = rollEcpm('interstitial');
      if (ecpm < MON.ECPM_FLOOR[state.geoTier].interstitial) reason = 'eCPM-floor';   // §6.3.8
    }
    trackOpportunity('INT1', !reason, reason);
    if (reason) { onDone(); return; }
    showAd('INT1', ecpm, function (success) {
      if (success) {
        session.lastIntTs = Date.now();
        session.intSession++;
        session.levelsSinceInt = 0;
        refreshDaily(); state.daily.int++; save();
      }
      onDone();
    });
  }

  /* ============================== IAP / ПОДПИСКА (06 §6.4/§6.5) ============================== */
  function applyGrant(item) {
    if (item.coins)  Ec().addCoins(item.coins, 'iap');
    if (item.joker)  Ec().addBooster('joker', item.joker, 'iap');
    if (item.basket) Ec().addBooster('basket', item.basket, 'iap');
    if (item.card && window.Store) { window.Store.state.garden.cards += item.card; window.Store.save(); }
    if (item.kind === 'remove_ads') {
      state.removeAds = true;
      try { A().track('remove_ads_purchased', {}); } catch (e) {}
    }
    if (item.kind === 'sub') {
      state.sub.active = true;
      state.sub.monthNo = (state.sub.monthNo || 0) + 1;
      state.sub.startTs = Date.now();
      try { A().track('sub_state', { state: state.sub.monthNo > 1 ? 'renew' : 'start', month_no: state.sub.monthNo }); } catch (e) {}
      grantClubDailyIfDue();
    }
    if (item.kind === 'piggy') state.piggy.owned = true;
  }

  /* СИМУЛЯЦИЯ покупки: мгновенно, без денег/биллинга. Товар выдаётся, выручка
   * идёт в модель, плательщик помечается (окно покоя §6.3.7). */
  function buyIAP(sku) {
    var item = findIap(sku);
    if (!item) return false;
    if (item.once && (state.life.purchases[sku] || 0) > 0) { gtoast('Набор уже куплен (разовый)'); return false; }
    if (item.kind === 'remove_ads' && state.removeAds) { gtoast('Реклама уже убрана'); return false; }
    if (item.kind === 'piggy' && state.piggy.owned) { gtoast('Копилка уже активна'); return false; }

    var firstNow = !state.payer.first;
    try { A().track('iap_initiated', { sku: sku, price_usd: item.price, is_first_purchase: firstNow }); } catch (e) {}
    applyGrant(item);
    session.iapRevenue += item.price;
    session.purchases++;
    state.life.iapRevenue += item.price;
    bump(state.life.purchases, sku);
    state.payer.first = true;
    state.payer.lastPurchaseTs = Date.now();
    try { A().track('iap_success', { sku: sku, price_usd: item.price, is_first_purchase: firstNow }); } catch (e) {}
    save(); notify();
    gtoast('СИМУЛЯЦИЯ покупки: ' + item.label + ' ($' + item.price.toFixed(2) + ')');
    updateBarButtons();
    return true;
  }

  function cancelSub() {
    if (!state.sub.active) return;
    state.sub.active = false;                    // §6.5: декор остаётся, бонусы на паузу
    try { A().track('sub_state', { state: 'cancel', month_no: state.sub.monthNo }); } catch (e) {}
    save(); notify();
    gtoast('Подписка отменена (декор сохранён)');
  }

  function grantClubDailyIfDue() {
    if (!state.sub.active) return;
    var t = today();
    if (state.club.lastGrantDate === t) return;
    Ec().addCoins(MON.CLUB_DAILY_COINS, 'club');
    state.club.lastGrantDate = t;
    save();
  }

  function piggyBreak() {
    if (!state.piggy.owned || state.piggy.balance < MON.PIGGY_UNLOCK) return false;
    var amt = Math.round(state.piggy.balance);
    Ec().addCoins(amt, 'piggy');
    state.piggy.balance = 0; save(); notify();
    gtoast('Копилка вскрыта: +' + amt + ' 💰');
    return true;
  }

  /* ============================== ХУКИ ИЗ ЯДРА ============================== */
  function onCoinsWon(amount) {                  // копилка копит 5% выигрышей
    if (!state.piggy.owned || state.piggy.balance >= MON.PIGGY_CAP) return;
    var add = Math.round(Math.max(0, amount) * MON.PIGGY_RATE);
    if (add <= 0) return;
    state.piggy.balance = Math.min(MON.PIGGY_CAP, state.piggy.balance + add);
    save(); notify();
  }
  function onLevelFinished() { session.levelsSinceInt++; }
  function harvestMultiplier() { return state.sub.active ? (1 + MON.CLUB_HARVEST_BONUS) : 1; }
  function isAdsRemoved() { return !!state.removeAds; }
  function isSubscriber() { return !!state.sub.active; }
  function isEventWeekend() { return !!state.eventWeekend; }

  /* ============================== КНОПКА «КОШЕЛЁК» В ПАНЕЛИ БУСТЕРОВ ============================== */
  /* RW6 «Кошелёк садовода» — контекстная кнопка: видна, только когда баланс < 2·E(n)
   * (06 §6.2 «нужда») и дневной кап не исчерпан. */
  function updateBarButtons() {
    var w = document.getElementById('bst-wallet');
    if (!w) return;
    var n = Ec().getLevel();
    var need = Ec().getCoins() < 2 * Ec().entryCost(n);
    w.style.display = (need && rewardedAllowed('RW6')) ? '' : 'none';
  }

  /* ============================== ПОЛКА-ЭКРАН (IAP + rewarded-офферы) ============================== */
  var storeScreen, storeBody, storeInited = false;

  function ensureStoreDom() {
    if (storeScreen) return;
    storeScreen = document.createElement('div');
    storeScreen.id = 'store-screen';
    storeScreen.className = 'hidden';
    storeScreen.innerHTML =
      '<header id="store-top">' +
        '<button id="store-back" type="button">← Играть</button>' +
        '<div class="store-title">💎 Магазин</div>' +
        '<div class="store-geo" id="store-geo"></div>' +
      '</header>' +
      '<main id="store-body"></main>';
    document.body.appendChild(storeScreen);
    storeBody = document.getElementById('store-body');

    document.getElementById('store-back').addEventListener('click', closeStore);
    storeBody.addEventListener('click', onStoreClick);
    storeInited = true;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  function rwOfferCard(pid, action, cta) {
    var p = MON.PLACEMENTS[pid];
    var cap = MON.RW_DAILY_CAP[pid];
    var left = cap != null ? Math.max(0, cap - rwUsedToday(pid)) : null;
    var disabled = !rewardedAllowed(pid);
    var capNote = cap != null ? ('осталось сегодня: ' + left + '/' + cap) : 'без дневного лимита';
    return '<div class="offer-item">' +
      '<div class="offer-ico">📺</div>' +
      '<div class="offer-info"><div class="offer-name">' + esc(p.name) + ' <span class="rw-tag">' + pid + '</span></div>' +
      '<div class="offer-hint">' + esc(p.desc) + ' · ' + capNote + '</div></div>' +
      '<button class="offer-btn" data-act="' + action + '" ' + (disabled ? 'disabled' : '') + '>' +
      (disabled ? 'Лимит' : esc(cta)) + '</button></div>';
  }

  function renderStore() {
    var gEl = document.getElementById('store-geo');
    if (gEl) gEl.textContent = '🌍 ' + geoLabel();

    var html = '';
    html += '<div class="sim-banner">⚠ СИМУЛЯЦИЯ: рекламные сети и биллинг НЕ подключены. ' +
            'Покупки не списывают денег, «показ рекламы» — экранная заглушка. В проде — AppLovin MAX / AdMob и сторы.</div>';

    /* --- Бесплатно за рекламу (rewarded-офферы RW3/RW4/RW6/RW5) --- */
    html += '<h3 class="store-h">🎁 Бесплатно за рекламу (rewarded)</h3>';
    html += '<p class="store-sub">Rewarded — доминанта модели (цель 65–70% рекламной выручки, 06 §6.1). ' +
            'Это бонусы по желанию: подписка и remove-ads их НЕ убирают.</p>';
    html += rwOfferCard('RW6', 'rw-wallet',  'Смотреть');
    html += rwOfferCard('RW3', 'rw-booster', 'Смотреть');
    html += rwOfferCard('RW4', 'rw-wheel',   'Крутить');
    if (state.eventWeekend) html += rwOfferCard('RW5', 'rw-event', 'Смотреть');

    /* --- Подписка и remove-ads (06 §6.5) --- */
    html += '<h3 class="store-h">🚫 Без рекламы и подписка</h3>';
    // remove_ads
    var ra = findIap('remove_ads');
    html += '<div class="iap-item hi">' +
      '<div class="iap-ico">🚫</div>' +
      '<div class="iap-info"><div class="iap-name">' + esc(ra.label) + '</div>' +
      '<div class="iap-note">' + esc(ra.note) + '</div></div>' +
      (state.removeAds
        ? '<button class="iap-btn owned" disabled>Куплено ✓</button>'
        : '<button class="iap-btn" data-act="buy" data-sku="remove_ads">$' + ra.price.toFixed(2) + '</button>') +
      '</div>';
    // club_month
    var cm = findIap('club_month');
    html += '<div class="iap-item hi">' +
      '<div class="iap-ico">🌿</div>' +
      '<div class="iap-info"><div class="iap-name">' + esc(cm.label) + (state.sub.active ? ' <span class="rw-tag">мес ' + state.sub.monthNo + '</span>' : '') + '</div>' +
      '<div class="iap-note">' + esc(cm.note) + '</div></div>' +
      (state.sub.active
        ? '<button class="iap-btn ghost" data-act="sub-cancel">Отменить</button>'
        : '<button class="iap-btn" data-act="buy" data-sku="club_month">$' + cm.price.toFixed(2) + '/мес</button>') +
      '</div>';

    /* --- Копилка (06 §6.4) --- */
    var pg = findIap('piggy_greenhouse');
    html += '<h3 class="store-h">🐷 Копилка</h3>';
    html += '<div class="iap-item">' +
      '<div class="iap-ico">🪟</div>' +
      '<div class="iap-info"><div class="iap-name">' + esc(pg.label) +
        (state.piggy.owned ? ' <span class="rw-tag">' + Math.round(state.piggy.balance) + '/' + MON.PIGGY_CAP + '</span>' : '') + '</div>' +
      '<div class="iap-note">' + esc(pg.note) + '</div></div>';
    if (!state.piggy.owned) {
      html += '<button class="iap-btn" data-act="buy" data-sku="piggy_greenhouse">$' + pg.price.toFixed(2) + '</button>';
    } else if (state.piggy.balance >= MON.PIGGY_UNLOCK) {
      html += '<button class="iap-btn" data-act="piggy-break">Вскрыть 💰</button>';
    } else {
      html += '<button class="iap-btn owned" disabled>от ' + MON.PIGGY_UNLOCK + '</button>';
    }
    html += '</div>';

    /* --- Монеты и наборы (06 §6.4) --- */
    html += '<h3 class="store-h">🪙 Монеты и наборы</h3>';
    html += '<p class="store-sub">Персонализация номиналов — по E(n) игрока (06 §6.4). Цены США; в проде локализуются по матрице сторов.</p>';
    MON.IAP.forEach(function (item) {
      if (item.kind === 'remove_ads' || item.kind === 'sub' || item.kind === 'piggy') return;
      var bought = state.life.purchases[item.sku] || 0;
      var lock = item.once && bought > 0;
      html += '<div class="iap-item">' +
        '<div class="iap-ico">' + (item.price >= 49 ? '👑' : item.price >= 19 ? '💰' : item.price >= 9 ? '🧰' : '🪙') + '</div>' +
        '<div class="iap-info"><div class="iap-name">' + esc(item.label) +
          (item.once ? ' <span class="rw-tag">разово</span>' : '') + '</div>' +
        '<div class="iap-note">' + iapContents(item) + (item.note ? ' · ' + esc(item.note) : '') + '</div></div>' +
        (lock
          ? '<button class="iap-btn owned" disabled>Куплено ✓</button>'
          : '<button class="iap-btn" data-act="buy" data-sku="' + item.sku + '">$' + item.price.toFixed(2) + '</button>') +
        '</div>';
    });

    html += '<p class="store-foot">СИМУЛЯЦИЯ · Проход В · выручка каждого показа/покупки уходит в дашборд «📊 KPI».</p>';
    storeBody.innerHTML = html;
    storeBody.scrollTop = storeBody.scrollTop;   // no-op, сохраняем позицию
  }

  function iapContents(item) {
    var parts = [];
    if (item.coins)  parts.push('💰 ' + item.coins);
    if (item.joker)  parts.push('🃏 ' + item.joker);
    if (item.basket) parts.push('🧺 ' + item.basket);
    if (item.card)   parts.push('🃟 ' + item.card + ' карт.');
    return parts.join(' + ') || '—';
  }

  function onStoreClick(ev) {
    var b = ev.target.closest('[data-act]');
    if (!b || b.disabled) return;
    var act = b.getAttribute('data-act');
    if (act === 'buy') buyIAP(b.getAttribute('data-sku'));
    else if (act === 'rw-wallet') rwWallet();
    else if (act === 'rw-booster') rwBooster();
    else if (act === 'rw-wheel') rwWheel();
    else if (act === 'rw-event') rwEventTokens();
    else if (act === 'sub-cancel') cancelSub();
    else if (act === 'piggy-break') piggyBreak();
    renderStore();
  }

  function openStore() {
    ensureStoreDom();
    renderStore();
    storeScreen.classList.remove('hidden');
    document.body.classList.add('meta-open');
    try { A().track('shop_open', { source: 'button' }); } catch (e) {}
  }
  function closeStore() {
    if (!storeScreen) return;
    storeScreen.classList.add('hidden');
    document.body.classList.remove('meta-open');
    if (window.Game && window.Game.syncHud) window.Game.syncHud();
  }

  /* ============================== СТАТИСТИКА ДЛЯ ДАШБОРДА ============================== */
  function getStats() {
    var s = session;
    var total = s.adRevenue + s.iapRevenue;
    var rwImps = sumRW(s.imps), intImps = s.imps.INT1 || 0;
    var rwRev = sumRW(s.rev),  intRev = s.rev.INT1 || 0;
    return {
      adRev: s.adRevenue, iapRev: s.iapRevenue, blended: total,
      rewardedImps: rwImps, intImps: intImps, totalImps: rwImps + intImps,
      rewardedRev: rwRev, intRev: intRev,
      adShare: total > 0 ? s.adRevenue / total : 0,
      rewardedRevShare: s.adRevenue > 0 ? rwRev / s.adRevenue : 0,
      ecpmRw:  s.ecpmN.rewarded     > 0 ? s.ecpmSum.rewarded / s.ecpmN.rewarded : 0,
      ecpmInt: s.ecpmN.interstitial > 0 ? s.ecpmSum.interstitial / s.ecpmN.interstitial : 0,
      opps: sumVals(s.opps), offers: sumVals(s.offers),
      started: s.started, completed: s.completed, failed: s.failed,
      blocks: s.blocks, imps: s.imps, rev: s.rev,
      purchases: s.purchases, payer: state.payer.first,
      arppu: s.purchases > 0 ? s.iapRevenue : 0,
      minutes: (Date.now() - s.startTs) / 60000,
      geo: state.geoTier, event: state.eventWeekend,
      removeAds: state.removeAds, sub: state.sub.active, subMonth: state.sub.monthNo,
      piggy: { owned: state.piggy.owned, balance: state.piggy.balance },
      life: state.life
    };
  }

  function setGeo(t) { if (t === 'tier1' || t === 'tier23') { state.geoTier = t; save(); notify(); } }
  function getGeo() { return state.geoTier; }
  function setEvent(on) { state.eventWeekend = !!on; save(); notify(); }
  function resetSession() { session = freshSession(); notify(); }

  /* ============================== ИНИЦИАЛИЗАЦИЯ ============================== */
  function init() {
    ensureAdDom();
    ensureToast();
    if (!state.installTs) { state.installTs = Date.now(); save(); }
    refreshDaily();
    grantClubDailyIfDue();

    var storeBtn = document.getElementById('btn-store');
    if (storeBtn) storeBtn.addEventListener('click', openStore);
    var walletBtn = document.getElementById('bst-wallet');
    if (walletBtn) walletBtn.addEventListener('click', rwWallet);

    Ec().subscribe(updateBarButtons);
    subscribe(updateBarButtons);
    updateBarButtons();
  }

  return {
    MON: MON,
    init: init,
    /* реклама */
    showRewarded: showRewarded, maybeInterstitial: maybeInterstitial,
    rwWallet: rwWallet, rwBooster: rwBooster, rwWheel: rwWheel, rwEventTokens: rwEventTokens,
    /* IAP / подписка */
    buyIAP: buyIAP, cancelSub: cancelSub, piggyBreak: piggyBreak, openStore: openStore, closeStore: closeStore,
    /* хуки ядра */
    onCoinsWon: onCoinsWon, onLevelFinished: onLevelFinished,
    harvestMultiplier: harvestMultiplier,
    isAdsRemoved: isAdsRemoved, isSubscriber: isSubscriber, isEventWeekend: isEventWeekend,
    /* дашборд/контролы */
    getStats: getStats, setGeo: setGeo, getGeo: getGeo, setEvent: setEvent,
    resetSession: resetSession, subscribe: subscribe,
    updateBarButtons: updateBarButtons
  };
})();
