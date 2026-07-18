/**
 * FTUE-онбординг (Проход Ж.1) — порт prototype/onboarding.js 1:1 в прод-порт:
 * коуч-марки «первых 5 минут» из 07-ux-ui-ftue.md §3 поверх готовой игры.
 * НИЧЕГО не переписывает в ядре/мете/монетизации — только обучающий слой.
 *
 * ПОВЕДЕНИЕ (как у прототипа):
 *  - показывается на ПЕРВОМ запуске: флаг — localStorage `blocksurge_ftue`
 *    (src/ui/ftueFlag.ts, тот же ключ и схема, что у прототипа: его сейв
 *    подхватывается — обучение не всплывает повторно);
 *  - «Пропустить» на любом шаге / «Готово · играть» в конце — оба ставят флаг;
 *  - кнопка «Пройти обучение снова» (настройки меты, #ftueReplayBtn через
 *    MetaUi.onFtueReplay) запускает тур заново ВНЕ зависимости от флага.
 *
 * ГЕОМЕТРИЯ ПОДСВЕТКИ — с реальных элементов порта: DOM-цели меряются
 * getBoundingClientRect, а регионы ВНУТРИ канваса (док/поле/шкала/гнездо
 * бомбы) переводятся из логических координат сцены (CANVAS_RECTS из
 * GameScene — аналог глобалов BOARD_X/DOCK_Y прототипа) в экранные через
 * rect канваса Phaser (Scale.FIT масштабирует канвас равномерно).
 *
 * Все строки — через t() (i18n RU/EN). Оверлей блокирует ввод в игру, пока
 * открыт; подсветка чисто визуальная. Событие ftue_step — как в прототипе
 * (09 §2, грунт под KPI FTUE).
 */
import { t, type TranslationKey } from '../i18n';
import type { Analytics } from '../economy/analytics';
import { CANVAS_RECTS, GAME_H, GAME_W, type LogicalRect } from '../scenes/GameScene';
import { isFtueDone, markFtueDone } from './ftueFlag';

/** Экранный прямоугольник цели подсветки. */
interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Цель шага: регион канваса (логические координаты сцены) или DOM-селектор. */
type StepTarget =
  | { kind: 'canvas'; rect: keyof typeof CANVAS_RECTS }
  | { kind: 'dom'; selector: string };

interface StepDef {
  id: string;
  metaKey: TranslationKey;
  titleKey: TranslationKey;
  textKey: TranslationKey;
  target: StepTarget;
}

/* Шаги ровно по 07 §3 (первые 5 минут) — порядок и цели 1:1 с прототипом. */
const STEPS: readonly StepDef[] = [
  {
    id: 'shapes',
    metaKey: 'ftue.step.shapes.meta',
    titleKey: 'ftue.step.shapes.title',
    textKey: 'ftue.step.shapes.text',
    target: { kind: 'canvas', rect: 'dock' }
  },
  {
    id: 'line',
    metaKey: 'ftue.step.line.meta',
    titleKey: 'ftue.step.line.title',
    textKey: 'ftue.step.line.text',
    target: { kind: 'canvas', rect: 'board' }
  },
  {
    id: 'surge',
    metaKey: 'ftue.step.surge.meta',
    titleKey: 'ftue.step.surge.title',
    textKey: 'ftue.step.surge.text',
    target: { kind: 'canvas', rect: 'surge' }
  },
  {
    id: 'crystal',
    metaKey: 'ftue.step.crystal.meta',
    titleKey: 'ftue.step.crystal.title',
    textKey: 'ftue.step.crystal.text',
    target: { kind: 'canvas', rect: 'bombSlot' }
  },
  {
    id: 'coins',
    metaKey: 'ftue.step.coins.meta',
    titleKey: 'ftue.step.coins.title',
    textKey: 'ftue.step.coins.text',
    target: { kind: 'dom', selector: '.coinBox' }
  },
  {
    id: 'ads',
    metaKey: 'ftue.step.ads.meta',
    titleKey: 'ftue.step.ads.title',
    textKey: 'ftue.step.ads.text',
    target: { kind: 'dom', selector: '#openMetaBtn' }
  }
];

export class OnboardingUi {
  private idx = 0;
  private built = false;
  private visible = false;

  private overlay!: HTMLElement;
  private spot!: HTMLElement;
  private card!: HTMLElement;
  private stepMetaEl!: HTMLElement;
  private titleEl!: HTMLElement;
  private textEl!: HTMLElement;
  private dotsEl!: HTMLElement;
  private backBtn!: HTMLButtonElement;
  private nextBtn!: HTMLButtonElement;

  constructor(private readonly analytics: Analytics) {
    // Перепозиционирование при ресайзе/повороте, пока тур открыт.
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => {
        if (this.visible) this.render();
      });
    }
  }

  /* ------------------------- Публичный контракт ------------------------- */

  /** «Пройти обучение снова» — запускает тур вне зависимости от флага. */
  start(): void {
    this.show(0);
  }

  /** Автозапуск на первом запуске — только если флаг не стоит. */
  maybeAutoStart(): void {
    if (!isFtueDone()) this.show(0);
  }

  isDone(): boolean {
    return isFtueDone();
  }

  get stepsCount(): number {
    return STEPS.length;
  }

  /* ---------------------- Геометрия целей подсветки --------------------- */

  private domRect(selector: string): ScreenRect | null {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) return null; // скрытый/несмонтированный
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  /** Логический прямоугольник сцены → экранный (через rect канваса Phaser). */
  private canvasRect(lr: LogicalRect): ScreenRect | null {
    const cv = document.querySelector<HTMLCanvasElement>('#app canvas');
    if (!cv) return null;
    const r = cv.getBoundingClientRect();
    if (r.width <= 0) return null;
    const sx = r.width / GAME_W;
    const sy = r.height / GAME_H;
    return { left: r.left + lr.x * sx, top: r.top + lr.y * sy, width: lr.w * sx, height: lr.h * sy };
  }

  private resolveTarget(target: StepTarget): ScreenRect | null {
    try {
      if (target.kind === 'dom') return this.domRect(target.selector);
      return this.canvasRect(CANVAS_RECTS[target.rect]);
    } catch {
      return null; // цель не нашлась → шаг без подсветки (сплошное затемнение)
    }
  }

  /* ------------------------------ DOM тура ------------------------------ */

  private build(): void {
    if (this.built) return;

    const ov = document.createElement('div');
    ov.id = 'ftueOverlay';
    ov.className = 'hidden';
    ov.setAttribute('aria-hidden', 'true');

    const spot = document.createElement('div');
    spot.id = 'ftueSpot';

    const card = document.createElement('div');
    card.id = 'ftueCard';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'ftueTitle');
    card.innerHTML =
      '<div class="ftueTag">' + t('ftue.tag') + '</div>' +
      '<div class="ftueStepMeta" id="ftueStepMeta"></div>' +
      '<h3 id="ftueTitle"></h3>' +
      '<p id="ftueText"></p>' +
      '<div class="ftueDots" id="ftueDots"></div>' +
      '<div class="ftueBtns">' +
      '<button id="ftueSkip" type="button" class="ftueSkipBtn">' + t('ftue.skip') + '</button>' +
      '<span class="ftueSpacer"></span>' +
      '<button id="ftueBack" type="button" class="ftueNavBtn">' + t('ftue.back') + '</button>' +
      '<button id="ftueNext" type="button" class="ftueNavBtn ftuePrimary">' +
      t('ftue.next') + '</button>' +
      '</div>';

    ov.appendChild(spot);
    ov.appendChild(card);
    document.body.appendChild(ov);

    // Клик по затемнению не проваливается в игру (оверлей ловит ввод сам).
    ov.addEventListener('click', (e) => {
      if (e.target === ov) e.stopPropagation();
    });

    this.overlay = ov;
    this.spot = spot;
    this.card = card;
    this.stepMetaEl = card.querySelector('#ftueStepMeta') as HTMLElement;
    this.titleEl = card.querySelector('#ftueTitle') as HTMLElement;
    this.textEl = card.querySelector('#ftueText') as HTMLElement;
    this.dotsEl = card.querySelector('#ftueDots') as HTMLElement;
    this.backBtn = card.querySelector('#ftueBack') as HTMLButtonElement;
    this.nextBtn = card.querySelector('#ftueNext') as HTMLButtonElement;
    const skipBtn = card.querySelector('#ftueSkip') as HTMLButtonElement;

    skipBtn.addEventListener('click', () => this.finish('skip'));
    this.backBtn.addEventListener('click', () => this.back());
    this.nextBtn.addEventListener('click', () => this.next());

    // Дотсы (индикатор шагов) — по числу шагов.
    for (let i = 0; i < STEPS.length; i++) {
      const d = document.createElement('span');
      d.className = 'ftueDot';
      this.dotsEl.appendChild(d);
    }

    this.built = true;
  }

  /* ------------------------- Позиционирование --------------------------- */

  private positionSpot(rect: ScreenRect | null): void {
    if (!rect) {
      this.overlay.classList.add('ftue-nospot');
      this.spot.style.display = 'none';
      return;
    }
    this.overlay.classList.remove('ftue-nospot');
    const pad = 8;
    this.spot.style.display = 'block';
    this.spot.style.left = rect.left - pad + 'px';
    this.spot.style.top = rect.top - pad + 'px';
    this.spot.style.width = rect.width + pad * 2 + 'px';
    this.spot.style.height = rect.height + pad * 2 + 'px';
  }

  private positionCard(rect: ScreenRect | null): void {
    const card = this.card;
    card.style.left = '50%';
    if (!rect) {
      card.style.top = '50%';
      card.style.bottom = 'auto';
      card.style.transform = 'translate(-50%, -50%)';
      return;
    }
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const spotMid = rect.top + rect.height / 2;
    card.style.transform = 'translateX(-50%)';
    if (spotMid < vh / 2) {
      // цель в верхней половине → карточка снизу
      card.style.top = 'auto';
      card.style.bottom = '24px';
    } else {
      // цель в нижней половине → карточка сверху
      card.style.bottom = 'auto';
      card.style.top = '24px';
    }
  }

  private render(): void {
    if (!this.visible) return;
    const step = STEPS[this.idx];
    this.stepMetaEl.textContent = t('ftue.stepMeta', {
      n: this.idx + 1,
      total: STEPS.length,
      meta: t(step.metaKey)
    });
    this.titleEl.textContent = t(step.titleKey);
    this.textEl.textContent = t(step.textKey);

    const dots = this.dotsEl.children;
    for (let i = 0; i < dots.length; i++) {
      dots[i].className = 'ftueDot' + (i === this.idx ? ' active' : i < this.idx ? ' done' : '');
    }

    this.backBtn.disabled = this.idx === 0;
    this.backBtn.style.visibility = this.idx === 0 ? 'hidden' : 'visible';
    this.nextBtn.textContent = this.idx === STEPS.length - 1 ? t('ftue.done') : t('ftue.next');

    const rect = this.resolveTarget(step.target);
    this.positionSpot(rect);
    this.positionCard(rect);

    this.track('view', step.id);
  }

  /* ------------------------------ Управление ----------------------------- */

  private show(startAt: number): void {
    this.build();
    this.idx = startAt;
    this.visible = true;
    this.overlay.classList.remove('hidden');
    this.overlay.setAttribute('aria-hidden', 'false');
    // Ждём кадр: канвас/лейаут меряются уже после снятия display:none.
    requestAnimationFrame(() => this.render());
    this.track('start', STEPS[this.idx]?.id ?? 'start');
  }

  private hide(): void {
    this.visible = false;
    if (this.built) {
      this.overlay.classList.add('hidden');
      this.overlay.setAttribute('aria-hidden', 'true');
    }
  }

  private next(): void {
    if (this.idx >= STEPS.length - 1) {
      this.finish('complete');
      return;
    }
    this.idx++;
    this.render();
  }

  private back(): void {
    if (this.idx <= 0) return;
    this.idx--;
    this.render();
  }

  private finish(how: 'complete' | 'skip'): void {
    markFtueDone(how);
    this.hide();
    this.track(how === 'skip' ? 'skip' : 'complete', STEPS[this.idx]?.id ?? 'end');
  }

  /* ------------------------------ Аналитика ------------------------------ */

  /** Событие ftue_step из 09 §2 — грунт под KPI FTUE (07 §3). */
  private track(action: string, id: string): void {
    this.analytics.track('ftue_step', { action, step: this.idx + 1, id });
  }
}
