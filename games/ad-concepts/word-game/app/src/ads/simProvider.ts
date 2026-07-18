/**
 * SimAdProvider — СИМУЛЯТОР показов рекламы (Проход Е.2, порт showAdSim /
 * баннер-цикла из прототипа monetize.js). НИКАКИХ реальных SDK и сетей:
 * «показ» = экранный оверлей-заглушка с отсчётом 4–5 сек и меткой «СИМУЛЯЦИЯ»,
 * выручка — модельная (eCPM × jitter / 1000, ads/ecpm.ts).
 *
 * Interstitial: отсчёт 4 c, «Пропустить ✕» через 2 c, автозакрытие в конце
 * (skip тоже засчитывает показ — 1:1 с прототипом). Rewarded: отсчёт 5 c без
 * пропуска, в конце кнопка «Забрать награду» → completed:true. Баннер B-1:
 * полоса внизу, авто-рефреш 45 c (WGMON.BANNER.REFRESH_MS), каждый видимый
 * рефреш = 1 impression.
 *
 * Гео-переключение — через сеттер setGeo (дашборд, 06 §8.1). RNG инжектируется —
 * порядок величин выручки проверяется тестами детерминированно.
 *
 * В среде без DOM (vitest, node) оверлей не монтируется: show* резолвятся сразу,
 * impression'ы и выручка считаются как обычно — логика тестируема без браузера.
 */
import type { AdFormat, AdImpression, AdProvider, InterstitialResult, RewardedResult } from './provider';
import { DEFAULT_GEO, GEO_LABELS, ecpmFor, genRevenue, type GeoTier } from './ecpm';

/* Тайминги симуляции (1:1 из прототипа WGMON.INT/RW/BANNER). */
const INT_SECONDS = 4; // interstitial: длительность симуляции показа
const INT_SKIP_AFTER = 2; // «Пропустить» появляется через N c
const RW_SECONDS = 5; // rewarded 15–30 c → в симуляции 5 c
const BANNER_REFRESH_MS = 45000; // adaptive banner refresh 45 c (06 §3.3)

/** Заголовки экрана симуляции по плейсментам (карта 06 §3). */
const PLACEMENT_TITLES: Readonly<Record<string, string>> = {
  'I-1': 'Interstitial · I-1 (между уровнями)',
  'RV-1': 'Rewarded · RV-1 «Бесплатная Лампа»',
  'RV-2': 'Rewarded · RV-2 «×2 монеты за уровень»',
  'RV-5': 'Rewarded · RV-5 «Открыть копилку жёлудей»',
  'RV-6': 'Rewarded · RV-6 «Заморозка стрика»'
};

/** Пояснения под отсчётом (1:1 тексты прототипа). */
const PLACEMENT_PITCH: Readonly<Record<string, string>> = {
  'RV-1': 'Досмотри — откроем случайную букву в сетке бесплатно.',
  'RV-2': 'Досмотри — удвоим монеты, заработанные на этом уровне.',
  'RV-5': 'Досмотри — откроем копилку и конвертируем жёлуди в монеты.',
  'RV-6': 'Досмотри — заморозим стрик, чтобы продолжить серию без потерь.'
};

const DEFAULT_PITCH = 'В проде здесь крутится реальная сеть: AppLovin MAX / AdMob (06 §6, §8).';

export interface SimAdProviderOptions {
  /** Инжектируемый RNG джиттера выручки (тесты); по умолчанию Math.random. */
  rng?: () => number;
  /**
   * Пульс баннера активен: баннер разрешён капами и не перекрыт оверлеями
   * (порт bannerAllowed()+anyFullscreenOpen() из прототипа — «не считаем
   * показ, когда баннер скрыт»).
   */
  bannerActive?: () => boolean;
}

export class SimAdProvider implements AdProvider {
  onImpression: ((imp: AdImpression) => void) | null = null;

  private geo: GeoTier = DEFAULT_GEO;
  private readonly rng: () => number;
  private readonly bannerActive: () => boolean;

  /* DOM монтируется лениво — конструктор безопасен в среде без DOM. */
  private mounted = false;
  private overlayEl: HTMLElement | null = null;
  private formatEl: HTMLElement | null = null;
  private timerEl: HTMLElement | null = null;
  private pitchEl: HTMLElement | null = null;
  private ecpmEl: HTMLElement | null = null;
  private skipBtn: HTMLButtonElement | null = null;
  private claimBtn: HTMLButtonElement | null = null;
  private adTimer: number | null = null;

  private bannerOn = false;
  private bannerTimer: number | null = null;

  constructor(opts: SimAdProviderOptions = {}) {
    this.rng = opts.rng ?? Math.random;
    this.bannerActive = opts.bannerActive ?? (() => true);
  }

  /** Симулятору нечего грузить; монтируем оверлей, если DOM доступен. */
  async init(): Promise<void> {
    this.ensureMounted();
  }

  /* ------------------------------- Гео ------------------------------- */

  /** Сеттер гео-корзины (дашборд, 06 §8.1): меняет eCPM всех форматов. */
  setGeo(tier: GeoTier): void {
    this.geo = tier;
    this.updateBannerLabel();
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
    await this.runOverlay('rw', placement);
    const revenueUsd = this.emitImpression('rw', placement);
    // Симулятор не умеет «закрыть, не досмотрев» — completed всегда true
    // (у прототипа rewarded тоже шёл только до конца).
    return { completed: true, revenueUsd };
  }

  async showInterstitial(placement: string): Promise<InterstitialResult> {
    await this.runOverlay('int', placement);
    // Скип НЕ отменяет показ — impression засчитан (1:1 с прототипом).
    const revenueUsd = this.emitImpression('int', placement);
    return { shown: true, revenueUsd };
  }

  /* ----------------------------- Баннер ------------------------------ */

  showBanner(): void {
    this.bannerOn = true;
    if (typeof document !== 'undefined') {
      const bar = document.getElementById('adBanner');
      if (bar) bar.classList.remove('hidden');
      // Резерв места под баннер (порт #app.has-banner прототипа).
      document.getElementById('app')?.classList.add('has-banner');
      this.updateBannerLabel();
    }
    if (this.bannerTimer === null && typeof window !== 'undefined') {
      this.bannerTimer = window.setInterval(() => this.bannerTick(), BANNER_REFRESH_MS);
    }
  }

  hideBanner(): void {
    this.bannerOn = false;
    if (typeof document !== 'undefined') {
      const bar = document.getElementById('adBanner');
      if (bar) bar.classList.add('hidden');
      document.getElementById('app')?.classList.remove('has-banner');
    }
    if (this.bannerTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(this.bannerTimer);
      this.bannerTimer = null;
    }
  }

  /** Тик рефреша: видимая полоса = 1 показ B-1 (06 §3.3). */
  private bannerTick(): void {
    if (!this.bannerOn) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!this.bannerActive()) return;
    this.emitImpression('banner', 'B-1');
  }

  private updateBannerLabel(): void {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('adBannerEcpm');
    if (el) {
      el.textContent = '$' + ecpmFor('banner', this.geo).toFixed(2) + ' · ' + GEO_LABELS[this.geo];
    }
  }

  /* --------------------------- Внутренности --------------------------- */

  /** Выручка показа по eCPM-модели + событие onImpression. */
  private emitImpression(format: AdFormat, placement: string): number {
    const revenueUsd = genRevenue(format, this.geo, this.rng);
    this.onImpression?.({
      format,
      placement,
      revenueUsd,
      ecpmUsd: ecpmFor(format, this.geo)
    });
    return revenueUsd;
  }

  /** Ленивый монтаж оверлея показа в #adOverlay (создаётся при отсутствии). */
  private ensureMounted(): void {
    if (this.mounted || typeof document === 'undefined') return;
    let ov = document.getElementById('adOverlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'adOverlay';
      ov.classList.add('hidden');
      document.body.appendChild(ov);
    }
    // Разметка 1:1 с прототипом index.html (стили — index.html приложения).
    ov.innerHTML =
      '<div class="adSim">' +
      '<div class="adSimTag">СИМУЛЯЦИЯ РЕКЛАМЫ · без реальных сетей</div>' +
      '<div class="adSimFormat" id="adSimFormat">Реклама</div>' +
      '<div class="adSimBox">' +
      '<div class="adSimLogo">📺</div>' +
      '<div class="adSimPitch" id="adSimPitch"></div>' +
      '<div class="adSimEcpm" id="adSimEcpm"></div>' +
      '</div>' +
      '<div class="adSimTimerWrap">Показ идёт: <span class="adSimTimer" id="adSimTimer">5</span> сек</div>' +
      '<button id="adSimSkip" class="adSimSkip hidden" type="button">Пропустить ✕</button>' +
      '<button id="adSimClaim" class="adSimClaim hidden" type="button">Забрать награду 🎁</button>' +
      '</div>';
    this.overlayEl = ov;
    this.formatEl = document.getElementById('adSimFormat');
    this.timerEl = document.getElementById('adSimTimer');
    this.pitchEl = document.getElementById('adSimPitch');
    this.ecpmEl = document.getElementById('adSimEcpm');
    this.skipBtn = document.getElementById('adSimSkip') as HTMLButtonElement | null;
    this.claimBtn = document.getElementById('adSimClaim') as HTMLButtonElement | null;
    this.mounted = true;
  }

  /**
   * Экран симуляции показа (порт showAdSim): отсчёт, «Пропустить»/«Забрать».
   * Один показ за раз. В среде без DOM резолвится сразу.
   */
  private runOverlay(kind: 'int' | 'rw', placement: string): Promise<void> {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return Promise.resolve();
    }
    this.ensureMounted();
    const ov = this.overlayEl;
    const skip = this.skipBtn;
    const claim = this.claimBtn;
    if (!ov || !skip || !claim) return Promise.resolve();

    const fmt: AdFormat = kind === 'int' ? 'int' : 'rw';
    const seconds = kind === 'int' ? INT_SECONDS : RW_SECONDS;
    if (this.formatEl) {
      this.formatEl.textContent =
        PLACEMENT_TITLES[placement] ?? (kind === 'int' ? 'Interstitial · ' : 'Rewarded · ') + placement;
    }
    if (this.pitchEl) this.pitchEl.textContent = PLACEMENT_PITCH[placement] ?? DEFAULT_PITCH;
    if (this.ecpmEl) {
      this.ecpmEl.textContent =
        'eCPM (' + GEO_LABELS[this.geo] + '): $' + ecpmFor(fmt, this.geo).toFixed(2) + ' / 1000';
    }
    skip.classList.add('hidden');
    claim.classList.add('hidden');
    ov.classList.remove('hidden');

    let remaining = seconds;
    if (this.timerEl) this.timerEl.textContent = String(remaining);

    return new Promise((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        if (this.adTimer !== null) {
          window.clearInterval(this.adTimer);
          this.adTimer = null;
        }
        ov.classList.add('hidden');
        resolve();
      };
      skip.onclick = () => {
        if (kind === 'int') finish();
      };
      claim.onclick = () => {
        if (kind === 'rw') finish();
      };

      if (this.adTimer !== null) window.clearInterval(this.adTimer);
      this.adTimer = window.setInterval(() => {
        remaining--;
        if (remaining <= 0) {
          if (this.timerEl) this.timerEl.textContent = '0';
          if (this.adTimer !== null) {
            window.clearInterval(this.adTimer);
            this.adTimer = null;
          }
          if (kind === 'int') {
            skip.textContent = 'Закрыть ✕';
            skip.classList.remove('hidden');
            window.setTimeout(finish, 400); // interstitial закрывается сам
          } else {
            claim.classList.remove('hidden'); // rewarded: досмотрел → «Забрать»
          }
          return;
        }
        if (this.timerEl) this.timerEl.textContent = String(remaining);
        if (kind === 'int' && remaining <= seconds - INT_SKIP_AFTER) {
          skip.textContent = 'Пропустить ✕';
          skip.classList.remove('hidden');
        }
      }, 1000);
    });
  }
}
