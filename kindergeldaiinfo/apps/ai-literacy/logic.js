export const EXERCISES = Object.freeze([
  Object.freeze({
    id: "source-check",
    title: "Trace a claim to its source",
    skill: "Source check",
    kind: "single",
    prompt: "A post says, “Scientists proved homework apps raise grades by 40%.” It shows a cropped graph but gives no link. What is the strongest first move?",
    options: Object.freeze([
      Object.freeze({ id: "trust-graph", label: "Trust it because a graph looks scientific" }),
      Object.freeze({ id: "count-likes", label: "Check whether the post has lots of likes" }),
      Object.freeze({ id: "trace-source", label: "Find the original study, its authors, date and method" }),
      Object.freeze({ id: "ask-ai", label: "Ask an AI to confirm it without requesting sources" }),
    ]),
    correctAnswers: Object.freeze(["trace-source"]),
    explanation: "A screenshot removes context. The original source lets you inspect who ran the study, what was measured, how large the sample was and whether “40%” means what the post claims.",
  }),
  Object.freeze({
    id: "missing-perspectives",
    title: "Notice who is missing",
    skill: "Perspective check",
    kind: "multiple",
    prompt: "An article about an AI study helper quotes the company and one headteacher. Which missing perspectives would make the picture more complete? Choose all three.",
    options: Object.freeze([
      Object.freeze({ id: "young-people", label: "Young people who use the study helper" }),
      Object.freeze({ id: "accessibility", label: "Learners with disabilities or different access needs" }),
      Object.freeze({ id: "independent-research", label: "An independent education or privacy researcher" }),
      Object.freeze({ id: "logo-designer", label: "The designer of the company's logo" }),
    ]),
    correctAnswers: Object.freeze(["young-people", "accessibility", "independent-research"]),
    explanation: "A company and a school leader can describe goals, but users, people with access needs and independent researchers may reveal effects, risks or trade-offs that promotional voices miss.",
  }),
  Object.freeze({
    id: "prompt-improvement",
    title: "Ask for evidence, not confidence",
    skill: "Prompt improvement",
    kind: "single",
    prompt: "You want help checking a climate claim. Which prompt makes it easiest to inspect the answer rather than simply trust it?",
    options: Object.freeze([
      Object.freeze({ id: "confident", label: "Tell me the correct answer and sound confident." }),
      Object.freeze({ id: "short", label: "Is this climate claim true? Answer yes or no." }),
      Object.freeze({ id: "evidence", label: "Assess this claim for a 13-year-old. Separate facts from inferences, cite two recent primary sources with dates, and explain uncertainty or disagreement." }),
      Object.freeze({ id: "agree", label: "Give me three reasons this claim must be true." }),
    ]),
    correctAnswers: Object.freeze(["evidence"]),
    explanation: "The improved prompt defines the audience, asks for inspectable sources, separates evidence from interpretation and makes uncertainty visible. A detailed prompt cannot guarantee accuracy, so the sources still need checking.",
  }),
]);

const EXERCISE_MAP = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));

function selectedIds(answer) {
  const values = Array.isArray(answer) ? answer : [answer];
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))].sort();
}

function sameValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function getExercise(exerciseId) {
  return EXERCISE_MAP.get(exerciseId) ?? null;
}

export function evaluateAnswer(exerciseId, answer) {
  const exercise = getExercise(exerciseId);
  if (!exercise) throw new RangeError(`Unknown exercise: ${exerciseId}`);

  const validOptionIds = new Set(exercise.options.map((option) => option.id));
  const selectedAnswers = selectedIds(answer).filter((id) => validOptionIds.has(id));
  const correctAnswers = [...exercise.correctAnswers].sort();
  const correct = selectedAnswers.length > 0 && sameValues(selectedAnswers, correctAnswers);
  const correctLabels = exercise.options
    .filter((option) => correctAnswers.includes(option.id))
    .map((option) => option.label);

  let feedback;
  if (selectedAnswers.length === 0) {
    feedback = "Choose an answer before checking.";
  } else if (correct) {
    feedback = "Good check. You chose the most inspectable approach.";
  } else if (exercise.kind === "multiple") {
    feedback = "Not quite yet. Look for every voice that could reveal a different impact or risk.";
  } else {
    feedback = "Try again. Prefer the option that gives you evidence you can inspect.";
  }

  return {
    exerciseId,
    selectedAnswers,
    correctAnswers,
    correctLabels,
    correct,
    feedback,
    explanation: exercise.explanation,
  };
}

export function createInitialProgress() {
  return { version: 1, answers: {} };
}

export function normalizeProgress(value) {
  const normalized = createInitialProgress();
  if (!value || typeof value !== "object" || !value.answers || typeof value.answers !== "object") {
    return normalized;
  }

  for (const exercise of EXERCISES) {
    const saved = value.answers[exercise.id];
    if (!saved || typeof saved !== "object") continue;
    const evaluation = evaluateAnswer(exercise.id, saved.selectedAnswers ?? []);
    if (evaluation.selectedAnswers.length === 0) continue;
    normalized.answers[exercise.id] = {
      selectedAnswers: evaluation.selectedAnswers,
      correct: evaluation.correct,
    };
  }

  return normalized;
}

export function updateProgress(current, exerciseId, evaluation) {
  if (!getExercise(exerciseId)) throw new RangeError(`Unknown exercise: ${exerciseId}`);
  if (!evaluation || evaluation.exerciseId !== exerciseId) {
    throw new TypeError("The evaluation must belong to the exercise being updated.");
  }

  const next = normalizeProgress(current);
  next.answers = {
    ...next.answers,
    [exerciseId]: {
      selectedAnswers: [...evaluation.selectedAnswers],
      correct: Boolean(evaluation.correct),
    },
  };
  return next;
}

export function getProgressSummary(value) {
  const progress = normalizeProgress(value);
  const completed = EXERCISES.filter((exercise) => progress.answers[exercise.id]).length;
  const correct = EXERCISES.filter((exercise) => progress.answers[exercise.id]?.correct).length;

  return {
    completed,
    correct,
    total: EXERCISES.length,
    percent: Math.round((completed / EXERCISES.length) * 100),
    isComplete: completed === EXERCISES.length,
  };
}

export function getNextExerciseId(value) {
  const progress = normalizeProgress(value);
  return EXERCISES.find((exercise) => !progress.answers[exercise.id])?.id ?? null;
}
