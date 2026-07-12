import test from "node:test";
import assert from "node:assert/strict";
import {
  EXERCISES,
  createInitialProgress,
  evaluateAnswer,
  getNextExerciseId,
  getProgressSummary,
  normalizeProgress,
  updateProgress,
} from "../apps/ai-literacy/logic.js";

test("the lab exposes exactly the three requested exercise types", () => {
  assert.deepEqual(EXERCISES.map((exercise) => exercise.id), [
    "source-check",
    "missing-perspectives",
    "prompt-improvement",
  ]);
});

test("source checking rewards tracing the original evidence", () => {
  const result = evaluateAnswer("source-check", "trace-source");
  assert.equal(result.correct, true);
  assert.match(result.explanation, /original source/i);

  const weakResult = evaluateAnswer("source-check", "count-likes");
  assert.equal(weakResult.correct, false);
  assert.match(weakResult.feedback, /evidence/i);
});

test("missing-perspectives requires the complete set and ignores answer order", () => {
  const correct = evaluateAnswer("missing-perspectives", [
    "independent-research",
    "young-people",
    "accessibility",
  ]);
  assert.equal(correct.correct, true);

  const incomplete = evaluateAnswer("missing-perspectives", ["young-people", "accessibility"]);
  assert.equal(incomplete.correct, false);
});

test("progress is immutable, saved per exercise and summarized", () => {
  const initial = createInitialProgress();
  const result = evaluateAnswer("prompt-improvement", "evidence");
  const updated = updateProgress(initial, "prompt-improvement", result);

  assert.deepEqual(initial, { version: 1, answers: {} });
  assert.equal(updated.answers["prompt-improvement"].correct, true);
  assert.deepEqual(getProgressSummary(updated), {
    completed: 1,
    correct: 1,
    total: 3,
    percent: 33,
    isComplete: false,
  });
  assert.equal(getNextExerciseId(updated), "source-check");
});

test("normalization drops unknown or empty saved answers", () => {
  const normalized = normalizeProgress({
    version: 99,
    answers: {
      "source-check": { selectedAnswers: ["not-an-option"], correct: true },
      invented: { selectedAnswers: ["anything"], correct: true },
    },
  });
  assert.deepEqual(normalized, createInitialProgress());
});

test("unknown exercises fail explicitly", () => {
  assert.throws(() => evaluateAnswer("made-up", "x"), RangeError);
});
