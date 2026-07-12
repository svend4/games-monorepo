import {
  createStorage,
  escapeHTML,
  getAppConfig,
  renderAppIntro,
  renderExperienceCards,
} from "../../packages/shared/src/index.js";
import {
  CATEGORIES,
  DAYS,
  createDefaultPlan,
  evaluateBalance,
  formatMinutes,
  getBalancePercentages,
  getDayTotals,
  getWeeklyTotals,
  sanitizePlan,
  updatePlan,
} from "./logic.js";

const APP_ID = "media-time";
const PLAN_KEY = "weekly-plan";
const config = getAppConfig(APP_ID);
const storage = createStorage(APP_ID);
const categoryById = new Map(CATEGORIES.map((category) => [category.id, category]));
const dayById = new Map(DAYS.map((day) => [day.id, day]));

const elements = {
  appIntro: document.querySelector("#app-intro"),
  experienceSection: document.querySelector("#experiences"),
  experienceCards: document.querySelector("#experience-cards"),
  planner: document.querySelector("#week-planner"),
  form: document.querySelector("#plan-form"),
  head: document.querySelector("#planner-head"),
  body: document.querySelector("#planner-body"),
  foot: document.querySelector("#planner-foot"),
  metrics: document.querySelector("#weekly-metrics"),
  bars: document.querySelector("#balance-bars"),
  feedback: document.querySelector("#balance-feedback"),
  status: document.querySelector("#plan-status"),
  reset: document.querySelector("#reset-plan"),
};

const storedPlan = storage.get(PLAN_KEY, null);
let plan = sanitizePlan(storedPlan);
let highlightTimer;

function renderStaticContent() {
  elements.appIntro.innerHTML = renderAppIntro(config);

  const experiences = config.domainExperiences ?? config.experiences ?? [];
  if (experiences.length > 0) {
    elements.experienceCards.innerHTML = renderExperienceCards(experiences);
  } else {
    elements.experienceSection.hidden = true;
  }
}

function inputId(dayId, categoryId) {
  return `minutes-${dayId}-${categoryId}`;
}

function renderPlanner() {
  elements.head.innerHTML = `
    <tr>
      <th scope="col">Tag</th>
      ${CATEGORIES.map(
        (category) => `
          <th scope="col" data-category-heading="${escapeHTML(category.id)}">
            <span>${escapeHTML(category.label)}</span>
            <small id="category-${escapeHTML(category.id)}-description">${escapeHTML(category.description)}</small>
          </th>
        `,
      ).join("")}
      <th scope="col"><span>Bildschirm</span><small>Lernen + Kreativ</small></th>
      <th scope="col"><span>Gesamt</span><small>alle Kategorien</small></th>
    </tr>
  `;

  elements.body.innerHTML = DAYS.map(
    (day) => `
      <tr>
        <th scope="row">${escapeHTML(day.label)}</th>
        ${CATEGORIES.map(
          (category) => `
            <td data-category-cell="${escapeHTML(category.id)}">
              <label class="visually-hidden" for="${inputId(day.id, category.id)}">
                ${escapeHTML(category.label)} am ${escapeHTML(day.label)} in Minuten
              </label>
              <input
                id="${inputId(day.id, category.id)}"
                class="minute-input"
                type="number"
                inputmode="numeric"
                min="0"
                max="600"
                step="5"
                value="${plan[day.id][category.id]}"
                data-day-id="${escapeHTML(day.id)}"
                data-category-id="${escapeHTML(category.id)}"
                aria-describedby="category-${escapeHTML(category.id)}-description"
              />
              <span class="minute-suffix" aria-hidden="true">Min.</span>
            </td>
          `,
        ).join("")}
        <td class="day-total"><output id="digital-${escapeHTML(day.id)}"></output></td>
        <td class="day-total"><output id="total-${escapeHTML(day.id)}"></output></td>
      </tr>
    `,
  ).join("");

  elements.foot.innerHTML = `
    <tr>
      <th scope="row">Woche</th>
      ${CATEGORIES.map(
        (category) => `<td><output id="weekly-${escapeHTML(category.id)}"></output></td>`,
      ).join("")}
      <td><output id="weekly-digital"></output></td>
      <td><output id="weekly-total"></output></td>
    </tr>
  `;
}

function renderDailyTotals() {
  for (const day of DAYS) {
    const totals = getDayTotals(plan, day.id);
    document.querySelector(`#digital-${day.id}`).textContent = formatMinutes(totals.digital);
    document.querySelector(`#total-${day.id}`).textContent = formatMinutes(totals.total);
  }
}

function renderWeeklyTotals() {
  const totals = getWeeklyTotals(plan);
  const percentages = getBalancePercentages(plan);

  for (const category of CATEGORIES) {
    document.querySelector(`#weekly-${category.id}`).textContent = formatMinutes(
      totals[category.id],
    );
  }
  document.querySelector("#weekly-digital").textContent = formatMinutes(totals.digital);
  document.querySelector("#weekly-total").textContent = formatMinutes(totals.total);

  elements.metrics.innerHTML = `
    <div class="metric metric--total">
      <span>Gesamt geplant</span>
      <strong>${escapeHTML(formatMinutes(totals.total))}</strong>
    </div>
    <div class="metric">
      <span>Davon Bildschirm</span>
      <strong>${escapeHTML(formatMinutes(totals.digital))}</strong>
    </div>
    <div class="metric">
      <span>Davon offline</span>
      <strong>${escapeHTML(formatMinutes(totals.offline))}</strong>
    </div>
  `;

  elements.bars.innerHTML = CATEGORIES.map(
    (category) => `
      <div class="balance-row" data-category-summary="${escapeHTML(category.id)}">
        <div class="balance-row__label">
          <span>${escapeHTML(category.label)}</span>
          <strong>${percentages[category.id]} %</strong>
        </div>
        <div class="balance-track" aria-hidden="true">
          <span style="width: ${percentages[category.id]}%"></span>
        </div>
        <small>${escapeHTML(formatMinutes(totals[category.id]))}</small>
      </div>
    `,
  ).join("");
}

function renderFeedback() {
  const levelLabels = {
    info: "Start",
    warning: "Prüfen",
    tip: "Idee",
    success: "Ausgewogen",
  };

  elements.feedback.innerHTML = evaluateBalance(plan)
    .map(
      (item) => `
        <li class="feedback-item" data-level="${escapeHTML(item.level)}">
          <span>${escapeHTML(levelLabels[item.level] ?? "Hinweis")}</span>
          <p>${escapeHTML(item.message)}</p>
        </li>
      `,
    )
    .join("");
}

function renderSummary() {
  renderDailyTotals();
  renderWeeklyTotals();
  renderFeedback();
}

function persistPlan() {
  storage.set(PLAN_KEY, plan);
}

function updateFromInput(input, { normalizeInput = false } = {}) {
  const { dayId, categoryId } = input.dataset;
  if (!dayById.has(dayId) || !categoryById.has(categoryId)) {
    return;
  }

  plan = updatePlan(plan, dayId, categoryId, input.value);
  if (normalizeInput) {
    input.value = String(plan[dayId][categoryId]);
  }
  persistPlan();
  renderSummary();
}

function clearIntentHighlight() {
  window.clearTimeout(highlightTimer);
  document.querySelectorAll(".intent-highlight").forEach((element) => {
    element.classList.remove("intent-highlight");
  });
}

function focusExperienceIntent(intent) {
  if (!categoryById.has(intent)) {
    return;
  }

  clearIntentHighlight();
  const targets = document.querySelectorAll(
    `[data-category-heading="${intent}"], [data-category-cell="${intent}"], [data-category-summary="${intent}"]`,
  );
  targets.forEach((target) => target.classList.add("intent-highlight"));

  elements.planner.scrollIntoView({ behavior: "smooth", block: "start" });
  const firstInput = elements.form.querySelector(`[data-category-id="${intent}"]`);
  firstInput?.focus({ preventScroll: true });

  const category = categoryById.get(intent);
  elements.status.textContent = `${category.label} ist markiert. Passe die Minuten an den Tagen an, die du planen möchtest.`;
  highlightTimer = window.setTimeout(clearIntentHighlight, 2800);
}

renderStaticContent();
renderPlanner();
renderSummary();

if (storedPlan !== null) {
  elements.status.textContent = "Dein zuletzt gespeicherter Wochenplan wurde auf diesem Gerät wiederhergestellt.";
}

elements.form.addEventListener("submit", (event) => event.preventDefault());

elements.form.addEventListener("input", (event) => {
  const input = event.target.closest(".minute-input");
  if (input) {
    updateFromInput(input);
  }
});

elements.form.addEventListener("change", (event) => {
  const input = event.target.closest(".minute-input");
  if (!input) {
    return;
  }

  updateFromInput(input, { normalizeInput: true });
  const day = dayById.get(input.dataset.dayId);
  const category = categoryById.get(input.dataset.categoryId);
  elements.status.textContent = `${category.label} am ${day.label}: ${formatMinutes(
    plan[day.id][category.id],
  )} lokal gespeichert.`;
});

elements.reset.addEventListener("click", () => {
  plan = createDefaultPlan();
  storage.remove(PLAN_KEY);
  clearIntentHighlight();
  renderPlanner();
  renderSummary();
  elements.status.textContent = "Die Standardwoche wurde wiederhergestellt und der gespeicherte Plan gelöscht.";
  elements.reset.focus();
});

elements.experienceCards.addEventListener("click", (event) => {
  const intentControl = event.target.closest("[data-experience-intent]");
  if (!intentControl) {
    return;
  }

  event.preventDefault();
  focusExperienceIntent(intentControl.dataset.experienceIntent);
});
