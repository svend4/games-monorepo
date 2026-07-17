import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const cdpOrigin = (process.env.CDP_ORIGIN ?? "http://127.0.0.1:9223").replace(/\/+$/, "");
const appOrigin = (process.env.APP_ORIGIN ?? "http://127.0.0.1/01/kindergeldaiinfo").replace(/\/+$/, "");
const artifactDirectory = path.resolve(process.env.ARTIFACT_DIR ?? "artifacts");

async function waitForChrome(timeoutMs = 12_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${cdpOrigin}/json/list`);
      if (response.ok) return response.json();
    } catch {
      // The browser process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Chrome DevTools did not become ready.");
}

const targets = await waitForChrome();
const pageTarget = targets.find((target) => target.type === "page");
assert.ok(pageTarget?.webSocketDebuggerUrl, "A headless page target is required.");

const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
const pending = new Map();
const pageEvents = [];
const browserErrors = [];

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const operation = pending.get(message.id);
    if (!operation) return;
    pending.delete(message.id);
    if (message.error) operation.reject(new Error(message.error.message));
    else operation.resolve(message.result);
    return;
  }

  pageEvents.push(message);
  if (message.method === "Runtime.exceptionThrown") {
    const details = message.params.exceptionDetails;
    browserErrors.push(details.exception?.description ?? `${details.text} at ${details.url}:${details.lineNumber}`);
  }
  if (message.method === "Log.entryAdded" && ["error", "warning"].includes(message.params.entry.level)) {
    browserErrors.push(`${message.params.entry.level}: ${message.params.entry.text}`);
  }
});

function send(method, params = {}) {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function navigate(pathname) {
  pageEvents.length = 0;
  await send("Page.navigate", { url: `${appOrigin}${pathname}` });
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    if (pageEvents.some((event) => event.method === "Page.loadEventFired")) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await evaluate("for (let attempt = 0; attempt < 40 && document.readyState !== 'complete'; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50)); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); return true;");
}

async function screenshot(name, width, height, fullPage = true) {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
  const metrics = await send("Page.getLayoutMetrics");
  const content = metrics.cssContentSize ?? metrics.contentSize;
  const clip = fullPage
    ? { x: 0, y: 0, width: Math.min(content.width, width), height: content.height, scale: 1 }
    : undefined;
  const capture = await send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: fullPage,
    ...(clip ? { clip } : {}),
  });
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(path.join(artifactDirectory, name), Buffer.from(capture.data, "base64"));
}

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Storage.clearDataForOrigin", { origin: appOrigin, storageTypes: "all" });

const report = {};

await navigate("/");
report.portal = await evaluate(`
  return {
    title: document.title,
    cards: document.querySelectorAll(".portal-card").length,
    heading: document.querySelector("h1")?.textContent.trim(),
    links: [...document.querySelectorAll(".portal-card a")].map((link) => link.getAttribute("href")),
    cardLanguages: [...document.querySelectorAll(".portal-card")].map((card) => card.lang),
  };
`);
assert.equal(report.portal.cards, 4);
assert.equal(report.portal.links.length, 4);
assert.deepEqual(report.portal.cardLanguages, ["de", "de", "en", "en"]);
await screenshot("portal-desktop.png", 1440, 1000);

await navigate("/apps/safe-search/#search-news");
report.safeSearch = await evaluate(`
  const deepLinkCategory = document.querySelector("#search-category").value;
  document.querySelector('[data-experience-intent="school"]').click();
  const intentCategory = document.querySelector("#search-category").value;
  const intentFocused = document.activeElement.id;
  const query = document.querySelector("#search-query");
  query.value = "Tiere";
  query.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector("#search-form").requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const submitFocus = document.activeElement.id;
  query.value = "";
  query.dispatchEvent(new Event("input", { bubbles: true }));
  const resultIds = [...document.querySelectorAll("#search-results [data-save-id]")]
    .slice(0, 2)
    .map((button) => button.dataset.saveId);
  if (resultIds.length !== 2) throw new Error("Safe Search focus smoke needs two results.");

  const findResultToggle = (resultId) =>
    [...document.querySelectorAll("#search-results [data-save-id]")]
      .find((button) => button.dataset.saveId === resultId);
  findResultToggle(resultIds[0]).click();
  const resultToggleFocused =
    document.querySelector("#search-results").contains(document.activeElement) &&
    document.activeElement.dataset.saveId === resultIds[0];

  findResultToggle(resultIds[1]).click();
  document.querySelector("#saved-results [data-save-id]").click();
  const savedNextFocused = document.activeElement.dataset.saveId === resultIds[1];
  document.activeElement.click();
  const savedRemovalFocus = document.activeElement.id;

  findResultToggle(resultIds[0]).click();
  return {
    intents: document.querySelectorAll("[data-experience-intent]").length,
    languages: [
      document.documentElement.lang,
      document.querySelector("#app-intro").closest("[lang]")?.lang,
      document.querySelector("#experience-cards").closest("[lang]")?.lang,
    ],
    deepLinkCategory,
    hash: window.location.hash,
    intentCategory,
    intentFocused,
    submitFocus,
    resultToggleFocused,
    savedNextFocused,
    savedRemovalFocus,
    results: document.querySelectorAll(".result-card").length,
    saved: document.querySelector("#saved-count")?.textContent.trim(),
    history: JSON.parse(localStorage.getItem("safe-search:history") || "[]").length,
  };
`);
assert.equal(report.safeSearch.intents, 3);
assert.deepEqual(report.safeSearch.languages, ["de", "de", "de"]);
assert.equal(report.safeSearch.intentCategory, "school");
assert.equal(report.safeSearch.deepLinkCategory, "news");
assert.equal(report.safeSearch.intentFocused, "search-query");
assert.equal(report.safeSearch.submitFocus, "search-results");
assert.equal(report.safeSearch.resultToggleFocused, true);
assert.equal(report.safeSearch.savedNextFocused, true);
assert.equal(report.safeSearch.savedRemovalFocus, "saved-title");
assert.ok(report.safeSearch.results >= 1);
assert.equal(report.safeSearch.hash, "#search-school");
assert.equal(report.safeSearch.saved, "1");
assert.equal(report.safeSearch.history, 1);
await screenshot("safe-search-mobile.png", 390, 844);

await navigate("/apps/media-time/#week-planner-offline");
report.mediaTime = await evaluate(`
  const tableRegion = document.querySelector(".table-scroll");
  const tableHint = document.querySelector("#planner-scroll-hint");
  const tableDescriptionIds = tableRegion.getAttribute("aria-describedby")?.split(/\\s+/) ?? [];
  const deepLinkApplied = document.querySelector('[data-category-heading="offline"]')
    ?.classList.contains("intent-highlight");
  document.querySelector('[data-experience-intent="learning"]').click();
  const intentCategory = document.activeElement.dataset.categoryId;
  const input = document.querySelector('[data-day-id="monday"][data-category-id="learning"]');
  input.value = "240";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  return {
    intents: document.querySelectorAll("[data-experience-intent]").length,
    languages: [
      document.documentElement.lang,
      document.querySelector("#app-intro").closest("[lang]")?.lang,
      document.querySelector("#experience-cards").closest("[lang]")?.lang,
    ],
    tableOverflow: tableRegion.scrollWidth > tableRegion.clientWidth,
    tableHintLinked: tableDescriptionIds.includes(tableHint?.id),
    tableHintVisible: Boolean(tableHint?.getBoundingClientRect().height),
    tableRegionFocusable: tableRegion.tabIndex === 0,
    intentCategory,
    deepLinkApplied,
    hash: window.location.hash,
    mondayDigital: document.querySelector("#digital-monday")?.textContent.trim(),
    messages: document.querySelectorAll(".feedback-item").length,
    stored: localStorage.getItem("media-time:weekly-plan") !== null,
  };
`);
assert.equal(report.mediaTime.intents, 3);
assert.deepEqual(report.mediaTime.languages, ["de", "de", "de"]);
assert.equal(report.mediaTime.tableOverflow, true);
assert.equal(report.mediaTime.tableHintLinked, true);
assert.equal(report.mediaTime.tableHintVisible, true);
assert.equal(report.mediaTime.tableRegionFocusable, true);
assert.equal(report.mediaTime.intentCategory, "learning");
assert.match(report.mediaTime.mondayDigital, /Std\.|Min\./);
assert.equal(report.mediaTime.deepLinkApplied, true);
assert.ok(report.mediaTime.messages >= 1);
assert.equal(report.mediaTime.hash, "#week-planner-learning");
assert.equal(report.mediaTime.stored, true);
await screenshot("media-time-mobile.png", 390, 844);
report.mediaTime.cleared = await evaluate(`document.querySelector("#reset-plan").click(); return localStorage.getItem("media-time:weekly-plan") === null;`);
assert.equal(report.mediaTime.cleared, true);

await navigate("/apps/help-bridge/#triage-form-hate-speech");
report.helpBridge = await evaluate(`
  const deepLinkIncident = document.querySelector('[name="incidentType"]:checked')?.value;
  document.querySelector('[data-experience-intent="image-pressure"]').click();
  const intentControl = document.querySelector('[name="incidentType"]:checked');
  const intentFocused = document.activeElement === intentControl;
  document.querySelector("#next-button").click();
  document.querySelector('[name="safeNow"][value="yes"]').click();
  for (const name of ["directThreat", "knowsLocation", "repeatedContact"]) {
    document.querySelector('[name="' + name + '"][value="no"]').click();
  }
  document.querySelector('[name="imageShared"][value="yes"]').click();
  document.querySelector("#next-button").click();
  document.querySelector("#adult-role").value = "parent";
  document.querySelector("#adult-name").value = "Smoke Test Adult";
  document.querySelector("#notes").value = "Temporary smoke-test note";
  const beforeBuild = localStorage.getItem("help-bridge:triage-draft");
  document.querySelector("#plan-button").click();
  const afterBuild = localStorage.getItem("help-bridge:triage-draft");
  document.querySelector("#save-button").click();
  await new Promise((resolve) => setTimeout(resolve, 30));
  return {
    intents: document.querySelectorAll("[data-experience-intent]").length,
    languages: [
      document.documentElement.lang,
      document.querySelector("#app-intro").closest("[lang]")?.lang,
      document.querySelector("#experience-cards").closest("[lang]")?.lang,
    ],
    intent: intentControl?.value,
    intentFocused,
    deepLinkIncident,
    hash: window.location.hash,
    title: document.querySelector("#plan-title")?.textContent.trim(),
    urgency: document.querySelector("#urgency-label")?.textContent.trim(),
    steps: document.querySelectorAll("#plan-list li").length,
    beforeBuild,
    afterBuild,
    stored: JSON.parse(localStorage.getItem("help-bridge:triage-draft") || "null"),
  };
`);
assert.equal(report.helpBridge.intents, 3);
assert.deepEqual(report.helpBridge.languages, ["en", "en", "en"]);
assert.equal(report.helpBridge.intent, "image-pressure");
assert.equal(report.helpBridge.intentFocused, true);
assert.equal(report.helpBridge.urgency, "Tell an adult today");
assert.equal(report.helpBridge.deepLinkIncident, "hate-speech");
assert.ok(report.helpBridge.steps >= 4);
assert.equal(report.helpBridge.beforeBuild, null);
assert.equal(report.helpBridge.hash, "#triage-form-image-pressure");
assert.equal(report.helpBridge.afterBuild, null);
assert.ok(report.helpBridge.stored);
assert.equal(Object.hasOwn(report.helpBridge.stored, "adultName"), false);
assert.equal(Object.hasOwn(report.helpBridge.stored, "notes"), false);
await screenshot("help-bridge-mobile.png", 390, 844);
await navigate("/apps/help-bridge/");
report.helpBridge.restored = await evaluate(`
  return {
    incident: document.querySelector('[name="incidentType"]:checked')?.value,
    adultName: document.querySelector("#adult-name").value,
    notes: document.querySelector("#notes").value,
  };
`);
assert.deepEqual(report.helpBridge.restored, { incident: "image-pressure", adultName: "", notes: "" });

await navigate("/apps/ai-literacy/#exercise-link-source-check");
report.aiLiteracy = await evaluate(`
  const deepLinkCard = document.querySelector('[data-exercise-id="source-check"]');
  const deepLinkActive = deepLinkCard?.hasAttribute("data-selected") &&
    deepLinkCard.contains(document.activeElement);
  document.querySelector('[data-experience-intent="missing-perspectives"]').click();
  const intentCard = document.querySelector('[data-exercise-id="missing-perspectives"]');
  const intentFocused = intentCard.contains(document.activeElement);
  for (let attempt = 0; attempt < 40 && !document.querySelector('[value="trace-source"]'); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  document.querySelector('[value="trace-source"]').click();
  document.querySelector('[data-exercise-id="source-check"] [data-check]').click();
  for (const value of ["young-people", "accessibility", "independent-research"]) {
    document.querySelector('[value="' + value + '"]').click();
  }
  document.querySelector('[data-exercise-id="missing-perspectives"] [data-check]').click();
  document.querySelector('[value="evidence"]').click();
  document.querySelector('[data-exercise-id="prompt-improvement"] [data-check]').click();
  await new Promise((resolve) => setTimeout(resolve, 30));
  return {
    intents: document.querySelectorAll("[data-experience-intent]").length,
    languages: [
      document.documentElement.lang,
      document.querySelector("#app-intro").closest("[lang]")?.lang,
      document.querySelector("#experience-cards").closest("[lang]")?.lang,
    ],
    intentFocused,
    progress: document.querySelector("#progress-copy")?.textContent.trim(),
    score: document.querySelector("#score-copy")?.textContent.trim(),
    deepLinkActive,
    hash: window.location.hash,
    completed: !document.querySelector("#completion-note")?.hidden,
  };
`);
assert.equal(report.aiLiteracy.intents, 3);
assert.deepEqual(report.aiLiteracy.languages, ["en", "en", "en"]);
assert.equal(report.aiLiteracy.intentFocused, true);
assert.equal(report.aiLiteracy.progress, "3 of 3 exercises checked");
assert.equal(report.aiLiteracy.score, "3 / 3");
assert.equal(report.aiLiteracy.completed, true);
assert.equal(report.aiLiteracy.deepLinkActive, true);
await screenshot("ai-literacy-mobile.png", 390, 844);
assert.equal(report.aiLiteracy.hash, "#exercise-link-missing-perspectives");

assert.deepEqual(browserErrors, [], `Browser errors: ${browserErrors.join(" | ")}`);
console.log(JSON.stringify({ ...report, browserErrors }, null, 2));
socket.close();
