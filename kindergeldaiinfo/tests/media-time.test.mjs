import test from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORIES,
  DAYS,
  createDefaultPlan,
  evaluateBalance,
  formatMinutes,
  getBalancePercentages,
  getDayTotals,
  getWeeklyTotals,
  normalizeMinutes,
  sanitizePlan,
  updatePlan,
} from "../apps/media-time/logic.js";

function createEmptyPlan() {
  return Object.fromEntries(
    DAYS.map((day) => [
      day.id,
      Object.fromEntries(CATEGORIES.map((category) => [category.id, 0])),
    ]),
  );
}

test("normalizeMinutes rounds useful values and clamps unsafe input", () => {
  assert.equal(normalizeMinutes("42.6"), 43);
  assert.equal(normalizeMinutes(-25), 0);
  assert.equal(normalizeMinutes(900), 600);
  assert.equal(normalizeMinutes("not a number"), 0);
  assert.equal(normalizeMinutes(Number.POSITIVE_INFINITY), 0);
});

test("createDefaultPlan returns a fresh, complete week", () => {
  const first = createDefaultPlan();
  const second = createDefaultPlan();

  assert.deepEqual(Object.keys(first), DAYS.map((day) => day.id));
  assert.deepEqual(Object.keys(first.monday), CATEGORIES.map((category) => category.id));
  first.monday.learning = 999;
  assert.equal(second.monday.learning, 45);
});

test("sanitizePlan repairs partial stored data and removes unknown fields", () => {
  const plan = sanitizePlan({
    monday: { learning: "61.6", creative: -4, offline: 900, unknown: 10 },
    unknownDay: { learning: 500 },
  });

  assert.deepEqual(plan.monday, { learning: 62, creative: 0, offline: 600 });
  assert.deepEqual(plan.tuesday, createDefaultPlan().tuesday);
  assert.equal("unknown" in plan.monday, false);
  assert.equal("unknownDay" in plan, false);
});

test("updatePlan changes one valid cell without mutating the previous plan", () => {
  const original = createDefaultPlan();
  const updated = updatePlan(original, "monday", "creative", 75);

  assert.notEqual(updated, original);
  assert.notEqual(updated.monday, original.monday);
  assert.equal(updated.monday.creative, 75);
  assert.equal(original.monday.creative, 30);
  assert.equal(updatePlan(original, "neverday", "creative", 10), original);
});

test("daily and weekly totals keep digital and offline time distinct", () => {
  let plan = createEmptyPlan();
  plan = updatePlan(plan, "monday", "learning", 30);
  plan = updatePlan(plan, "monday", "creative", 45);
  plan = updatePlan(plan, "monday", "offline", 90);
  plan = updatePlan(plan, "tuesday", "offline", 15);

  assert.deepEqual(getDayTotals(plan, "monday"), {
    learning: 30,
    creative: 45,
    offline: 90,
    digital: 75,
    total: 165,
  });
  assert.deepEqual(getWeeklyTotals(plan), {
    learning: 30,
    creative: 45,
    offline: 105,
    digital: 75,
    total: 180,
  });
  assert.deepEqual(getBalancePercentages(plan), {
    learning: 17,
    creative: 25,
    offline: 58,
  });
});

test("evaluateBalance gives a calm empty state and accepts the default week", () => {
  assert.deepEqual(evaluateBalance(createEmptyPlan()).map((item) => item.id), ["empty-plan"]);
  assert.deepEqual(evaluateBalance(createDefaultPlan()).map((item) => item.id), ["balanced"]);
});

test("evaluateBalance reports specific, actionable imbalance signals", () => {
  let plan = createEmptyPlan();
  plan = updatePlan(plan, "monday", "learning", 181);

  const warningIds = evaluateBalance(plan).map((item) => item.id);
  assert.ok(warningIds.includes("offline-low"));
  assert.ok(warningIds.includes("digital-high-monday"));
  assert.ok(warningIds.includes("offline-missing-monday"));

  plan = createEmptyPlan();
  plan = updatePlan(plan, "monday", "learning", 90);
  plan = updatePlan(plan, "monday", "creative", 30);
  plan = updatePlan(plan, "monday", "offline", 200);
  assert.ok(evaluateBalance(plan).some((item) => item.id === "creative-low"));
});

test("formatMinutes produces short German time labels", () => {
  assert.equal(formatMinutes(0), "0 Min.");
  assert.equal(formatMinutes(45), "45 Min.");
  assert.equal(formatMinutes(60), "1 Std.");
  assert.equal(formatMinutes(135), "2 Std. 15 Min.");
});
