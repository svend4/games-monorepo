/**
 * SimAdProvider — СИМУЛЯТОР показов рекламы (Проход Е.2, порт showAd из
 * прототипа monetize.js). НИКАКИХ реальных SDK и сетей: «показ» = экранный
 * оверлей-заглушка с отсчётом 3–5 сек и меткой «СИМУЛЯЦИЯ», выручка —
 * модельная (ставка rollEcpm / 1000, ads/ecpm.ts).
 *
 * Rewarded: отсчёт 5 c, в конце кнопка «Забрать награду ✓» → completed:true.
 * Interstitial: отсчёт 3 c, в конце «Закрыть ✕»; ставка ниже eCPM-floor
 * (06 §6.3 п.8) — отказ БЕЗ оверлея (noFillReason 'eCPM-floor'), «не
 * загрузилось» (3% fill-отказов) — экран ошибки и noFillReason 'no_fill'.
 * Всё 1:1 с прототипом, включая тексты и id DOM-элементов (#ad-screen).
 *
 * Гео-переключение — через сеттер setGeo (дашборд, 06 §6.6). RNG инжектируется —
 * порядок величин выручки проверяется тестами детерминированно.
 *
 * В среде без DOM (vitest, node) оверлей не монтируется: show* резолвятся
 * сразу, impression'ы и выручка считаются как обычно.
 */
import type { AdImpression, AdProvider, InterstitialResult, RewardedResult } from './provider';
import {
  DEFAULT_GEO,
  ECPM_FLOOR,
  FAIL_RATE,
  GEO_LABELS,
  rollEcpm,
  type AdFormat,
  type GeoTier
} from './ecpm';
import { MON, PLACEMENTS, type PlacementId } from '../monetize/config';

export interface SimAdProviderOptions {
  /** Инжектируемый RNG ставки/фейлов (тесты); по умолчанию Math.random. */
  rng?: () => number;
}

function placementDef(placement: string): { name: string; desc: string } {
  const p = PLACEMENTS[placement as PlacementId];
  return p !== undefined ? p : { name: placement, desc: '—' };
}

export class SimAdProvider implements AdProvider {
  onImpression: ((imp: AdImpression) => void) | null = null;

  private geo: GeoTier = DEFAULT_GEO;
  private readonly rng: () => number;

  /* DOM монтируется лениво — конструктор безопасен в среде без DOM. */
  private mounted = false;
  private screenEl: HTMLElement | null = null;
  private tagEl: HTMLElement | null = null;
  private placeEl: HTMLElement | null = null;
  private descEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private noteEl: HTMLElement | null = null;
  private closeBtn: HTMLButtonElement | null = null;
  private adTimer: number | null = null;

  constructor(opts: SimAdProviderOptions = {}) {
    this.rng = opts.rng ?? Math.random;
  }

  /** Симулятору нечего грузить; монтируем оверлей, если DOM доступен. */
  async init(): Promise<void> {
    this.ensureMounted();
  }

  /* ------------------------------- Гео ------------------------------- */

  /** Сеттер гео-корзины (дашборд, 06 §6.6): меняет eCPM обоих форматов. */
  setGeo(tier: GeoTier): void {
    this.geo = tier;
  }

  getGeo(): GeoTier {
    return this.geo;
  }

  /* ----------------------------- Показы ------------------------------ */

  /** В симуляции fill всегда есть (прод: isRewardedAdReady юнита). */
  isRewardedReady(_placement: string): boolean {
    return true;
  }

  async showRewarded(placement: string): Promise<RewardedResult> {
    const ecpmUsd = rollEcpm('rewarded', this.geo, this.rng);
    // FAIL_RATE.rewarded = 0 в прототипе, но ветка отказа сохранена 1:1.
    const failed = this.rng() < FAIL_RATE.rewarded;
    if (failed) {
      await this.runOverlayFail('rewarded', placement);
      return { completed: false, revenueUsd: 0, ecpmUsd };
    }
    await this.runOverlay('rewarded', placement);
    const revenueUsd = this.emitImpression('rewarded', placement, ecpmUsd);
    return { completed: true, revenueUsd, ecpmUsd };
  }

  async showInterstitial(placement: string): Promise<InterstitialResult> {
    const ecpmUsd = rollEcpm('interstitial', this.geo, this.rng);
    // §6.3 п.8: ставка ниже floor — показ не запрашиваем (без оверлея).
    if (ecpmUsd < ECPM_FLOOR[this.geo].interstitial) {
      return { shown: false, revenueUsd: 0, ecpmUsd, noFillReason: 'eCPM-floor' };
    }
    const failed = this.rng() < FAIL_RATE.interstitial;
    if (failed) {
      await this.runOverlayFail('interstitial', placement);
      return { shown: false, revenueUsd: 0, ecpmUsd, noFillReason: 'no_fill' };
    }
    await this.runOverlay('interstitial', placement);
    const revenueUsd = this.emitImpression('interstitial', placement, ecpmUsd);
    return { shown: true, revenueUsd, ecpmUsd };
  }

  /* --------------------------- Внутренности --------------------------- */

  /** Выручка показа по eCPM-модели + событие onImpression. */
  private emitImpression(format: AdFormat, placement: string, ecpmUsd: number): number {
    const revenueUsd = ecpmUsd / 1000;
    this.onImpression?.({ format, placement, revenueUsd, ecpmUsd });
    return revenueUsd;
  }

  /** Ленивый монтаж оверлея показа #ad-screen (разметка прототипа 1:1). */
  private ensureMounted(): void {
    if (this.mounted || typeof document === 'undefined') return;
    let el = document.getElementById('ad-screen');
    if (el === null) {
      el = document.createElement('div');
      el.id = 'ad-screen';
      el.className = 'hidden';
      document.body.appendChild(el);
    }
    el.innerHTML =
      '<div class="ad-box">' +
      '<div class="ad-simtag" id="ad-tag">СИМУЛЯЦИЯ РЕКЛАМЫ</div>' +
      '<div class="ad-icon">📺</div>' +
      '<div class="ad-place" id="ad-place">—</div>' +
      '<div class="ad-desc" id="ad-desc">—</div>' +
      '<div class="ad-count" id="ad-count">5</div>' +
      '<div class="ad-note" id="ad-note">в проде здесь показ AppLovin MAX / AdMob</div>' +
      '<button class="ad-close" id="ad-close" type="button" disabled>Реклама…</button>' +
      '</div>';
    this.screenEl = el;
    this.tagEl = document.getElementById('ad-tag');
    this.placeEl = document.getElementById('ad-place');
    this.descEl = document.getElementById('ad-desc');
    this.countEl = document.getElementById('ad-count');
    this.noteEl = document.getElementById('ad-note');
    this.closeBtn = document.getElementById('ad-close') as HTMLButtonElement | null;
    this.mounted = true;
  }

  private fillHeader(format: AdFormat, placement: string): void {
    const p = placementDef(placement);
    if (this.tagEl !== null) {
      this.tagEl.textContent =
        format === 'rewarded' ? 'СИМУЛЯЦИЯ · REWARDED' : 'СИМУЛЯЦИЯ · INTERSTITIAL';
    }
    if (this.placeEl !== null) this.placeEl.textContent = p.name + ' · ' + GEO_LABELS[this.geo];
    if (this.descEl !== null) this.descEl.textContent = p.desc;
  }

  /** Экран «не загрузилось» (fill < 100%): кнопка «Закрыть», награды нет. */
  private runOverlayFail(format: AdFormat, placement: string): Promise<void> {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return Promise.resolve();
    }
    this.ensureMounted();
    const el = this.screenEl;
    const btn = this.closeBtn;
    if (el === null || btn === null) return Promise.resolve();
    this.fillHeader(format, placement);
    if (this.countEl !== null) this.countEl.textContent = '×';
    if (this.noteEl !== null) {
      this.noteEl.textContent = 'Реклама не загрузилась (fill < 100%) — награды нет';
    }
    btn.disabled = false;
    btn.textContent = 'Закрыть';
    el.classList.remove('hidden');
    return new Promise((resolve) => {
      btn.onclick = () => {
        btn.onclick = null;
        el.classList.add('hidden');
        resolve();
      };
    });
  }

  /**
   * Экран симуляции показа (порт showAd): отсчёт 3–5 c, затем «Забрать
   * награду ✓» (rewarded) или «Закрыть ✕» (interstitial). Один показ за раз;
   * защита от двойного клика — onclick снимается при первом срабатывании.
   */
  private runOverlay(format: AdFormat, placement: string): Promise<void> {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return Promise.resolve();
    }
    this.ensureMounted();
    const el = this.screenEl;
    const btn = this.closeBtn;
    if (el === null || btn === null) return Promise.resolve();

    this.fillHeader(format, placement);
    const secs = MON.AD_SECONDS[format];
    let remain = secs;
    if (this.countEl !== null) this.countEl.textContent = String(remain);
    if (this.noteEl !== null) {
      this.noteEl.textContent = 'в проде здесь показ AppLovin MAX / AdMob';
    }
    btn.disabled = true;
    btn.textContent = 'Реклама… ' + remain + ' c';
    btn.onclick = null;
    el.classList.remove('hidden');

    return new Promise((resolve) => {
      if (this.adTimer !== null) window.clearInterval(this.adTimer);
      this.adTimer = window.setInterval(() => {
        remain--;
        if (remain > 0) {
          if (this.countEl !== null) this.countEl.textContent = String(remain);
          btn.textContent = 'Реклама… ' + remain + ' c';
          return;
        }
        if (this.adTimer !== null) {
          window.clearInterval(this.adTimer);
          this.adTimer = null;
        }
        if (this.countEl !== null) this.countEl.textContent = '✓';
        btn.disabled = false;
        btn.textContent = format === 'rewarded' ? 'Забрать награду ✓' : 'Закрыть ✕';
        btn.onclick = () => {
          btn.onclick = null; // нет дубля награды от повторного клика
          el.classList.add('hidden');
          resolve();
        };
      }, 1000);
    });
  }
}
