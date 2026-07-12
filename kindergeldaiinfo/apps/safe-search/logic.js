export const SAFE_RESULTS = Object.freeze([
  Object.freeze({
    id: "frag-finn-school",
    title: "FragFINN: Sicher suchen und lernen",
    description:
      "Eine kindgerechte Suchmaschine mit redaktionell geprüften Webseiten für Schule, Wissen und Freizeit.",
    category: "school",
    source: "fragFINN e. V.",
    url: "https://www.fragfinn.de/",
    ageLabel: "6–12 Jahre",
    keywords: ["hausaufgaben", "wissen", "referat", "lernen", "suchmaschine"],
    safetyReasons: [
      "Die verlinkten Angebote werden redaktionell geprüft.",
      "Die Suche ist für Kinder gestaltet und erklärt Werbung.",
      "Es sind keine Anmeldung und keine persönlichen Daten für die Suche nötig.",
    ],
  }),
  Object.freeze({
    id: "blinde-kuh-school",
    title: "Blinde Kuh: Themen für Hausaufgaben",
    description:
      "Nachschlagehilfe für Tiere, Geschichte, Technik und viele weitere Schulthemen.",
    category: "school",
    source: "Blinde Kuh e. V.",
    url: "https://www.blinde-kuh.de/",
    ageLabel: "6–14 Jahre",
    keywords: ["tiere", "geschichte", "technik", "schule", "lexikon"],
    safetyReasons: [
      "Die Redaktion nimmt nur ausgewählte Kinderseiten in die Suche auf.",
      "Treffer werden mit Quelle und Thema angezeigt.",
      "Das Angebot funktioniert ohne eigenes Profil.",
    ],
  }),
  Object.freeze({
    id: "klexikon-school",
    title: "Klexikon: Wissen einfach erklärt",
    description:
      "Ein frei zugängliches Kinderlexikon mit verständlichen Artikeln und Quellenhinweisen.",
    category: "school",
    source: "ZUM e. V.",
    url: "https://klexikon.zum.de/",
    ageLabel: "6–12 Jahre",
    keywords: ["lexikon", "erklärung", "wissen", "referat", "quelle"],
    safetyReasons: [
      "Artikel sind speziell für Kinder verständlich geschrieben.",
      "Versionsgeschichte und Autorenschaft bleiben nachvollziehbar.",
      "Lesen ist ohne Konto oder Dateneingabe möglich.",
    ],
  }),
  Object.freeze({
    id: "logo-news",
    title: "logo!: Nachrichten für Kinder",
    description:
      "Aktuelle Nachrichten werden mit kurzen Texten und Videos altersgerecht eingeordnet.",
    category: "news",
    source: "ZDF",
    url: "https://www.zdf.de/kinder/logo",
    ageLabel: "8–12 Jahre",
    keywords: ["nachrichten", "politik", "welt", "aktuell", "video"],
    safetyReasons: [
      "Journalistische Inhalte stammen von einer bekannten Redaktion.",
      "Schwierige Ereignisse werden kindgerecht eingeordnet.",
      "Die Quelle und das Veröffentlichungsdatum sind erkennbar.",
    ],
  }),
  Object.freeze({
    id: "kiraka-news",
    title: "KiRaKa: Hören, verstehen, mitreden",
    description:
      "Audios und Erklärstücke zu Nachrichten, Alltag, Wissen und Kinderfragen.",
    category: "news",
    source: "Westdeutscher Rundfunk",
    url: "https://kinder.wdr.de/radio/kiraka/",
    ageLabel: "8–13 Jahre",
    keywords: ["radio", "audio", "nachrichten", "kinderfragen", "wissen"],
    safetyReasons: [
      "Beiträge werden journalistisch redigiert.",
      "Das Angebot trennt Nachrichten und Unterhaltung sichtbar.",
      "Zum Anhören ist kein persönliches Konto erforderlich.",
    ],
  }),
  Object.freeze({
    id: "seitenstark-creative",
    title: "Seitenstark: Ideen zum Entdecken",
    description:
      "Ein Netzwerk geprüfter Kinderseiten mit Spielen, Experimenten und kreativen Projekten.",
    category: "creative",
    source: "Seitenstark e. V.",
    url: "https://seitenstark.de/",
    ageLabel: "6–12 Jahre",
    keywords: ["basteln", "experimente", "spiele", "kreativ", "hobby"],
    safetyReasons: [
      "Mitglieder verpflichten sich zu Qualitätsstandards für Kinderangebote.",
      "Werbung und externe Links sollen klar erkennbar sein.",
      "Die Sammlung wird von einem Kinderseiten-Netzwerk gepflegt.",
    ],
  }),
  Object.freeze({
    id: "juki-creative",
    title: "JUKI: Videos verstehen und gestalten",
    description:
      "Tipps, Lernmodule und kreative Aufgaben rund um Videos und einen sicheren Medienalltag.",
    category: "creative",
    source: "Deutsches Kinderhilfswerk",
    url: "https://www.juki.de/",
    ageLabel: "8–13 Jahre",
    keywords: ["video", "film", "kreativ", "medien", "gestalten"],
    safetyReasons: [
      "Das Angebot wird von einer gemeinnützigen Kinderrechtsorganisation getragen.",
      "Lernmodule behandeln Privatsphäre und respektvollen Umgang.",
      "Die Inhalte regen zum eigenen Gestalten statt zum endlosen Scrollen an.",
    ],
  }),
  Object.freeze({
    id: "internet-abc-safety",
    title: "Internet-ABC: Sicher im Netz",
    description:
      "Interaktive Lernmodule erklären Suche, Datenschutz, soziale Medien und digitale Regeln.",
    category: "safety",
    source: "Internet-ABC e. V.",
    url: "https://www.internet-abc.de/kinder/",
    ageLabel: "6–12 Jahre",
    keywords: ["datenschutz", "internet", "passwort", "sicher", "lernen"],
    safetyReasons: [
      "Die Lerninhalte werden medienpädagogisch entwickelt.",
      "Risiken werden ohne Angst und mit konkreten Handlungstipps erklärt.",
      "Das Kinderangebot ist vom Bereich für Erwachsene getrennt.",
    ],
  }),
]);

export const SEARCH_CATEGORIES = Object.freeze([
  Object.freeze({ id: "all", label: "Alle Themen" }),
  Object.freeze({ id: "school", label: "Schule & Wissen" }),
  Object.freeze({ id: "news", label: "Kinder-Nachrichten" }),
  Object.freeze({ id: "creative", label: "Kreativ & Hobby" }),
  Object.freeze({ id: "safety", label: "Sicher im Netz" }),
]);

const EXPERIENCE_CATEGORY_BY_INTENT = Object.freeze({
  school: "school",
  news: "news",
  creative: "creative",
});

export function getCategoryForExperienceIntent(
  intent,
  categories = SEARCH_CATEGORIES,
) {
  if (typeof intent !== "string" || !Array.isArray(categories)) {
    return null;
  }

  const categoryId = EXPERIENCE_CATEGORY_BY_INTENT[intent.trim().toLowerCase()];
  if (!categoryId) {
    return null;
  }

  return categories.some((category) => category?.id === categoryId)
    ? categoryId
    : null;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("de")
    .trim();
}

export function filterResults(
  results,
  { query = "", category = "all" } = {},
) {
  const normalizedQuery = normalizeText(query);
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);

  return results.filter((result) => {
    if (category !== "all" && result.category !== category) {
      return false;
    }

    if (terms.length === 0) {
      return true;
    }

    const searchableText = normalizeText(
      [
        result.title,
        result.description,
        result.source,
        result.ageLabel,
        ...(result.keywords ?? []),
      ].join(" "),
    );

    return terms.every((term) => searchableText.includes(term));
  });
}

export function toggleSavedId(savedIds, resultId) {
  const normalizedIds = [...new Set((savedIds ?? []).filter(Boolean))];

  if (normalizedIds.includes(resultId)) {
    return normalizedIds.filter((id) => id !== resultId);
  }

  return [...normalizedIds, resultId];
}

export function getSavedResults(results, savedIds) {
  const idSet = new Set(savedIds ?? []);
  return results.filter((result) => idSet.has(result.id));
}

export function createHistoryEntry(
  { query = "", category = "all", resultCount = 0 },
  timestamp = new Date().toISOString(),
) {
  return {
    id: `${timestamp}:${normalizeText(query)}:${category}`,
    query: String(query).trim(),
    category,
    resultCount: Math.max(0, Number(resultCount) || 0),
    timestamp,
  };
}

export function addHistoryEntry(history, entry, limit = 6) {
  if (!entry || (!entry.query && entry.category === "all")) {
    return [...(history ?? [])].slice(0, limit);
  }

  const previous = history ?? [];
  const withoutDuplicate = previous.filter(
    (item) =>
      normalizeText(item.query) !== normalizeText(entry.query) ||
      item.category !== entry.category,
  );

  return [entry, ...withoutDuplicate].slice(0, Math.max(0, limit));
}

export function sanitizeStoredIds(value, validResults = SAFE_RESULTS) {
  if (!Array.isArray(value)) {
    return [];
  }

  const validIds = new Set(validResults.map((result) => result.id));
  return [...new Set(value.filter((id) => validIds.has(id)))];
}

export function sanitizeHistory(value, limit = 6) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (item) =>
        item &&
        typeof item.query === "string" &&
        typeof item.category === "string" &&
        typeof item.timestamp === "string",
    )
    .map((item) => ({
      id: String(item.id ?? `${item.timestamp}:${item.query}:${item.category}`),
      query: item.query.trim(),
      category: item.category,
      resultCount: Math.max(0, Number(item.resultCount) || 0),
      timestamp: item.timestamp,
    }))
    .slice(0, Math.max(0, limit));
}
