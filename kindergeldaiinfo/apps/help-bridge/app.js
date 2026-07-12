import {
  createStorage,
  escapeHTML,
  getAppConfig,
  renderAppIntro,
  renderExperienceCards,
} from "../../packages/shared/src/index.js";
import {
  assessUrgency,
  buildSafetyPlan,
  createPersistableDraft,
  getDraftCompletion,
  normalizeDraft,
} from "./logic.js";

const APP_ID = "help-bridge";
const DRAFT_KEY = "triage-draft";
const config = getAppConfig(APP_ID);
const storage = createStorage(APP_ID);

const intro = document.querySelector("#app-intro");
const experienceSection = document.querySelector("#experiences");
const experienceCards = document.querySelector("#experience-cards");
const form = document.querySelector("#triage-form");
const steps = [...document.querySelectorAll(".form-step")];
const nextButton = document.querySelector("#next-button");
const backButton = document.querySelector("#back-button");
const planButton = document.querySelector("#plan-button");
const saveButton = document.querySelector("#save-button");
const clearButton = document.querySelector("#clear-button");
const saveStatus = document.querySelector("#save-status");
const stepLabel = document.querySelector("#step-label");
const meterFill = document.querySelector("#meter-fill");
const immediateWarning = document.querySelector("#immediate-warning");

let currentStep = 0;

intro.innerHTML = renderAppIntro(config);
const experiences = config.domainExperiences ?? config.experiences ?? [];
if (experiences.length > 0) {
  experienceCards.innerHTML = renderExperienceCards(experiences);
} else {
  experienceSection.hidden = true;
}

if (config.title) document.title = `${config.title} · Help Bridge`;

function formValue() {
  return normalizeDraft(Object.fromEntries(new FormData(form).entries()));
}

function setFormValue(draftValue) {
  const draft = normalizeDraft(draftValue);
  for (const [name, value] of Object.entries(draft)) {
    const controls = [...form.querySelectorAll(`[name="${name}"]`)];
    for (const control of controls) {
      if (control.type === "radio") {
        control.checked = name === "incidentType"
          ? control.value === value
          : value !== null && control.value === (value ? "yes" : "no");
      } else {
        control.value = value ?? "";
      }
    }
  }
}

function setStatus(message) {
  saveStatus.textContent = message;
}

function updateImmediateWarning() {
  const urgency = assessUrgency(formValue());
  immediateWarning.hidden = !urgency.emergency;
}

function validateStep(index) {
  const requiredControls = [...steps[index].querySelectorAll("[required]")];
  const checkedNames = new Set();

  for (const control of requiredControls) {
    if (control.type === "radio") {
      if (checkedNames.has(control.name)) continue;
      checkedNames.add(control.name);
      const selected = steps[index].querySelector(`[name="${control.name}"]:checked`);
      if (!selected) {
        control.setCustomValidity("Choose an answer to continue.");
        control.reportValidity();
        control.setCustomValidity("");
        return false;
      }
    } else if (!control.checkValidity()) {
      control.reportValidity();
      return false;
    }
  }
  return true;
}

function showStep(index, { focus = true } = {}) {
  currentStep = Math.max(0, Math.min(index, steps.length - 1));
  steps.forEach((step, stepIndex) => { step.hidden = stepIndex !== currentStep; });

  const isPlan = currentStep === steps.length - 1;
  nextButton.hidden = currentStep >= steps.length - 2;
  planButton.hidden = currentStep !== steps.length - 2;
  backButton.hidden = currentStep === 0;
  stepLabel.textContent = `Step ${currentStep + 1} of ${steps.length}`;
  meterFill.style.width = `${((currentStep + 1) / steps.length) * 100}%`;

  if (currentStep === 1) {
    immediateWarning.hidden = true;
    updateImmediateWarning();
  }

  if (focus) {
    const heading = steps[currentStep].querySelector("h3, [tabindex='-1']");
    heading?.focus({ preventScroll: true });
    steps[currentStep].scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  if (isPlan) renderPlan();
}

function renderPlan() {
  const { urgency, steps: planSteps } = buildSafetyPlan(formValue());
  const panel = document.querySelector("#urgency-panel");
  panel.dataset.level = urgency.level;
  document.querySelector("#urgency-label").textContent = urgency.label;
  document.querySelector("#plan-title").textContent = urgency.emergency
    ? "Start with immediate safety"
    : "Your calm next-step plan";
  document.querySelector("#urgency-summary").textContent = urgency.summary;
  document.querySelector("#plan-list").innerHTML = planSteps.map((step) => `
    <li>
      <span class="plan-number" aria-hidden="true"></span>
      <div><h4>${escapeHTML(step.title)}</h4><p>${escapeHTML(step.detail)}</p></div>
    </li>
  `).join("");
}

nextButton.addEventListener("click", () => {
  if (!validateStep(currentStep)) return;
  showStep(currentStep + 1);
});

backButton.addEventListener("click", () => showStep(currentStep - 1));

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!validateStep(currentStep)) return;
  showStep(steps.length - 1);
  setStatus("Plan built without saving. Any previously saved draft was left unchanged. Use Save draft to keep only the structured check-in choices.");
});

saveButton.addEventListener("click", () => {
  const draft = formValue();
  const completion = getDraftCompletion(draft);
  storage.set(DRAFT_KEY, createPersistableDraft(draft));
  setStatus(`Draft saved on this device (${completion.complete} of ${completion.total} check-in answers complete). Only check-in choices and the trusted-adult role were stored; names and notes were not saved.`);
});

clearButton.addEventListener("click", () => {
  form.reset();
  storage.remove(DRAFT_KEY);
  setStatus("Your saved Help Bridge draft was cleared from this device.");
  updateImmediateWarning();
  showStep(0);
});

form.addEventListener("change", (event) => {
  if (steps[1].contains(event.target)) {
    updateImmediateWarning();
  }
});

experienceCards.addEventListener("click", (event) => {
  const intentControl = event.target.closest("[data-experience-intent]");
  if (!intentControl) {
    return;
  }

  const incidentType = normalizeDraft({
    incidentType: intentControl.dataset.experienceIntent,
  }).incidentType;
  if (!incidentType) {
    return;
  }

  event.preventDefault();
  const incidentControl = [...form.querySelectorAll('[name="incidentType"]')].find(
    (control) => control.value === incidentType,
  );
  if (incidentControl) {
    incidentControl.checked = true;
  }
  showStep(0);
  incidentControl?.focus({ preventScroll: true });
  setStatus("Starting point selected. Review it, then continue when you are ready.");
});

const savedDraft = storage.get(DRAFT_KEY, null);
if (savedDraft) {
  const structuredDraft = createPersistableDraft(savedDraft);
  storage.set(DRAFT_KEY, structuredDraft);
  setFormValue(structuredDraft);
  const completion = getDraftCompletion(structuredDraft);
  setStatus(`Saved draft restored (${completion.percent}% complete). Names and notes are never restored because they are not saved.`);
}

showStep(0, { focus: false });
