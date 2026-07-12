const rawAppConfigs = {
  "safe-search": {
    id: "safe-search",
    locale: "de",
    title: "Safe Search",
    productLabel: "Sicher und neugierig entdecken",
    tagline: "Ein ruhiger Weg zu nützlichen, altersgerechten Informationen.",
    description:
      "Starte mit einem Ziel, vergleiche klare Treffer und erfahre, warum eine Quelle Vertrauen verdient.",
    audience: "Junge Entdeckerinnen und Entdecker, Familien und Lerngruppen",
    theme: "sky",
    primaryAction: {
      label: "Einen Suchraum wählen",
      target: "#search",
    },
    domainExperiences: [
      {
        id: "school-research",
        eyebrow: "Lernen",
        title: "Schulrecherche",
        description:
          "Verwandle eine Hausaufgabenfrage in eine gezielte Suche und vergleiche Quellen, bevor du eine Antwort nutzt.",
        actionLabel: "Ein Thema erkunden",
        target: "#search",
        intentId: "school",
      },
      {
        id: "kids-news",
        eyebrow: "Verstehen",
        title: "Nachrichten für Neugierige",
        description:
          "Lies eine altersgerechte Übersicht, trenne Fakten von Meinungen und prüfe das Veröffentlichungsdatum.",
        actionLabel: "Eine Nachricht prüfen",
        target: "#search",
        intentId: "news",
      },
      {
        id: "creative-hobbies",
        eyebrow: "Machen",
        title: "Hobbys und Kreativität",
        description:
          "Finde praktische Ideen mit klaren Materialien, sinnvollen Schritten und Sicherheitshinweisen.",
        actionLabel: "Eine Idee finden",
        target: "#search",
        intentId: "creative",
      },
    ],
  },
  "media-time": {
    id: "media-time",
    locale: "de",
    title: "Media Time",
    productLabel: "Eine ausgewogene Woche planen",
    tagline: "Schaffe Raum zum Lernen, Gestalten, Entspannen und Offline-Sein.",
    description:
      "Plane Medienzeit nach dem, was dir wichtig ist, statt jede Bildschirmminute gleich zu behandeln.",
    audience: "Kinder und Familien, die gemeinsam planen",
    theme: "violet",
    primaryAction: {
      label: "Meine Woche planen",
      target: "#week-planner",
    },
    domainExperiences: [
      {
        id: "learning-time",
        eyebrow: "Fokus",
        title: "Lernzeit",
        description:
          "Reserviere ablenkungsarme Zeiten für Hausaufgaben, Tutorials und hilfreiche Lernwerkzeuge.",
        actionLabel: "Eine Fokuszeit planen",
        target: "#week-planner",
        intentId: "learning",
      },
      {
        id: "creative-media",
        eyebrow: "Gestalten",
        title: "Kreative Medienzeit",
        description:
          "Schütze Zeit zum Zeichnen, Schneiden, Programmieren, Musizieren und aktiven Nutzen von Technik.",
        actionLabel: "Kreativzeit planen",
        target: "#week-planner",
        intentId: "creative",
      },
      {
        id: "offline-balance",
        eyebrow: "Auftanken",
        title: "Offline-Ausgleich",
        description:
          "Erkenne volle Tage und plane Schlaf, Bewegung, Freunde und ruhige Momente ein.",
        actionLabel: "Freiraum finden",
        target: "#week-planner",
        intentId: "offline",
      },
    ],
  },
  "help-bridge": {
    id: "help-bridge",
    title: "Help Bridge",
    productLabel: "A calm next step",
    tagline: "You do not have to solve a difficult online moment alone.",
    description:
      "Name what happened, steady the situation, and prepare a clear way to ask a trusted person for support.",
    audience: "Young people looking for practical, human support",
    theme: "coral",
    primaryAction: {
      label: "Find a support path",
      target: "#triage-form",
    },
    domainExperiences: [
      {
        id: "hurtful-messages",
        eyebrow: "Pause",
        title: "Hurtful messages",
        description:
          "Slow the moment down, preserve useful evidence, and decide who can help without replying under pressure.",
        actionLabel: "Make a calm plan",
        target: "#triage-form",
        intentId: "insults",
      },
      {
        id: "image-pressure",
        eyebrow: "Protect",
        title: "Pressure involving images",
        description:
          "Stop contact, avoid forwarding private material, and reach a trusted adult through a safer channel.",
        actionLabel: "See protective steps",
        target: "#triage-form",
        intentId: "image-pressure",
      },
      {
        id: "hate-or-targeting",
        eyebrow: "Connect",
        title: "Hate speech or targeting",
        description:
          "Document what happened, use platform protections, and build a handoff that explains what support you need.",
        actionLabel: "Prepare a handoff",
        target: "#triage-form",
        intentId: "hate-speech",
      },
    ],
  },
  "ai-literacy": {
    id: "ai-literacy",
    title: "AI Literacy Lab",
    productLabel: "Think with AI, not after it",
    tagline: "Practice the small checks that turn an AI answer into a better decision.",
    description:
      "Work through short challenges about evidence, missing viewpoints, and prompts while staying in control of the final answer.",
    audience: "Students, families, and first-time AI explorers",
    theme: "mint",
    primaryAction: {
      label: "Try an AI check",
      target: "#exercise-lab",
    },
    domainExperiences: [
      {
        id: "source-check",
        eyebrow: "Verify",
        title: "Check the source",
        description:
          "Spot claims that need evidence and choose a stronger way to confirm them outside the AI response.",
        actionLabel: "Test a claim",
        target: "#exercise-lab",
        intentId: "source-check",
      },
      {
        id: "missing-perspectives",
        eyebrow: "Widen",
        title: "Find missing perspectives",
        description:
          "Look for whose experience or context is absent before accepting a confident-sounding summary.",
        actionLabel: "Review an answer",
        target: "#exercise-lab",
        intentId: "missing-perspectives",
      },
      {
        id: "prompt-improvement",
        eyebrow: "Refine",
        title: "Improve the prompt",
        description:
          "Add purpose, context, and useful constraints so the next response is easier to assess and use.",
        actionLabel: "Rewrite a prompt",
        target: "#exercise-lab",
        intentId: "prompt-improvement",
      },
    ],
  },
};

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

const appConfigs = deepFreeze(rawAppConfigs);

export const APP_IDS = Object.freeze(Object.keys(appConfigs));

export function getAppConfig(id) {
  if (typeof id !== "string") {
    return null;
  }

  return appConfigs[id] ?? null;
}

const htmlEntities = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '\"': "&quot;",
  "'": "&#39;",
};

export function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>\"']/g, (character) => htmlEntities[character]);
}

function toDomId(value, fallback) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || fallback;
}

function toFragmentTarget(value, fallback = "#experiences") {
  const target = String(value ?? "").trim();
  return /^#[A-Za-z][A-Za-z0-9_:.-]*$/.test(target) ? target : fallback;
}

function assertConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new TypeError("renderAppIntro expects an app configuration object.");
  }
}

export function renderAppIntro(config) {
  assertConfig(config);

  const domId = toDomId(config.id, "app");
  const title = config.title ?? "Untitled experience";
  const productLabel = config.productLabel ?? "Digital wellbeing";
  const tagline = config.tagline ?? "";
  const description = config.description ?? "";
  const audience = config.audience ?? "";
  const actionLabel = config.primaryAction?.label ?? "Explore experiences";
  const actionTarget = toFragmentTarget(config.primaryAction?.target);
  const designedForLabel = config.locale === "de" ? "Gedacht für" : "Designed for";

  return [
    '<section class="app-intro" aria-labelledby="',
    escapeHTML(domId),
    '-intro-title" aria-describedby="',
    escapeHTML(domId),
    '-intro-description">',
    '<div class="app-intro__content">',
    '<p class="app-intro__eyebrow">',
    escapeHTML(productLabel),
    "</p>",
    '<h1 class="app-intro__title" id="',
    escapeHTML(domId),
    '-intro-title">',
    escapeHTML(title),
    "</h1>",
    '<p class="app-intro__tagline">',
    escapeHTML(tagline),
    "</p>",
    '<p class="app-intro__description" id="',
    escapeHTML(domId),
    '-intro-description">',
    escapeHTML(description),
    "</p>",
    '<a class="button button--primary" href="',
    escapeHTML(actionTarget),
    '">',
    escapeHTML(actionLabel),
    "</a>",
    "</div>",
    '<aside class="app-intro__note" aria-label="',
    escapeHTML(designedForLabel),
    '">',
    '<span class="app-intro__note-label">',
    escapeHTML(designedForLabel),
    "</span>",
    '<strong class="app-intro__note-value">',
    escapeHTML(audience),
    "</strong>",
    "</aside>",
    "</section>",
  ].join("");
}

export function renderExperienceCards(items) {
  if (!Array.isArray(items)) {
    throw new TypeError("renderExperienceCards expects an array of experiences.");
  }

  if (items.length === 0) {
    return '<p class="empty-state" role="status">No experiences are available yet.</p>';
  }

  const cards = items.map((item, index) => {
    const experience = item && typeof item === "object" ? item : {};
    const domId = toDomId(experience.id, "experience") + "-" + (index + 1);
    const eyebrow = experience.eyebrow ?? "Explore";
    const title = experience.title ?? "Untitled experience";
    const description = experience.description ?? "";
    const actionLabel = experience.actionLabel ?? "Open experience";
    const actionTarget = toFragmentTarget(experience.target);
    const intentId = toDomId(experience.intentId ?? experience.id, "experience");

    return [
      '<article class="experience-card" role="listitem" data-experience-id="',
      escapeHTML(experience.id ?? domId),
      '" aria-labelledby="',
      escapeHTML(domId),
      '-title">',
      '<p class="experience-card__eyebrow">',
      escapeHTML(eyebrow),
      "</p>",
      '<h2 class="experience-card__title" id="',
      escapeHTML(domId),
      '-title">',
      escapeHTML(title),
      "</h2>",
      '<p class="experience-card__description">',
      escapeHTML(description),
      "</p>",
      '<a class="experience-card__action" href="',
      escapeHTML(actionTarget),
      '" data-experience-intent="',
      escapeHTML(intentId),
      '">',
      escapeHTML(actionLabel),
      '<span aria-hidden="true">&nbsp;→</span>',
      "</a>",
      "</article>",
    ].join("");
  });

  return '<div class="experience-grid" role="list">' + cards.join("") + "</div>";
}

const memoryStorage = new Map();

function resolvePersistentStorage() {
  try {
    const storage = globalThis.localStorage;
    if (
      storage &&
      typeof storage.getItem === "function" &&
      typeof storage.setItem === "function" &&
      typeof storage.removeItem === "function"
    ) {
      return storage;
    }
  } catch {
    // Access to localStorage can be denied in privacy-focused browser contexts.
  }

  return null;
}

function assertStoragePart(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(label + " must be a non-empty string.");
  }

  return value.trim();
}

export function createStorage(namespace) {
  const prefix = assertStoragePart(namespace, "Storage namespace") + ":";
  const persistentStorage = resolvePersistentStorage();

  function namespacedKey(key) {
    return prefix + assertStoragePart(key, "Storage key");
  }

  function readRaw(key) {
    if (memoryStorage.has(key)) {
      return memoryStorage.get(key);
    }

    if (persistentStorage) {
      try {
        const storedValue = persistentStorage.getItem(key);
        if (storedValue !== null) {
          return storedValue;
        }
      } catch {
        // Fall through to the in-memory store.
      }
    }

    return null;
  }

  return Object.freeze({
    get(key, fallback = null) {
      const rawValue = readRaw(namespacedKey(key));

      if (rawValue === null) {
        return fallback;
      }

      try {
        return JSON.parse(rawValue);
      } catch {
        return fallback;
      }
    },

    set(key, value) {
      const fullKey = namespacedKey(key);
      const serializedValue = JSON.stringify(value);

      if (serializedValue === undefined) {
        throw new TypeError("Storage values must be JSON-serializable.");
      }

      if (persistentStorage) {
        try {
          persistentStorage.setItem(fullKey, serializedValue);
          memoryStorage.delete(fullKey);
          return value;
        } catch {
          // Quota and privacy failures use the in-memory fallback.
        }
      }

      memoryStorage.set(fullKey, serializedValue);
      return value;
    },

    remove(key) {
      const fullKey = namespacedKey(key);

      if (persistentStorage) {
        try {
          persistentStorage.removeItem(fullKey);
        } catch {
          // The in-memory copy is still removed below.
        }
      }

      memoryStorage.delete(fullKey);
    },

    clear() {
      if (persistentStorage) {
        try {
          for (let index = persistentStorage.length - 1; index >= 0; index -= 1) {
            const key = persistentStorage.key(index);
            if (key?.startsWith(prefix)) {
              persistentStorage.removeItem(key);
            }
          }
        } catch {
          // Clearing the in-memory namespace still provides a safe fallback.
        }
      }

      for (const key of memoryStorage.keys()) {
        if (key.startsWith(prefix)) {
          memoryStorage.delete(key);
        }
      }
    },
  });
}
