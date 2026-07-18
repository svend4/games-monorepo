/**
 * MetaUi — DOM мета-экран (Проход Е.1, порт DOM-части prototype/meta.js):
 * полноэкранный оверлей с вкладками Атлас / Дневной / Копилка / Миссии,
 * бейдж «есть что забрать» на кнопке 🗺️ HUD. Логика — src/meta/meta.ts.
 * Разметка вкладок 1:1 с прототипом; стили — index.html.
 */
import type { CoreGame } from '../core/game';
import { ECON } from '../economy/econ';
import type { Economy } from '../economy/economy';
import { getLocale, setLocale, t, tPlural, type Locale } from '../i18n';
import { missionText, regionName, themeLabel } from '../i18n/labels';
import type { Meta } from '../meta/meta';
import { REGIONS, STREAK_MILESTONE_DAYS, missionDef } from '../meta/config';

export interface MetaUiDeps {
  meta: Meta;
  economy: Economy;
  game: CoreGame;
  /** Тост в игровом экране (GridUi.toast). */
  toast: (msg: string) => void;
}

type TabId = 'atlas' | 'daily' | 'piggy' | 'missions';

export class MetaUi {
  /** «Играть дневной кроссворд» (GridUi.startDaily). */
  onPlayDaily: (() => void) | null = null;
  /**
   * Гейт открытия копилки (Проход Е.2): rewarded RV-5 перед конвертацией
   * (подписка/Remove Ads открывают бесплатно). null — Е.1-поведение
   * (бесплатное открытие через Economy).
   */
  piggyOpener: (() => Promise<number>) | null = null;
  /** «Пройти обучение снова» из настроек меты (Проход Ж.1, OnboardingUi). */
  onReplayOnboarding: (() => void) | null = null;
  /**
   * Переключатель «Звук: вкл/выкл» в настройках (Проход З): мост к GameAudio
   * (назначает main.ts). null — кнопка рендерится, но клик — no-op.
   */
  soundControl: { isEnabled(): boolean; setEnabled(on: boolean): void } | null = null;

  private scr: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private isOpen = false;
  private currentTab: TabId = 'atlas';

  constructor(private readonly deps: MetaUiDeps) {}

  mount(): void {
    this.deps.meta.onChanged = () => {
      this.updateBadge();
      if (this.isOpen) this.renderTab();
    };
    this.updateBadge();
  }

  /* ============================ ЭКРАН ============================ */

  private buildScreen(): void {
    if (this.scr !== null) return;
    const scr = document.createElement('div');
    scr.id = 'meta-screen';
    scr.className = 'hidden';
    const loc = getLocale();
    scr.innerHTML =
      '<header class="meta-header">' +
      '<div class="meta-cur"><span class="c-coin">🪙 <b id="meta-coins">0</b></span>' +
      '<span class="c-acorn">🌰 <b id="meta-acorns">0</b></span></div>' +
      '<button class="meta-close" data-action="close">' + t('meta.close') + '</button>' +
      '</header>' +
      '<nav class="meta-tabs">' +
      '<button data-tab="atlas">' + t('meta.tabAtlas') + '</button>' +
      '<button data-tab="daily">' + t('meta.tabDaily') + '</button>' +
      '<button data-tab="piggy">' + t('meta.tabPiggy') + '</button>' +
      '<button data-tab="missions">' + t('meta.tabMissions') + '</button>' +
      '</nav>' +
      '<div id="meta-content"></div>' +
      // Настройки (Проход Ж.1): язык RU/EN + повтор FTUE. Смена языка
      // применяется ПЕРЕЗАГРУЗКОЙ страницы (см. src/i18n/index.ts — выбор
      // задокументирован: строки рендерятся при монтировании, reload проще
      // и надёжнее «горячей» смены; сейвы не затрагиваются).
      '<div class="meta-settings" title="' + t('settings.langNote') + '">' +
      '<span class="settings-label">' + t('settings.language') + ':</span>' +
      '<span class="lang-switch">' +
      '<button type="button" data-action="lang-ru"' + (loc === 'ru' ? ' class="active"' : '') + '>RU</button>' +
      '<button type="button" data-action="lang-en"' + (loc === 'en' ? ' class="active"' : '') + '>EN</button>' +
      '</span>' +
      // Звук (Проход З): вкл/выкл рядом с языком, персист — GameAudio.
      '<span class="settings-label">' + t('settings.sound') + ':</span>' +
      '<button type="button" class="meta-ob-replay" data-action="toggle-sound">' +
      this.soundLabel() + '</button>' +
      '<button type="button" class="meta-ob-replay" data-action="replay-onboarding">' +
      t('settings.replayOnboarding') + '</button>' +
      '</div>';
    (document.getElementById('app') ?? document.body).appendChild(scr);
    this.scr = scr;
    this.contentEl = scr.querySelector('#meta-content');

    // Навигация по вкладкам (создаётся один раз).
    for (const btn of Array.from(scr.querySelectorAll<HTMLButtonElement>('.meta-tabs button'))) {
      btn.addEventListener('click', () => {
        this.currentTab = (btn.getAttribute('data-tab') as TabId | null) ?? 'atlas';
        this.renderTab();
      });
    }
    // Делегирование действий внутри контента и хедера.
    scr.addEventListener('click', (e) => {
      let t = e.target as HTMLElement | null;
      while (t !== null && t !== scr && t.getAttribute('data-action') === null) {
        t = t.parentElement;
      }
      if (t === null || t === scr) return;
      this.handleAction(t.getAttribute('data-action') ?? '', t);
    });
  }

  private handleAction(action: string, el: HTMLElement): void {
    const { economy, meta } = this.deps;
    if (action === 'close' || action === 'play-current') {
      this.close();
    } else if (action === 'play-daily') {
      this.close();
      this.onPlayDaily?.();
    } else if (action === 'open-piggy') {
      if (this.piggyOpener !== null) {
        // Проход Е.2: копилка за rewarded RV-5 (подписчику — бесплатно).
        void this.piggyOpener()
          .then((got) => {
            this.renderTab();
            this.updateBadge();
            if (got > 0) this.deps.toast(t('toast.piggyOpened', { n: got }));
          })
          .catch(() => undefined);
        return;
      }
      const got = economy.openPiggy();
      this.renderTab();
      this.updateBadge();
      if (got > 0) this.deps.toast(t('toast.piggyOpened', { n: got }));
    } else if (action === 'claim-mission') {
      meta.claimMission(el.getAttribute('data-id') ?? '');
    } else if (action === 'lang-ru' || action === 'lang-en') {
      this.switchLocale(action === 'lang-ru' ? 'ru' : 'en');
    } else if (action === 'toggle-sound') {
      // Звук (Проход З): мгновенное применение + персист в GameAudio.
      const sc = this.soundControl;
      if (sc !== null) {
        sc.setEnabled(!sc.isEnabled());
        el.textContent = this.soundLabel();
      }
    } else if (action === 'replay-onboarding') {
      this.close();
      this.onReplayOnboarding?.();
    }
  }

  /** Подпись кнопки звука по текущему состоянию (по умолчанию — вкл). */
  private soundLabel(): string {
    const on = this.soundControl === null || this.soundControl.isEnabled();
    return t(on ? 'settings.soundOn' : 'settings.soundOff');
  }

  /** Смена языка: персист + reload (применение к уже отрисованному UI). */
  private switchLocale(locale: Locale): void {
    if (locale === getLocale()) return;
    setLocale(locale);
    window.location.reload();
  }

  /* ============================ РЕНДЕР ВКЛАДОК ============================ */

  private renderTab(): void {
    const scr = this.scr;
    const content = this.contentEl;
    if (scr === null || content === null) return;
    for (const btn of Array.from(scr.querySelectorAll<HTMLButtonElement>('.meta-tabs button'))) {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === this.currentTab);
    }
    const coinsEl = scr.querySelector('#meta-coins');
    const acornEl = scr.querySelector('#meta-acorns');
    if (coinsEl !== null) coinsEl.textContent = String(this.deps.game.getCoins());
    if (acornEl !== null) acornEl.textContent = String(this.deps.economy.getAcorns());

    if (this.currentTab === 'atlas') content.innerHTML = this.renderAtlas();
    else if (this.currentTab === 'daily') content.innerHTML = this.renderDaily();
    else if (this.currentTab === 'piggy') content.innerHTML = this.renderPiggy();
    else content.innerHTML = this.renderMissions();
  }

  private renderAtlas(): string {
    const { meta, game } = this.deps;
    const done = meta.levelsDone();
    const total = game.getTotalLevels();
    let html =
      '<div class="meta-pane">' +
      '<p class="pane-sub">' + t('atlas.progress', { done: Math.min(done, total), total }) + '</p>';
    for (const region of REGIONS) {
      let rd = 0;
      for (const lvl of region.levels) if (lvl < done) rd++;
      const pct = Math.round((rd / region.levels.length) * 100);
      const claimed = !!meta.state.regions.claimed[region.id];
      html +=
        '<div class="region-card">' +
        '<div class="region-head"><span class="region-emoji">' + region.emoji + '</span>' +
        '<span class="region-name">' + regionName(region.id, region.name) + '</span>' +
        '<span class="region-pct">' + pct + '%</span></div>' +
        '<div class="region-nodes">';
      for (const lvl of region.levels) {
        let cls = 'node';
        let label = String(lvl + 1);
        if (lvl < done) {
          cls += ' node-done';
          label = '✓';
        } else if (lvl === done) {
          cls += ' node-current';
        } else {
          cls += ' node-locked';
        }
        const act = lvl === done && done < total ? ' data-action="play-current"' : '';
        html += '<span class="' + cls + '"' + act + '>' + label + '</span>';
      }
      html +=
        '</div>' +
        '<div class="region-reward">' +
        (claimed
          ? t('atlas.regionClaimed', { n: ECON.REGION_REWARD })
          : t('atlas.regionReward', { n: ECON.REGION_REWARD })) +
        '</div></div>';
    }
    if (done < total) {
      html += '<button class="meta-primary" data-action="play-current">' + t('atlas.continue', { n: done + 1 }) + '</button>';
    } else {
      html += '<p class="pane-sub">' + t('atlas.done') + '</p>';
    }
    return html + '</div>';
  }

  private renderDaily(): string {
    const { meta } = this.deps;
    const done = meta.isDailyDoneToday();
    const streak = meta.state.daily.streak;
    const nm = meta.nextMilestone(streak);
    let html =
      '<div class="meta-pane">' +
      '<div class="daily-hero"><div class="daily-theme">' + t('daily.themeLabel') + ': <b>' +
      themeLabel(meta.todayTheme()) + '</b></div>' +
      '<div class="daily-streak">🔥 <b>' + streak + '</b> ' +
      tPlural(streak, 'plural.day.one', 'plural.day.few', 'plural.day.many') +
      ' ' + t('daily.inARow') + '</div>' +
      '<div class="daily-longest">' + t('daily.longest', { n: meta.state.daily.longest }) + '</div></div>';
    html += '<div class="milestones">';
    for (const days of STREAK_MILESTONE_DAYS) {
      const reached = streak >= days;
      html +=
        '<div class="ms-node' + (reached ? ' ms-reached' : '') + '">' +
        '<div class="ms-day">' + t('daily.msDay', { n: days }) + '</div>' +
        '<div class="ms-rew">+' + (ECON.STREAK_MILESTONES[days] ?? 0) + ' 🪙</div></div>';
    }
    html += '</div>';
    if (nm !== null) html += '<p class="pane-sub">' + t('daily.nextMilestone', { n: nm }) + '</p>';
    html += '<p class="pane-sub">' + t('daily.rewardInfo', { n: ECON.DAILY_COINS }) + '</p>';
    if (done) {
      html += '<div class="daily-done">' + t('daily.doneToday') + '</div>';
    } else {
      html += '<button class="meta-primary" data-action="play-daily">' + t('daily.play') + '</button>';
    }
    return html + '</div>';
  }

  private renderPiggy(): string {
    const { economy } = this.deps;
    const acorns = economy.getAcorns();
    const cap = economy.getCap();
    const pct = Math.round((acorns / cap) * 100);
    let html =
      '<div class="meta-pane">' +
      '<div class="piggy-emoji">🐿️</div>' +
      '<div class="piggy-count"><b>' + acorns + '</b> / ' + cap + ' 🌰</div>' +
      '<div class="piggy-bar"><div class="piggy-fill" style="width:' + pct + '%"></div></div>';
    if (economy.isPiggyFull()) html += '<p class="pane-warn">' + t('piggy.full') + '</p>';
    html +=
      '<p class="pane-sub">' + t('piggy.info', { n: ECON.ACORN_PER_BONUS }) + '</p>' +
      '<p class="pane-note">' + t('piggy.prodNote') + '</p>';
    if (acorns > 0) {
      html += '<button class="meta-primary" data-action="open-piggy">' + t('piggy.open', { n: acorns }) + '</button>';
    } else {
      html += '<div class="daily-done">' + t('piggy.empty') + '</div>';
    }
    return html + '</div>';
  }

  private renderMissions(): string {
    const { meta } = this.deps;
    meta.ensureMissionsToday();
    let html = '<div class="meta-pane"><p class="pane-sub">' + t('missions.sub') + '</p>';
    for (const row of meta.state.missions.list) {
      const def = missionDef(row.id);
      if (def === null) continue;
      const prog = Math.min(row.progress, def.target);
      const pct = Math.round((prog / def.target) * 100);
      const reward = '+' + def.coins + ' 🪙' + (def.acorns > 0 ? ' +' + def.acorns + ' 🌰' : '');
      html +=
        '<div class="mission-card' + (row.claimed ? ' mission-claimed' : '') + '">' +
        '<div class="mission-top"><span class="mission-emoji">' + def.emoji + '</span>' +
        '<span class="mission-text">' + missionText(def.id, def.text) + '</span></div>' +
        '<div class="mission-bar"><div class="mission-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="mission-foot"><span class="mission-prog">' + prog + '/' + def.target + '</span>' +
        '<span class="mission-rew">' + reward + '</span>';
      if (row.claimed) html += '<span class="mission-state">' + t('missions.claimed') + '</span>';
      else if (prog >= def.target) {
        html += '<button class="mission-claim" data-action="claim-mission" data-id="' + def.id + '">' +
          t('missions.claim') + '</button>';
      } else html += '<span class="mission-state">' + t('missions.inProgress') + '</span>';
      html += '</div></div>';
    }
    return html + '</div>';
  }

  /* ============================ БЕЙДЖ / ОТКРЫТИЕ ============================ */

  updateBadge(): void {
    const btn = document.getElementById('btn-meta');
    if (btn === null) return;
    btn.classList.toggle('has-badge', this.deps.meta.anyActionable());
  }

  open(tab?: string): void {
    this.buildScreen();
    this.deps.meta.ensureMissionsToday();
    if (tab === 'atlas' || tab === 'daily' || tab === 'piggy' || tab === 'missions') {
      this.currentTab = tab;
    }
    this.isOpen = true;
    this.scr?.classList.remove('hidden');
    this.renderTab();
    this.updateBadge();
  }

  close(): void {
    this.isOpen = false;
    this.scr?.classList.add('hidden');
  }
}
