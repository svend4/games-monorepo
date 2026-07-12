import test from "node:test";
import assert from "node:assert/strict";

import {
  APP_IDS,
  createStorage,
  escapeHTML,
  getAppConfig,
  renderAppIntro,
  renderExperienceCards,
} from "../packages/shared/src/index.js";

const expectedAppIds = [
  "safe-search",
  "media-time",
  "help-bridge",
  "ai-literacy",
];

test("shared data exposes four complete, immutable app configs", () => {
  assert.deepEqual([...APP_IDS].sort(), [...expectedAppIds].sort());

  for (const appId of expectedAppIds) {
    const config = getAppConfig(appId);
    assert.ok(config, "expected a config for " + appId);
    assert.equal(config.id, appId);
    assert.ok(config.title.length > 0);
    assert.ok(config.description.length > 0);
    assert.match(config.primaryAction.target, /^#[A-Za-z]/);
    assert.ok(config.domainExperiences.length >= 3);
    assert.equal(new Set(config.domainExperiences.map((item) => item.id)).size, config.domainExperiences.length);
    assert.ok(Object.isFrozen(config));
    assert.ok(Object.isFrozen(config.domainExperiences));
    for (const experience of config.domainExperiences) {
      assert.match(experience.target, /^#[A-Za-z]/);
      assert.ok(experience.intentId.length > 0);
    }
  }

  assert.equal(getAppConfig("not-an-app"), null);
  assert.equal(getAppConfig(null), null);
});

test("escapeHTML neutralizes markup-significant characters", () => {
  assert.equal(
    escapeHTML('<button data-label="Tom & Jerry">\'Hello\'</button>'),
    "&lt;button data-label=&quot;Tom &amp; Jerry&quot;&gt;&#39;Hello&#39;&lt;/button&gt;",
  );
  assert.equal(escapeHTML(null), "");
  assert.equal(escapeHTML(42), "42");
});

test("renderAppIntro produces accessible markup and escapes content", () => {
  const html = renderAppIntro({
    id: "unsafe-app",
    title: "Try <script>alert(1)</script>",
    productLabel: "A & B",
    tagline: "A safer <strong>choice</strong>",
    description: 'Text with a "quote"',
    audience: "Everyone",
    primaryAction: { label: "Start >", target: "#start-here" },
  });

  assert.match(html, /<section class="app-intro"/);
  assert.match(html, /aria-labelledby="unsafe-app-intro-title"/);
  assert.match(html, /<h1 class="app-intro__title"/);
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("A &amp; B"));
  assert.ok(html.includes('href="#start-here"'));
  assert.ok(!html.includes("<script>"));
});
test("shared renderers reject external or executable action targets", () => {
  const intro = renderAppIntro({
    id: "target-test",
    primaryAction: { label: "Start", target: "javascript:alert(1)" },
  });
  const cards = renderExperienceCards([
    {
      id: "target-card",
      actionLabel: "Open",
      target: "https://example.test",
      intentId: "safe-intent",
    },
  ]);

  assert.ok(intro.includes('href="#experiences"'));
  assert.ok(cards.includes('href="#experiences"'));
});


test("renderExperienceCards adds list semantics and safely renders every card", () => {
  const html = renderExperienceCards([
    {
      id: "first-card",
      eyebrow: "Check",
      title: "A useful <idea>",
      description: "Compare one source & another.",
      actionLabel: "Try it",
      target: "#first-workflow",
      intentId: "first-intent",
    },
    {
      id: "second-card",
      eyebrow: "Reflect",
      title: "Second idea",
      description: "Notice what is missing.",
      actionLabel: "Review",
      target: "#second-workflow",
      intentId: "second-intent",
    },
  ]);

  assert.match(html, /^<div class="experience-grid" role="list">/);
  assert.equal((html.match(/role="listitem"/g) ?? []).length, 2);
  assert.ok(html.includes("A useful &lt;idea&gt;"));
  assert.ok(html.includes("Compare one source &amp; another."));
  assert.ok(!html.includes("<idea>"));
  assert.ok(html.includes('href="#first-workflow"'));
  assert.ok(html.includes('data-experience-intent="first-intent"'));
  assert.equal((html.match(/class="experience-card__action"/g) ?? []).length, 2);
  assert.match(renderExperienceCards([]), /role="status"/);
  assert.throws(() => renderExperienceCards(null), TypeError);
  assert.throws(() => renderAppIntro(null), TypeError);
});

test("createStorage follows the requested API and round-trips JSON values", () => {
  const storage = createStorage("shared-test-roundtrip");
  storage.clear();

  assert.deepEqual(Object.keys(storage).sort(), ["clear", "get", "remove", "set"]);
  assert.equal(storage.get("missing", "fallback"), "fallback");
  assert.deepEqual(
    storage.set("progress", { completed: 2, labels: ["one", "two"] }),
    { completed: 2, labels: ["one", "two"] },
  );
  assert.deepEqual(storage.get("progress", null), {
    completed: 2,
    labels: ["one", "two"],
  });

  storage.remove("progress");
  assert.equal(storage.get("progress", null), null);
  assert.throws(() => storage.set("invalid", undefined), TypeError);
});

test("createStorage clear is limited to its namespace", () => {
  const first = createStorage("shared-test-first");
  const firstAgain = createStorage("shared-test-first");
  const second = createStorage("shared-test-second");
  first.clear();
  second.clear();

  first.set("value", "first");
  second.set("value", "second");
  assert.equal(firstAgain.get("value", null), "first");

  first.clear();
  assert.equal(first.get("value", null), null);
  assert.equal(second.get("value", null), "second");
  second.clear();

  assert.throws(() => createStorage(""), TypeError);
  assert.throws(() => first.get("", null), TypeError);
});
