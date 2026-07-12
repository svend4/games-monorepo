export const DAYS = Object.freeze([
  Object.freeze({ id: "monday", shortLabel: "Mo", label: "Montag" }),
  Object.freeze({ id: "tuesday", shortLabel: "Di", label: "Dienstag" }),
  Object.freeze({ id: "wednesday", shortLabel: "Mi", label: "Mittwoch" }),
  Object.freeze({ id: "thursday", shortLabel: "Do", label: "Donnerstag" }),
  Object.freeze({ id: "friday", shortLabel: "Fr", label: "Freitag" }),
  Object.freeze({ id: "saturday", shortLabel: "Sa", label: "Samstag" }),
  Object.freeze({ id: "sunday", shortLabel: "So", label: "Sonntag" }),
]);

export const CATEGORIES = Object.freeze([
  Object.freeze({
    id: "learning",
    label: "Lernen",
    description: "Hausaufgaben, Recherche und Lernprogramme",
  }),
  Object.freeze({
    id: "creative",
    label: "Kreativ",
    description: "Gestalten, Programmieren, Musik und eigene Medien",
  }),
  Object.freeze({
    id: "offline",
    label: "Offline",
    description: "Bewegung, Treffen, Lesen und Erholung ohne Bildschirm",
  }),
]);

const DEFAULT_MINUTES = Object.freeze({
  monday: Object.freeze({ learning: 45, creative: 30, offline: 90 }),
  tuesday: Object.freeze({ learning: 45, creative: 20, offline: 90 }),
  wednesday: Object.freeze({ learning: 30, creative: 45, offline: 120 }),
  thursday: Object.freeze({ learning: 45, creative: 20, offline: 90 }),
  friday: Object.freeze({ learning: 30, creative: 45, offline: 120 }),
  saturday: Object.freeze({ learning: 20, creative: 60, offline: 180 }),
  sunday: Object.freeze({ learning: 20, creative: 45, offline: 180 }),
});

export function normalizeMinutes(value, maximum = 600) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.min(maximum, Math.max(0, Math.round(numericValue)));
}

export function createDefaultPlan() {
  return Object.fromEntries(
    DAYS.map((day) => [day.id, { ...DEFAULT_MINUTES[day.id] }]),
  );
}

export function sanitizePlan(value) {
  const defaults = createDefaultPlan();

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  return Object.fromEntries(
    DAYS.map((day) => [
      day.id,
      Object.fromEntries(
        CATEGORIES.map((category) => [
          category.id,
          normalizeMinutes(value?.[day.id]?.[category.id] ?? defaults[day.id][category.id]),
        ]),
      ),
    ]),
  );
}

export function updatePlan(plan, dayId, categoryId, minutes) {
  if (
    !DAYS.some((day) => day.id === dayId) ||
    !CATEGORIES.some((category) => category.id === categoryId)
  ) {
    return plan;
  }

  return {
    ...plan,
    [dayId]: {
      ...plan[dayId],
      [categoryId]: normalizeMinutes(minutes),
    },
  };
}

export function getDayTotals(plan, dayId) {
  const day = plan?.[dayId] ?? {};
  const learning = normalizeMinutes(day.learning);
  const creative = normalizeMinutes(day.creative);
  const offline = normalizeMinutes(day.offline);

  return {
    learning,
    creative,
    offline,
    digital: learning + creative,
    total: learning + creative + offline,
  };
}

export function getWeeklyTotals(plan) {
  return DAYS.reduce(
    (totals, day) => {
      const dayTotals = getDayTotals(plan, day.id);
      totals.learning += dayTotals.learning;
      totals.creative += dayTotals.creative;
      totals.offline += dayTotals.offline;
      totals.digital += dayTotals.digital;
      totals.total += dayTotals.total;
      return totals;
    },
    { learning: 0, creative: 0, offline: 0, digital: 0, total: 0 },
  );
}

export function getBalancePercentages(plan) {
  const totals = getWeeklyTotals(plan);

  if (totals.total === 0) {
    return { learning: 0, creative: 0, offline: 0 };
  }

  return {
    learning: Math.round((totals.learning / totals.total) * 100),
    creative: Math.round((totals.creative / totals.total) * 100),
    offline: Math.round((totals.offline / totals.total) * 100),
  };
}

export function evaluateBalance(plan) {
  const totals = getWeeklyTotals(plan);
  const percentages = getBalancePercentages(plan);
  const warnings = [];

  if (totals.total === 0) {
    return [
      {
        id: "empty-plan",
        level: "info",
        message: "Trage erste Zeiten ein, damit dein Wochenplan sichtbar wird.",
      },
    ];
  }

  if (percentages.offline < 40) {
    warnings.push({
      id: "offline-low",
      level: "warning",
      message:
        "Weniger als 40 % deiner geplanten Zeit ist offline. Plane Bewegung, Pausen oder Treffen ein.",
    });
  }

  if (totals.creative > 0 && totals.learning >= totals.creative * 3) {
    warnings.push({
      id: "creative-low",
      level: "tip",
      message:
        "Lernzeit überwiegt deutlich. Ein kleines kreatives Medienprojekt kann für Abwechslung sorgen.",
    });
  }

  for (const day of DAYS) {
    const dayTotals = getDayTotals(plan, day.id);

    if (dayTotals.digital > 180) {
      warnings.push({
        id: `digital-high-${day.id}`,
        level: "warning",
        message: `${day.label}: Mehr als 3 Stunden Bildschirmzeit geplant. Prüfe Pausen und Prioritäten.`,
      });
    }

    if (dayTotals.digital > 0 && dayTotals.offline === 0) {
      warnings.push({
        id: `offline-missing-${day.id}`,
        level: "warning",
        message: `${day.label}: Ergänze einen Offline-Ausgleich zur Bildschirmzeit.`,
      });
    }
  }

  if (warnings.length === 0) {
    warnings.push({
      id: "balanced",
      level: "success",
      message:
        "Dein Plan wirkt ausgewogen: Lernen, kreatives Gestalten und Offline-Zeit haben ihren Platz.",
    });
  }

  return warnings;
}

export function formatMinutes(minutes) {
  const normalized = normalizeMinutes(minutes, Number.MAX_SAFE_INTEGER);
  const hours = Math.floor(normalized / 60);
  const remainder = normalized % 60;

  if (hours === 0) {
    return `${remainder} Min.`;
  }

  if (remainder === 0) {
    return `${hours} Std.`;
  }

  return `${hours} Std. ${remainder} Min.`;
}
