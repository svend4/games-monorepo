import {
  createStorage,
  escapeHTML,
  getAppConfig,
  renderAppIntro,
  renderExperienceCards,
} from "../../packages/shared/src/index.js";
import {
  SAFE_RESULTS,
  SEARCH_CATEGORIES,
  addHistoryEntry,
  createHistoryEntry,
  filterResults,
  getCategoryForExperienceIntent,
  getSavedResults,
  sanitizeHistory,
  sanitizeStoredIds,
  toggleSavedId,
} from "./logic.js";

const config = getAppConfig("safe-search");
const storage = createStorage("safe-search");
const categoryLabels = new Map(
  SEARCH_CATEGORIES.map((category) => [category.id, category.label]),
);

const elements = {
  appIntro: document.querySelector("#app-intro"),
  experienceCards: document.querySelector("#experience-cards"),
  search: document.querySelector("#search"),
  form: document.querySelector("#search-form"),
  query: document.querySelector("#search-query"),
  category: document.querySelector("#search-category"),
  clearSearch: document.querySelector("#clear-search"),
  status: document.querySelector("#search-status"),
  results: document.querySelector("#search-results"),
  savedResults: document.querySelector("#saved-results"),
  savedCount: document.querySelector("#saved-count"),
  history: document.querySelector("#search-history"),
  clearHistory: document.querySelector("#clear-history"),
};

let state = {
  query: "",
  category: "all",
  savedIds: sanitizeStoredIds(storage.get("saved", [])),
  history: sanitizeHistory(storage.get("history", [])),
};

function renderStaticContent() {
  elements.appIntro.innerHTML = renderAppIntro(config);
  elements.experienceCards.innerHTML = renderExperienceCards(
    config.domainExperiences,
  );
  elements.category.innerHTML = SEARCH_CATEGORIES.map(
    (category) =>
      `<option value="${escapeHTML(category.id)}">${escapeHTML(category.label)}</option>`,
  ).join("");
}

function renderSafetyReasons(reasons) {
  return `
    <details class="safety-explanation">
      <summary>Warum ist dieser Startpunkt sicher?</summary>
      <ul>
        ${reasons.map((reason) => `<li>${escapeHTML(reason)}</li>`).join("")}
      </ul>
      <p class="safety-explanation__note">
        Sicher bedeutet nicht unfehlbar: Prüfe Datum, Autor und Aussage erneut.
      </p>
    </details>
  `;
}

function renderResultCard(result) {
  const isSaved = state.savedIds.includes(result.id);
  const categoryLabel = categoryLabels.get(result.category) ?? result.category;

  return `
    <article class="result-card" aria-labelledby="result-${escapeHTML(result.id)}-title">
      <div class="result-card__meta">
        <span class="topic-badge">${escapeHTML(categoryLabel)}</span>
        <span>${escapeHTML(result.ageLabel)}</span>
      </div>
      <h3 id="result-${escapeHTML(result.id)}-title">${escapeHTML(result.title)}</h3>
      <p>${escapeHTML(result.description)}</p>
      <p class="result-card__source">
        Geprüfter Startpunkt: <strong>${escapeHTML(result.source)}</strong>
      </p>
      ${renderSafetyReasons(result.safetyReasons)}
      <div class="result-card__actions">
        <a
          class="button button--secondary"
          href="${escapeHTML(result.url)}"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="${escapeHTML(result.title)} in einem neuen Tab öffnen"
        >
          Quelle öffnen <span aria-hidden="true">↗</span>
        </a>
        <button
          class="save-button"
          type="button"
          data-save-id="${escapeHTML(result.id)}"
          aria-pressed="${isSaved}"
        >
          <span aria-hidden="true">${isSaved ? "★" : "☆"}</span>
          ${isSaved ? "Gespeichert" : "Speichern"}
        </button>
      </div>
    </article>
  `;
}

function renderResults() {
  const visibleResults = filterResults(SAFE_RESULTS, state);
  const hasFilter = Boolean(state.query) || state.category !== "all";

  elements.status.textContent = `${visibleResults.length} ${
    visibleResults.length === 1 ? "sicherer Startpunkt" : "sichere Startpunkte"
  } gefunden${hasFilter ? " für deine Auswahl" : ""}.`;

  if (visibleResults.length === 0) {
    elements.results.innerHTML = `
      <div class="empty-state empty-state--wide">
        <h3>Noch kein passender Treffer</h3>
        <p>Probiere ein kürzeres Wort, einen anderen Themenraum oder zeige alle Quellen.</p>
        <button class="button button--secondary" type="button" data-reset-search>
          Alle Startpunkte zeigen
        </button>
      </div>
    `;
    return;
  }

  elements.results.innerHTML = visibleResults.map(renderResultCard).join("");
}

function renderSaved() {
  const savedResults = getSavedResults(SAFE_RESULTS, state.savedIds);
  elements.savedCount.textContent = String(savedResults.length);
  elements.savedCount.setAttribute(
    "aria-label",
    `${savedResults.length} gespeicherte ${
      savedResults.length === 1 ? "Quelle" : "Quellen"
    }`,
  );

  if (savedResults.length === 0) {
    elements.savedResults.innerHTML = `
      <p class="empty-state">
        Speichere einen guten Startpunkt mit dem Stern. Er bleibt auf diesem Gerät erhalten.
      </p>
    `;
    return;
  }

  elements.savedResults.innerHTML = `
    <ul class="saved-list">
      ${savedResults
        .map(
          (result) => `
            <li>
              <div>
                <strong>${escapeHTML(result.title)}</strong>
                <span>${escapeHTML(result.source)}</span>
              </div>
              <button
                class="icon-button"
                type="button"
                data-save-id="${escapeHTML(result.id)}"
                aria-label="${escapeHTML(result.title)} aus gespeicherten Quellen entfernen"
              >×</button>
            </li>
          `,
        )
        .join("")}
    </ul>
  `;
}

function formatHistoryTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "Zeit unbekannt";
  }

  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function renderHistory() {
  elements.clearHistory.disabled = state.history.length === 0;

  if (state.history.length === 0) {
    elements.history.innerHTML = `
      <p class="empty-state">Deine abgeschlossenen Suchen erscheinen hier.</p>
    `;
    return;
  }

  elements.history.innerHTML = `
    <ol class="history-list">
      ${state.history
        .map((entry) => {
          const categoryLabel = categoryLabels.get(entry.category) ?? "Alle Themen";
          const searchLabel = entry.query || categoryLabel;
          return `
            <li>
              <button
                type="button"
                data-history-query="${escapeHTML(entry.query)}"
                data-history-category="${escapeHTML(entry.category)}"
              >
                <strong>${escapeHTML(searchLabel)}</strong>
                <span>${escapeHTML(categoryLabel)} · ${entry.resultCount} Treffer</span>
                <time datetime="${escapeHTML(entry.timestamp)}">${escapeHTML(
                  formatHistoryTime(entry.timestamp),
                )}</time>
              </button>
            </li>
          `;
        })
        .join("")}
    </ol>
  `;
}

function persistSaved() {
  storage.set("saved", state.savedIds);
}

function persistHistory() {
  storage.set("history", state.history);
}

function resetSearch({ focus = false } = {}) {
  state = { ...state, query: "", category: "all" };
  elements.form.reset();
  elements.category.value = "all";
  renderResults();
  if (focus) {
    elements.query.focus();
  }
}

function commitSearch() {
  state = {
    ...state,
    query: elements.query.value.trim(),
    category: elements.category.value,
  };
  const visibleResults = filterResults(SAFE_RESULTS, state);
  const entry = createHistoryEntry({
    query: state.query,
    category: state.category,
    resultCount: visibleResults.length,
  });
  state.history = addHistoryEntry(state.history, entry);
  persistHistory();
  renderResults();
  renderHistory();
  elements.results.focus({ preventScroll: true });
}

function handleSavedToggle(resultId) {
  state.savedIds = toggleSavedId(state.savedIds, resultId);
  persistSaved();
  renderResults();
  renderSaved();
}

function applyExperienceIntent(intent) {
  const category = getCategoryForExperienceIntent(intent);
  if (!category) {
    return false;
  }

  state = { ...state, category };
  elements.category.value = category;
  renderResults();
  elements.search.scrollIntoView({ behavior: "smooth", block: "start" });
  elements.query.focus({ preventScroll: true });
  return true;
}

renderStaticContent();
renderResults();
renderSaved();
renderHistory();

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  commitSearch();
});

elements.query.addEventListener("input", () => {
  state.query = elements.query.value.trim();
  renderResults();
});

elements.category.addEventListener("change", () => {
  state.category = elements.category.value;
  renderResults();
});

elements.experienceCards.addEventListener("click", (event) => {
  const intentControl = event.target.closest("[data-experience-intent]");
  if (!intentControl) {
    return;
  }

  if (applyExperienceIntent(intentControl.dataset.experienceIntent)) {
    event.preventDefault();
  }
});

elements.clearSearch.addEventListener("click", () => resetSearch({ focus: true }));

elements.results.addEventListener("click", (event) => {
  const saveButton = event.target.closest("[data-save-id]");
  if (saveButton) {
    handleSavedToggle(saveButton.dataset.saveId);
    return;
  }

  if (event.target.closest("[data-reset-search]")) {
    resetSearch({ focus: true });
  }
});

elements.savedResults.addEventListener("click", (event) => {
  const saveButton = event.target.closest("[data-save-id]");
  if (saveButton) {
    handleSavedToggle(saveButton.dataset.saveId);
  }
});

elements.history.addEventListener("click", (event) => {
  const historyButton = event.target.closest("[data-history-query]");
  if (!historyButton) {
    return;
  }

  state.query = historyButton.dataset.historyQuery ?? "";
  state.category = historyButton.dataset.historyCategory ?? "all";
  elements.query.value = state.query;
  elements.category.value = state.category;
  renderResults();
  document.querySelector("#search").scrollIntoView({ behavior: "smooth" });
});

elements.clearHistory.addEventListener("click", () => {
  state.history = [];
  storage.remove("history");
  renderHistory();
  elements.clearHistory.focus();
});
