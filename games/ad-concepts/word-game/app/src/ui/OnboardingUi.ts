/**
 * OnboardingUi — FTUE-онбординг первого запуска (Проход Ж.1, порт
 * prototype/onboarding.js 1:1 в строгий TS).
 *
 * Оверлей коуч-марок по шагам FTUE главы 07 §4 («первые 5 минут»): протяжка
 * по колесу → первое слово, открытие клетки сетки, бонусное слово → жёлуди,
 * подсказка (Лампа) и ГДЕ живёт апселл подписки — с честной оговоркой
 * «не в первую сессию» (01 §3, 06 §5.1, 07 §4.2).
 *
 * РЕЛИЗНЫЙ СЛОЙ, НЕ ЛОМАЮЩИЙ ЯДРО: модуль самодостаточен — сам вставляет
 * свой <style>, свою кнопку «❔ пройти обучение снова» в HUD (#hud-right) и
 * свой оверлей. Не трогает ядро/мету/монетизацию и их сейвы; владеет ТОЛЬКО
 * своим ключом localStorage `wordgrove.onboarding.v1` — ТОТ ЖЕ ключ и схема
 * флага `{done:true,v:1,ts}` что у прототипа: сейв прототипа подхватывается,
 * обучение не показывается повторно. Отсутствие ключа = первый запуск.
 *
 * Геометрия подсветки берётся с РЕАЛЬНЫХ DOM-элементов порта
 * (#wheel-area, #grid-area, #hud-acorns, #btn-hint, #btn-shop — как прототип
 * делал с глобалов); Phaser-колесо подсвечивается через его DOM-контейнер.
 * Все строки — через t() (словарь ob.* в src/i18n).
 *
 * В среде без DOM (vitest/node) mount()/start() — no-op; логика флага
 * (isDone/finish/reset) работает через инжектируемый KeyValueStorage.
 */
import { defaultStorage, type KeyValueStorage } from '../core/storage';
import { t, type TranslationKey } from '../i18n';

/** ТОТ ЖЕ ключ, что у прототипа (совместимость сейва FTUE). */
export const ONBOARDING_FLAG_KEY = 'wordgrove.onboarding.v1';

/** Дать лэйауту устаканиться после старта ядра (порт SHOW_DELAY_MS). */
const SHOW_DELAY_MS = 500;
const ACCENT = '#ffd54f';

/** Шаг FTUE: id элемента-цели (null — центрированный шаг) + ключи строк. */
interface StepDef {
  readonly target: string | null;
  readonly titleKey: TranslationKey;
  readonly bodyKey: TranslationKey;
}

/** Порядок и цели — 1:1 с прототипом (07 §4 «первые 5 минут»). */
const STEPS: readonly StepDef[] = [
  { target: null, titleKey: 'ob.s1.title', bodyKey: 'ob.s1.body' },
  { target: 'wheel-area', titleKey: 'ob.s2.title', bodyKey: 'ob.s2.body' },
  { target: 'grid-area', titleKey: 'ob.s3.title', bodyKey: 'ob.s3.body' },
  { target: 'hud-acorns', titleKey: 'ob.s4.title', bodyKey: 'ob.s4.body' },
  { target: 'btn-hint', titleKey: 'ob.s5.title', bodyKey: 'ob.s5.body' },
  { target: 'btn-shop', titleKey: 'ob.s6.title', bodyKey: 'ob.s6.body' },
  { target: null, titleKey: 'ob.s7.title', bodyKey: 'ob.s7.body' }
];

interface OverlayEls {
  root: HTMLElement;
  scrim: HTMLElement;
  ring: HTMLElement;
  card: HTMLElement;
  step: HTMLElement;
  title: HTMLElement;
  body: HTMLElement;
  skip: HTMLButtonElement;
  back: HTMLButtonElement;
  next: HTMLButtonElement;
  dots: HTMLElement[];
}

export interface OnboardingDeps {
  storage?: KeyValueStorage;
  /** Трекер ftue_step (09 §2); в main — Analytics.track. */
  track?: (event: string, params?: Record<string, string | number | boolean>) => void;
}

export class OnboardingUi {
  private readonly storage: KeyValueStorage;
  private readonly track: (event: string, params?: Record<string, string | number | boolean>) => void;

  private els: OverlayEls | null = null;
  private idx = 0;
  private active = false;

  /* Слушатели держим как поля — removeEventListener в finish() (порт 1:1). */
  private readonly onResize = (): void => {
    if (this.active) this.positionStep();
  };
  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.active) return;
    if (e.key === 'Escape') this.finish();
    else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      if (this.idx >= STEPS.length - 1) this.finish();
      else this.go(this.idx + 1);
    } else if (e.key === 'ArrowLeft') this.go(this.idx - 1);
  };

  constructor(deps: OnboardingDeps = {}) {
    this.storage = deps.storage ?? defaultStorage();
    this.track = deps.track ?? (() => undefined);
  }

  /* ============================ ФЛАГ (сейв) ============================ */

  /** Обучение уже пройдено (схема прототипа: {done:true,...}). */
  isDone(): boolean {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(ONBOARDING_FLAG_KEY);
    } catch {
      return false;
    }
    if (raw === null || raw === '') return false;
    try {
      const o: unknown = JSON.parse(raw);
      return typeof o === 'object' && o !== null && (o as { done?: unknown }).done === true;
    } catch {
      return false;
    }
  }

  private markDone(): void {
    try {
      this.storage.setItem(ONBOARDING_FLAG_KEY, JSON.stringify({ done: true, v: 1, ts: Date.now() }));
    } catch {
      /* приватный режим / переполнение — молча, онбординг не критичен */
    }
  }

  /** Сброс флага (отладка/тесты) — обучение покажется снова при init. */
  reset(): void {
    try {
      if (this.storage.removeItem !== undefined) this.storage.removeItem(ONBOARDING_FLAG_KEY);
      else this.storage.setItem(ONBOARDING_FLAG_KEY, JSON.stringify({ done: false }));
    } catch {
      /* некритично */
    }
  }

  /* ============================ МОНТАЖ ============================ */

  /**
   * Инъекция стилей + кнопки «❔» в HUD; автозапуск тура при первом запуске
   * (через SHOW_DELAY_MS). Вызывается из main ПОСЛЕ построения HUD.
   */
  mount(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    this.injectStyle();
    this.injectHelpButton();
    if (!this.isDone()) {
      window.setTimeout(() => this.start(false), SHOW_DELAY_MS);
    }
  }

  private injectStyle(): void {
    if (document.getElementById('wg-ob-style') !== null) return;
    // CSS 1:1 из прототипа onboarding.js (инъекция — слой самодостаточен).
    const css =
      '#wg-ob{position:fixed;inset:0;z-index:9999;pointer-events:auto;' +
      'font-family:"Segoe UI",system-ui,-apple-system,Roboto,sans-serif;}' +
      '#wg-ob.wg-ob-hidden{display:none;}' +
      '.wg-ob-scrim{position:absolute;inset:0;background:rgba(15,40,18,0.62);pointer-events:none;}' +
      '.wg-ob-ring{position:absolute;border:3px solid ' + ACCENT + ';border-radius:14px;' +
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
    const st = document.createElement('style');
    st.id = 'wg-ob-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /** Кнопка «пройти обучение снова» в HUD (порт injectHelpButton). */
  private injectHelpButton(): void {
    if (document.getElementById('btn-help') !== null) return;
    const host = document.getElementById('hud-right');
    if (host === null) return;
    const btn = document.createElement('button');
    btn.id = 'btn-help';
    btn.type = 'button';
    btn.title = t('ob.helpTitle');
    btn.textContent = '❔';
    btn.addEventListener('click', () => this.start(true));
    host.appendChild(btn);
  }

  /* ============================ ОВЕРЛЕЙ ============================ */

  private buildOverlay(): void {
    if (this.els !== null) return;
    const root = document.createElement('div');
    root.id = 'wg-ob';
    root.className = 'wg-ob-hidden';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', t('ob.ariaLabel'));

    const scrim = document.createElement('div');
    scrim.className = 'wg-ob-scrim';

    const ring = document.createElement('div');
    ring.className = 'wg-ob-ring';
    ring.style.display = 'none';

    const card = document.createElement('div');
    card.className = 'wg-ob-card';

    const stepEl = document.createElement('div');
    stepEl.className = 'wg-ob-step';
    const titleEl = document.createElement('h3');
    titleEl.className = 'wg-ob-title';
    const bodyEl = document.createElement('p');
    bodyEl.className = 'wg-ob-body';

    const actions = document.createElement('div');
    actions.className = 'wg-ob-actions';
    const skipBtn = document.createElement('button');
    skipBtn.className = 'wg-ob-skip';
    skipBtn.type = 'button';
    skipBtn.textContent = t('ob.skip');
    const spacer = document.createElement('span');
    spacer.className = 'wg-ob-spacer';
    const backBtn = document.createElement('button');
    backBtn.className = 'wg-ob-back';
    backBtn.type = 'button';
    backBtn.textContent = t('ob.back');
    const nextBtn = document.createElement('button');
    nextBtn.className = 'wg-ob-next';
    nextBtn.type = 'button';
    nextBtn.textContent = t('ob.next');
    actions.appendChild(skipBtn);
    actions.appendChild(spacer);
    actions.appendChild(backBtn);
    actions.appendChild(nextBtn);

    const progress = document.createElement('div');
    progress.className = 'wg-ob-progress';
    const dots: HTMLElement[] = [];
    for (let i = 0; i < STEPS.length; i++) {
      const d = document.createElement('span');
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

    skipBtn.addEventListener('click', () => this.finish());
    backBtn.addEventListener('click', () => this.go(this.idx - 1));
    nextBtn.addEventListener('click', () => {
      if (this.idx >= STEPS.length - 1) this.finish();
      else this.go(this.idx + 1);
    });

    this.els = {
      root,
      scrim,
      ring,
      card,
      step: stepEl,
      title: titleEl,
      body: bodyEl,
      skip: skipBtn,
      back: backBtn,
      next: nextBtn,
      dots
    };
  }

  /** Позиционирование подсветки + карточки под текущий шаг (порт 1:1):
   * прямоугольник берётся с реального DOM-элемента порта. */
  private positionStep(): void {
    const els = this.els;
    if (els === null) return;
    const step = STEPS[this.idx];
    const target = step.target !== null ? document.getElementById(step.target) : null;
    const rect = target !== null ? target.getBoundingClientRect() : null;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const pad = 8;

    els.card.style.display = 'block';

    if (rect !== null && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < vh) {
      els.ring.style.display = 'block';
      els.scrim.style.display = 'none';
      els.ring.style.left = rect.left - pad + 'px';
      els.ring.style.top = rect.top - pad + 'px';
      els.ring.style.width = rect.width + pad * 2 + 'px';
      els.ring.style.height = rect.height + pad * 2 + 'px';

      const ch = els.card.offsetHeight;
      const below = rect.top + rect.height / 2 < vh * 0.5;
      let top = below ? rect.bottom + pad + 14 : rect.top - pad - 14 - ch;
      top = Math.max(10, Math.min(top, vh - ch - 10));
      els.card.style.top = top + 'px';
    } else {
      // центрированный шаг (или цель вне вьюпорта) — полный дим, карточка по центру
      els.ring.style.display = 'none';
      els.scrim.style.display = 'block';
      const ch2 = els.card.offsetHeight;
      els.card.style.top = Math.max(10, (vh - ch2) / 2) + 'px';
    }
  }

  private render(): void {
    const els = this.els;
    if (els === null) return;
    const step = STEPS[this.idx];
    els.step.textContent = t('ob.step', { n: this.idx + 1, total: STEPS.length });
    els.title.textContent = t(step.titleKey);
    els.body.textContent = t(step.bodyKey);
    els.back.style.visibility = this.idx === 0 ? 'hidden' : 'visible';
    const last = this.idx === STEPS.length - 1;
    els.next.textContent = last ? t('ob.startGame') : t('ob.next');
    els.skip.style.display = last ? 'none' : '';
    for (let i = 0; i < els.dots.length; i++) {
      els.dots[i].className = 'wg-ob-dot' + (i === this.idx ? ' on' : '');
    }
    this.positionStep();
    try {
      els.next.focus();
    } catch {
      /* фокус некритичен */
    }
    // Лёгкий трекинг ftue_step (09 §2) — как прототип через window.Economy.track.
    this.track('ftue_step', { step: this.idx + 1, of: STEPS.length, id: step.target ?? 'intro' });
  }

  private go(i: number): void {
    this.idx = Math.max(0, Math.min(i, STEPS.length - 1));
    this.render();
  }

  /* ============================ ЗАПУСК / ФИНИШ ============================ */

  /** Запуск тура. force=true — принудительно (кнопка «❔» / настройки меты). */
  start(force: boolean): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    if (this.active) return;
    if (!force && this.isDone()) return;
    this.buildOverlay();
    if (this.els === null) return;
    this.idx = 0;
    this.active = true;
    this.els.root.classList.remove('wg-ob-hidden');
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    document.addEventListener('keydown', this.onKey);
    // дать карточке отрисоваться, затем позиционировать по актуальным rect
    this.render();
    requestAnimationFrame(() => this.positionStep());
  }

  /** Закрыть тур и записать флаг «пройдено» (Далее на последнем/Пропустить/Esc). */
  finish(): void {
    this.active = false;
    this.markDone();
    if (this.els !== null) this.els.root.classList.add('wg-ob-hidden');
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.onResize);
      window.removeEventListener('orientationchange', this.onResize);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', this.onKey);
    }
  }
}
