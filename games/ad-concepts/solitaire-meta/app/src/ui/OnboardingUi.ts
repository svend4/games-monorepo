/**
 * OnboardingUi — FTUE-коуч-марки первого запуска (Проход Ж.1, порт
 * prototype/onboarding.js 1:1 + i18n + кнопка «Назад»).
 *
 * Шаги главы 07 §7.3 «первые 5 минут»: правило ±1 → колода → серия/множитель →
 * карта урожая → зачем сад → финал. Подсветка «дырой» вокруг РЕАЛЬНЫХ
 * DOM-элементов порта (waste-card, stock-card, hud-chain, значок 🍎 на столе,
 * btn-garden) — геометрия берётся из getBoundingClientRect на каждом шаге,
 * как прототип делал с глобалов. Кнопки: «Далее», «← Назад» (добавлена в
 * порте), «Пропустить обучение»; прогресс-точки; Esc = пропустить,
 * Enter = далее.
 *
 * СОВМЕСТИМОСТЬ СЕЙВОВ (обязательное требование): ТОТ ЖЕ ключ localStorage
 * 'orchardPeaks.onboarding' и та же схема флага {done, version, skipped, at},
 * что у прототипа. Сейв прототипа = обучение пройдено, повторно не
 * показывается. ОТСУТСТВИЕ ключа = показать. Повтор — кнопка «Пройти
 * обучение снова» в мете (⚙️ Настройки) → start(true).
 *
 * Дизайн под ЦА 45+ (07 §7.4/§7.5): крупные шрифты (минимум в оверлее
 * 15.5px — метка шага; тело 19px), спокойный ведомый темп без таймеров,
 * клик по затемнению НЕ закрывает. Все строки — через t() (i18n RU/EN).
 * Стили — self-contained инъекция (как в прототипе), style.css не трогаем.
 */
import type { Analytics } from '../economy/analytics';
import { defaultStorage, type KeyValueStorage } from '../economy/store';
import { t, type TranslationKey } from '../i18n';

/** Тот же ключ и версия, что у прототипа (onboarding.js). */
export const ONBOARDING_KEY = 'orchardPeaks.onboarding';
/** Растить при смене набора шагов → обучение покажется снова. */
export const ONBOARDING_VERSION = 1;

/** Схема флага 1:1 с прототипом. */
export interface OnboardingFlag {
  done: boolean;
  version: number;
  skipped: boolean;
  at: number;
}

/* ---------- Чистые помощники флага (тестируются без DOM) ---------- */

export function readOnboardingFlag(storage: KeyValueStorage): OnboardingFlag | null {
  try {
    const raw = storage.getItem(ONBOARDING_KEY);
    if (raw === null) return null; // отсутствие = не пройдено
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const o = parsed as Record<string, unknown>;
    return {
      done: o.done === true,
      version: typeof o.version === 'number' ? o.version : 0,
      skipped: o.skipped === true,
      at: typeof o.at === 'number' ? o.at : 0
    };
  } catch {
    return null;
  }
}

/** Пройдено, только если флаг есть И версия совпадает (иначе покажем обновлённый). */
export function isOnboardingDone(storage: KeyValueStorage): boolean {
  const f = readOnboardingFlag(storage);
  return f !== null && f.done && f.version === ONBOARDING_VERSION;
}

export function markOnboardingDone(storage: KeyValueStorage, skipped: boolean): void {
  try {
    storage.setItem(
      ONBOARDING_KEY,
      JSON.stringify({
        done: true,
        version: ONBOARDING_VERSION,
        skipped,
        at: Date.now()
      })
    );
  } catch {
    /* приватный режим/квота — не критично, покажем снова */
  }
}

/** Сброс флага (KeyValueStorage без removeItem: '' парсится в null = не пройдено). */
export function resetOnboarding(storage: KeyValueStorage): void {
  try {
    storage.setItem(ONBOARDING_KEY, '');
  } catch {
    /* no-op */
  }
}

/* ---------- Шаги FTUE (07 §7.3), тексты — ключи i18n ---------- */

interface OnbStep {
  readonly mascot: string;
  readonly titleKey: TranslationKey;
  readonly bodyKey: TranslationKey;
  /** Кнопка «Далее» шага (у первого и последнего — свой CTA). */
  readonly ctaKey: TranslationKey;
  /** DOM-элемент подсветки; null = центрированная карточка без «дыры».
   *  Разрешается лениво на каждом шаге — учитывает текущий расклад. */
  readonly target: (() => HTMLElement | null) | null;
}

function byId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

/** Элемент HUD-панели, содержащий счётчик (как closestHudItem прототипа). */
function closestHudItem(innerId: string): HTMLElement | null {
  const el = byId(innerId);
  if (el !== null) {
    const item = el.closest<HTMLElement>('.hud-item');
    if (item !== null) return item;
  }
  return el;
}

const STEPS: readonly OnbStep[] = [
  {
    mascot: '🌳',
    titleKey: 'onb.s1.title',
    bodyKey: 'onb.s1.body',
    ctaKey: 'onb.s1.cta',
    target: null
  },
  {
    mascot: '🃏',
    titleKey: 'onb.s2.title',
    bodyKey: 'onb.s2.body',
    ctaKey: 'onb.next',
    target: () => byId('waste-card')
  },
  {
    mascot: '🂠',
    titleKey: 'onb.s3.title',
    bodyKey: 'onb.s3.body',
    ctaKey: 'onb.next',
    target: () => byId('stock-card')
  },
  {
    mascot: '✨',
    titleKey: 'onb.s4.title',
    bodyKey: 'onb.s4.body',
    ctaKey: 'onb.next',
    target: () => closestHudItem('hud-chain')
  },
  {
    mascot: '🍎',
    titleKey: 'onb.s5.title',
    bodyKey: 'onb.s5.body',
    ctaKey: 'onb.next',
    target: () => {
      // Реальная карта урожая текущей раздачи; нет на столе — корзина в HUD.
      const badge = document.querySelector('#peaks .apple-badge');
      if (badge !== null) {
        const card = badge.closest<HTMLElement>('.card');
        if (card !== null) return card;
      }
      return closestHudItem('hud-harvest');
    }
  },
  {
    mascot: '🌱',
    titleKey: 'onb.s6.title',
    bodyKey: 'onb.s6.body',
    ctaKey: 'onb.next',
    target: () => byId('btn-garden')
  },
  {
    mascot: '🍎',
    titleKey: 'onb.s7.title',
    bodyKey: 'onb.s7.body',
    ctaKey: 'onb.s7.cta',
    target: null
  }
];

export class OnboardingUi {
  private active = false;
  private idx = 0;
  private repositionBound: (() => void) | null = null;
  private readonly storage: KeyValueStorage;

  constructor(
    private readonly analytics: Analytics,
    storage: KeyValueStorage = defaultStorage()
  ) {
    this.storage = storage;
  }

  isDone(): boolean {
    return isOnboardingDone(this.storage);
  }

  isActive(): boolean {
    return this.active;
  }

  /** Автозапуск первого запуска: как boot() прототипа, с задержкой 350 мс
   *  (даём ядру дорисовать HUD/раздачу и мета-инициализацию). */
  maybeStartOnFirstRun(delayMs = 350): void {
    if (this.isDone()) return;
    setTimeout(() => {
      if (!this.isDone() && !this.active) this.start(false);
    }, delayMs);
  }

  /* ---------- Инъекция стилей (self-contained, без правки style.css) ---------- */

  private injectStyles(): void {
    if (byId('onb-style') !== null) return;
    // Минимальный кегль оверлея — 15.5px (метка шага); тело 19px, ЦА 45+.
    const css =
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
      '.onb-row{display:flex;gap:10px;}' +
      '.onb-row .onb-btn{width:auto;flex:1;}' +
      '.onb-back,.onb-skip{background:#fffdf4;color:#5a6048;border-color:#b9c49f;' +
      'font-weight:600;font-size:17px;min-height:48px;}' +
      '.onb-back:hover,.onb-skip:hover{background:#f3edd4;}' +
      '#onb-card .onb-step-label{font-size:15.5px;color:#8a9072;margin-bottom:2px;}' +
      '@media (max-width:520px){#onb-card{max-width:94vw;padding:18px 18px 16px;}' +
      '#onb-card h2{font-size:21px;}#onb-card p{font-size:18px;}}';
    const st = document.createElement('style');
    st.id = 'onb-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------- Построение DOM оверлея ---------- */

  private buildDom(): void {
    if (byId('onb-overlay') !== null) return;
    const ov = document.createElement('div');
    ov.id = 'onb-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', t('onb.aria'));

    const hole = document.createElement('div');
    hole.id = 'onb-hole';

    const card = document.createElement('div');
    card.id = 'onb-card';
    card.innerHTML =
      '<div class="onb-step-label" id="onb-step-label"></div>' +
      '<div class="onb-mascot" id="onb-mascot" aria-hidden="true"></div>' +
      '<h2 id="onb-title"></h2>' +
      '<p id="onb-body"></p>' +
      '<div id="onb-dots" aria-hidden="true"></div>' +
      '<div id="onb-actions">' +
      '<button type="button" class="onb-btn onb-next" id="onb-next"></button>' +
      '<div class="onb-row">' +
      '<button type="button" class="onb-btn onb-back" id="onb-back">' +
      t('onb.back') +
      '</button>' +
      '<button type="button" class="onb-btn onb-skip" id="onb-skip">' +
      t('onb.skip') +
      '</button>' +
      '</div>' +
      '</div>';

    ov.appendChild(hole);
    ov.appendChild(card);
    document.body.appendChild(ov);

    byId('onb-next')?.addEventListener('click', () => this.onNext());
    byId('onb-back')?.addEventListener('click', () => this.onBack());
    byId('onb-skip')?.addEventListener('click', () => this.finish(true));
    ov.addEventListener('keydown', (e) => this.onKey(e as KeyboardEvent));
    // клик по затемнению НЕ закрывает (спокойный ведомый темп; выход — явной кнопкой)
  }

  /* ---------- Позиционирование подсветки и карточки (порт layout 1:1) ---------- */

  private layout(): void {
    const step = STEPS[this.idx];
    const hole = byId('onb-hole');
    const card = byId('onb-card');
    if (hole === null || card === null) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let target: HTMLElement | null = null;
    try {
      target = step.target !== null ? step.target() : null;
    } catch {
      target = null;
    }
    let rect: DOMRect | null = null;
    if (target !== null) {
      const r = target.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh) rect = r;
    }

    const pad = 8;
    if (rect !== null) {
      hole.classList.remove('no-ring');
      hole.style.top = `${rect.top - pad}px`;
      hole.style.left = `${rect.left - pad}px`;
      hole.style.width = `${rect.width + pad * 2}px`;
      hole.style.height = `${rect.height + pad * 2}px`;
    } else {
      // без цели: 0-размерная дыра по центру → ровное затемнение всего экрана
      hole.classList.add('no-ring');
      hole.style.top = `${vh / 2}px`;
      hole.style.left = `${vw / 2}px`;
      hole.style.width = '0px';
      hole.style.height = '0px';
    }

    // карточку измеряем после наполнения текстом (см. showStep) — здесь позиционируем
    const cw = card.offsetWidth || 380;
    const ch = card.offsetHeight || 260;
    const margin = 16;
    let left: number;
    let top: number;

    if (rect !== null) {
      left = clamp(rect.left + rect.width / 2 - cw / 2, margin, vw - cw - margin);
      const below = rect.bottom + margin;
      const above = rect.top - ch - margin;
      if (below + ch <= vh - margin) {
        top = below; // под целью
      } else if (above >= margin) {
        top = above; // над целью
      } else {
        top = clamp(vh / 2 - ch / 2, margin, vh - ch - margin); // не влезло — по центру
      }
    } else {
      left = clamp(vw / 2 - cw / 2, margin, vw - cw - margin);
      top = clamp(vh / 2 - ch / 2, margin, vh - ch - margin);
    }
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
  }

  /* ---------- Отрисовка шага ---------- */

  private showStep(): void {
    const step = STEPS[this.idx];
    const stepLabel = byId('onb-step-label');
    if (stepLabel !== null) {
      stepLabel.textContent = t('onb.stepLabel', { cur: this.idx + 1, total: STEPS.length });
    }
    const mascot = byId('onb-mascot');
    if (mascot !== null) mascot.textContent = step.mascot;
    const title = byId('onb-title');
    if (title !== null) title.textContent = t(step.titleKey);
    const body = byId('onb-body');
    if (body !== null) body.textContent = t(step.bodyKey);
    const next = byId('onb-next');
    if (next !== null) next.textContent = t(step.ctaKey);
    const back = byId('onb-back');
    if (back !== null) back.style.display = this.idx === 0 ? 'none' : '';

    const dots = byId('onb-dots');
    if (dots !== null) {
      dots.innerHTML = '';
      for (let i = 0; i < STEPS.length; i++) {
        const d = document.createElement('i');
        if (i === this.idx) d.className = 'cur';
        dots.appendChild(d);
      }
    }

    // дважды: первый проход даёт корректные offsetWidth/Height карточки
    this.layout();
    requestAnimationFrame(() => this.layout());

    this.analytics.track('ftue_step', {
      step: this.idx + 1,
      total: STEPS.length,
      id: 'onb_' + (this.idx + 1)
    });
    if (next !== null) {
      try {
        next.focus();
      } catch {
        /* no-op */
      }
    }
  }

  /* ---------- Обработчики ---------- */

  private onNext(): void {
    if (this.idx >= STEPS.length - 1) {
      this.finish(false);
      return;
    }
    this.idx++;
    this.showStep();
  }

  private onBack(): void {
    if (this.idx === 0) return;
    this.idx--;
    this.showStep();
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.finish(true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.onNext();
    }
  }

  /* ---------- Старт / завершение ---------- */

  start(isReplay: boolean): void {
    if (this.active || typeof document === 'undefined') return;
    this.injectStyles();
    this.buildDom();
    this.idx = 0;
    this.active = true;
    const ov = byId('onb-overlay');
    if (ov === null) return;
    ov.classList.add('on');
    document.body.classList.add('onb-active');

    this.repositionBound = () => {
      if (this.active) this.layout();
    };
    window.addEventListener('resize', this.repositionBound);
    window.addEventListener('scroll', this.repositionBound, true);

    this.showStep();
    this.analytics.track('ftue_start', { replay: isReplay, version: ONBOARDING_VERSION });
    try {
      ov.setAttribute('tabindex', '-1');
      ov.focus();
    } catch {
      /* no-op */
    }
  }

  private finish(skipped: boolean): void {
    if (!this.active) return;
    this.active = false;
    markOnboardingDone(this.storage, skipped);
    const ov = byId('onb-overlay');
    if (ov !== null) ov.classList.remove('on');
    document.body.classList.remove('onb-active');
    if (this.repositionBound !== null) {
      window.removeEventListener('resize', this.repositionBound);
      window.removeEventListener('scroll', this.repositionBound, true);
      this.repositionBound = null;
    }
    this.analytics.track('ftue_finish', { skipped, last_step: this.idx + 1 });
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
