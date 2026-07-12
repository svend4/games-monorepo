import test from "node:test";
import assert from "node:assert/strict";
import {
  assessUrgency,
  buildSafetyPlan,
  createPersistableDraft,
  getDraftCompletion,
  getTrustedAdultLabel,
  normalizeDraft,
} from "../apps/help-bridge/logic.js";

const calmDraft = {
  incidentType: "insults",
  safeNow: "yes",
  directThreat: "no",
  knowsLocation: "no",
  repeatedContact: "no",
  imageShared: "no",
  adultRole: "teacher",
  adultName: "Ms Lee",
};

test("assessUrgency marks immediate safety signals as urgent", () => {
  const result = assessUrgency({ ...calmDraft, safeNow: "no" });
  assert.equal(result.level, "urgent");
  assert.equal(result.emergency, true);
  assert.match(result.reasons[0], /not physically safe/i);
});

test("image pressure is routed to same-day adult support without claiming an emergency", () => {
  const result = assessUrgency({ ...calmDraft, incidentType: "image-pressure" });
  assert.equal(result.level, "soon");
  assert.equal(result.emergency, false);
  assert.match(result.summary, /trusted adult/i);
});

test("buildSafetyPlan adds incident-specific, evidence and trusted-adult steps", () => {
  const plan = buildSafetyPlan({ ...calmDraft, incidentType: "image-pressure", imageShared: "yes" });
  assert.ok(plan.steps.some((step) => /Do not send another image/i.test(step.detail)));
  assert.ok(plan.steps.some((step) => step.id === "evidence" && /without downloading or forwarding/i.test(step.detail)));
  assert.ok(plan.steps.some((step) => step.title.includes("Ms Lee")));
  assert.ok(plan.steps.some((step) => /cannot be guaranteed/i.test(step.detail)));
});

test("normalization limits free text and ignores unknown choices", () => {
  const draft = normalizeDraft({
    incidentType: "unknown",
    adultRole: "stranger",
    notes: `  ${"x".repeat(900)}  `,
  });
  assert.equal(draft.incidentType, "");
  assert.equal(draft.adultRole, "");
  assert.equal(draft.notes.length, 600);
});

test("persistable drafts exclude optional names, notes and unknown fields", () => {
  const persisted = createPersistableDraft({
    ...calmDraft,
    adultName: "Ms Lee",
    notes: "Private context that must remain session-only.",
    unexpected: "drop me",
  });

  assert.deepEqual(persisted, {
    incidentType: "insults",
    safeNow: true,
    directThreat: false,
    knowsLocation: false,
    repeatedContact: false,
    imageShared: false,
    adultRole: "teacher",
  });
  assert.equal("adultName" in persisted, false);
  assert.equal("notes" in persisted, false);
});

test("draft completion only becomes ready after all triage answers", () => {
  assert.equal(getDraftCompletion(calmDraft).ready, true);
  assert.equal(getDraftCompletion({ ...calmDraft, directThreat: undefined }).ready, false);
  assert.equal(getTrustedAdultLabel(calmDraft), "Ms Lee (a teacher)");
});
