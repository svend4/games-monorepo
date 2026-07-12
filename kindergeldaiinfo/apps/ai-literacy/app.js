import {
  createStorage,
  escapeHTML,
  getAppConfig,
  renderAppIntro,
  renderExperienceCards,
} from "../../packages/shared/src/index.js";
import {
  EXERCISES,
  createInitialProgress,
  getExercise,
  evaluateAnswer,
  getProgressSummary,
  normalizeProgress,
  updateProgress,
} from "./logic.js";

const APP_ID = "ai-literacy";
const PROGRESS_KEY = "exercise-progress";
const config = getAppConfig(APP_ID);
const storage = createStorage(APP_ID);

const intro = document.querySelector("#app-intro");
const experienceSection = document.querySelector("#experiences");
const experienceCards = document.querySelector("#experience-cards");
const exerciseList = document.querySelector("#exercise-list");
const progressBar = document.querySelector("#progress-bar");
const progressCopy = document.querySelector("#progress-copy");
const scoreCopy = document.querySelector("#score-copy");
const completionNote = document.querySelector("#completion-note");
const resetButton = document.querySelector("#reset-progress");
let activeExerciseId = null;

let progress = normalizeProgress(storage.get(PROGRESS_KEY, createInitialProgress()));

intro.innerHTML = renderAppIntro(config);
const experiences = config.domainExperiences ?? config.experiences ?? [];
if (experiences.length > 0) {
  experienceCards.innerHTML = renderExperienceCards(experiences);
  prepareExperienceIntents();
} else {
  experienceSection.hidden = true;
}
if (config.title) document.title = `${config.title} · AI Literacy Lab`;

function prepareExperienceIntents() {
  for (const control of experienceCards.querySelectorAll("[data-experience-intent]")) {
    const exerciseId = control.dataset.experienceIntent;
    if (getExercise(exerciseId)) {
      control.setAttribute("aria-controls", `exercise-${exerciseId}`);
    }
  }
}

function activateExercise(exerciseId) {
  if (!getExercise(exerciseId)) return;

  const card = exerciseList.querySelector(`[data-exercise-id="${exerciseId}"]`);
  if (!card) return;

  activeExerciseId = exerciseId;
  for (const exerciseCard of exerciseList.querySelectorAll("[data-exercise-id]")) {
    exerciseCard.toggleAttribute("data-selected", exerciseCard === card);
  }

  for (const control of experienceCards.querySelectorAll("[data-experience-intent]")) {
    if (control.dataset.experienceIntent === exerciseId) {
      control.setAttribute("aria-current", "location");
    } else {
      control.removeAttribute("aria-current");
    }
  }

  card.hidden = false;
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  card.querySelector("input")?.focus({ preventScroll: true });
}

function optionMarkup(exercise, option, selected) {
  const inputType = exercise.kind === "multiple" ? "checkbox" : "radio";
  return `
    <label class="answer-option">
      <input
        type="${inputType}"
        name="answer-${escapeHTML(exercise.id)}"
        value="${escapeHTML(option.id)}"
        ${selected ? "checked" : ""}
      >
      <span>${escapeHTML(option.label)}</span>
    </label>
  `;
}

function exerciseMarkup(exercise, index) {
  const saved = progress.answers[exercise.id];
  const selected = new Set(saved?.selectedAnswers ?? []);
  const instruction = exercise.kind === "multiple" ? "Choose all that apply." : "Choose one answer.";

  return `
    <article class="exercise-card" id="exercise-${escapeHTML(exercise.id)}" data-exercise-id="${escapeHTML(exercise.id)}">
      <header class="exercise-header">
        <span class="exercise-number">0${index + 1}</span>
        <div>
          <p>${escapeHTML(exercise.skill)}</p>
          <h3>${escapeHTML(exercise.title)}</h3>
        </div>
        <span class="exercise-state" data-state aria-live="polite">${saved ? (saved.correct ? "Checked · correct" : "Checked · try again") : "Not checked"}</span>
      </header>
      <div class="scenario-box">
        <p>${escapeHTML(exercise.prompt)}</p>
      </div>
      <fieldset>
        <legend>${escapeHTML(instruction)}</legend>
        <div class="answer-list">
          ${exercise.options.map((option) => optionMarkup(exercise, option, selected.has(option.id))).join("")}
        </div>
      </fieldset>
      <div class="exercise-actions">
        <button class="check-button" type="button" data-check>${saved ? "Check again" : "Check answer"}</button>
      </div>
      <div class="feedback-panel" data-feedback role="status" aria-live="polite" tabindex="-1" ${saved ? "" : "hidden"}></div>
    </article>
  `;
}

function renderSavedFeedback() {
  for (const exercise of EXERCISES) {
    const saved = progress.answers[exercise.id];
    if (!saved) continue;
    const result = evaluateAnswer(exercise.id, saved.selectedAnswers);
    renderFeedback(exerciseList.querySelector(`[data-exercise-id="${exercise.id}"]`), result);
  }
}

function renderFeedback(card, result) {
  const panel = card.querySelector("[data-feedback]");
  const state = card.querySelector("[data-state]");
  const answerLine = result.correct
    ? ""
    : `<p class="answer-reveal"><strong>Best answer:</strong> ${result.correctLabels.map(escapeHTML).join("; ")}</p>`;

  panel.hidden = false;
  panel.dataset.result = result.correct ? "correct" : "retry";
  panel.innerHTML = `
    <h4>${result.correct ? "Strong check" : "Take another look"}</h4>
    <p>${escapeHTML(result.feedback)}</p>
    ${answerLine}
    <p class="explanation"><strong>Why:</strong> ${escapeHTML(result.explanation)}</p>
  `;
  state.textContent = result.correct ? "Checked · correct" : "Checked · try again";
  card.querySelector("[data-check]").textContent = "Check again";
}

function updateProgressPanel() {
  const summary = getProgressSummary(progress);
  progressBar.value = summary.completed;
  progressBar.textContent = `${summary.completed} of ${summary.total}`;
  progressCopy.textContent = `${summary.completed} of ${summary.total} exercises checked`;
  scoreCopy.textContent = `${summary.correct} / ${summary.total}`;
  completionNote.hidden = !summary.isComplete;
}

function renderAll() {
  exerciseList.innerHTML = EXERCISES.map(exerciseMarkup).join("");
  renderSavedFeedback();
  updateProgressPanel();
  if (activeExerciseId) {
    exerciseList.querySelector(`[data-exercise-id="${activeExerciseId}"]`)?.toggleAttribute("data-selected", true);
  }
}

experienceCards.addEventListener("click", (event) => {
  const control = event.target.closest("[data-experience-intent]");
  if (!control || !experienceCards.contains(control)) return;

  event.preventDefault();
  activateExercise(control.dataset.experienceIntent);
});

exerciseList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-check]");
  if (!button) return;

  const card = button.closest("[data-exercise-id]");
  const exerciseId = card.dataset.exerciseId;
  const selected = [...card.querySelectorAll("input:checked")].map((input) => input.value);
  const result = evaluateAnswer(exerciseId, selected);

  if (selected.length === 0) {
    const panel = card.querySelector("[data-feedback]");
    panel.hidden = false;
    panel.dataset.result = "retry";
    panel.innerHTML = `<h4>Choose first</h4><p>${escapeHTML(result.feedback)}</p>`;
    card.querySelector("input")?.focus();
    return;
  }

  progress = updateProgress(progress, exerciseId, result);
  storage.set(PROGRESS_KEY, progress);
  renderFeedback(card, result);
  updateProgressPanel();
  card.querySelector("[data-feedback]").focus?.();
});

resetButton.addEventListener("click", () => {
  storage.remove(PROGRESS_KEY);
  progress = createInitialProgress();
  renderAll();
  resetButton.focus();
});

renderAll();
