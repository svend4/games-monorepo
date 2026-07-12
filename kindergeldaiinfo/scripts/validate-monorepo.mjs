import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  APP_IDS,
  getAppConfig,
  renderAppIntro,
  renderExperienceCards,
} from "../packages/shared/src/index.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const failures = [];

const expectedAppIds = [
  "safe-search",
  "media-time",
  "help-bridge",
  "ai-literacy",
];

const rootRequiredFiles = [
  ".gitignore",
  "package.json",
  "README.md",
  "index.html",
  "portal.js",
  "portal.css",
  "docs/continuation-sprint-5.md",
  "docs/continuation-sprint-6.md",
  "packages/shared/src/index.js",
  "packages/shared/styles/base.css",
  "scripts/validate-monorepo.mjs",
  "scripts/browser-smoke.mjs",
  "tests/shared.test.mjs",
];

const appFileNames = ["index.html", "app.js", "logic.js", "styles.css"];
const appRequiredFiles = expectedAppIds.flatMap((appId) => [
  ...appFileNames.map((fileName) => "apps/" + appId + "/" + fileName),
  "tests/" + appId + ".test.mjs",
]);

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isFragmentTarget(value) {
  return typeof value === "string" &&
    /^#[A-Za-z][A-Za-z0-9_:.-]*$/.test(value);
}


async function checkFile(relativePath) {
  try {
    await access(path.join(repositoryRoot, relativePath));
  } catch {
    failures.push("Missing required file: " + relativePath);
  }
}

async function readText(relativePath) {
  try {
    return await readFile(path.join(repositoryRoot, relativePath), "utf8");
  } catch {
    return null;
  }
}

await Promise.all([...rootRequiredFiles, ...appRequiredFiles].map(checkFile));

try {
  const packageJson = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  );

  check(packageJson.type === "module", "package.json must set type to module.");
  check(
    packageJson.scripts?.test === "node --test --test-isolation=none",
    "package.json test script must run node --test --test-isolation=none.",
  );
  check(
    packageJson.scripts?.validate === "node scripts/validate-monorepo.mjs",
    "package.json validate script must run the monorepo validator.",
  );
  check(
    packageJson.scripts?.smoke === "node scripts/browser-smoke.mjs",
    "package.json smoke script must run the browser smoke check.",
  );
  check(
    !packageJson.dependencies || Object.keys(packageJson.dependencies).length === 0,
    "The shared foundation must not add runtime dependencies.",
  );
} catch (error) {
  failures.push("Could not parse package.json: " + error.message);
}

check(
  expectedAppIds.every((id) => APP_IDS.includes(id)) &&
    APP_IDS.every((id) => expectedAppIds.includes(id)),
  "Shared data must contain exactly the four expected app IDs.",
);

for (const appId of expectedAppIds) {
  const config = getAppConfig(appId);

  check(config !== null, "Missing app config for " + appId + ".");
  if (!config) {
    continue;
  }

  const appHtml = await readText("apps/" + appId + "/index.html");
  const appSource = await readText("apps/" + appId + "/app.js");
  const pageIds = new Set([...(appHtml ?? "").matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]));

  check(config.id === appId, "Config ID does not match its key for " + appId + ".");
  for (const field of ["title", "productLabel", "tagline", "description", "audience", "theme"]) {
    check(
      isNonEmptyString(config[field]),
      appId + " must define a non-empty " + field + ".",
    );
  }

  check(
    isNonEmptyString(config.primaryAction?.label),
    appId + " must define a primary action label.",
  );

  check(
    isFragmentTarget(config.primaryAction?.target),
    appId + " must define a safe primary action target.",
  );
  check(
    !isFragmentTarget(config.primaryAction?.target) ||
      pageIds.has(config.primaryAction.target.slice(1)),
    appId + " primary action target must exist in its HTML page.",
  );
  check(
    appSource === null || appSource.includes("[data-experience-intent]"),
    appId + " must handle experience intent controls.",
  );

  check(
    Array.isArray(config.domainExperiences) && config.domainExperiences.length >= 3,
    appId + " must define at least three domain experiences.",
  );

  const experienceIds = new Set();
  const experienceIntentIds = new Set();
  for (const [index, experience] of (config.domainExperiences ?? []).entries()) {
    const location = appId + " domain experience " + (index + 1);
    for (const field of ["id", "eyebrow", "title", "description", "actionLabel", "target", "intentId"]) {
      check(
        isNonEmptyString(experience[field]),
        location + " must define a non-empty " + field + ".",
      );
    }

    check(
      !experienceIds.has(experience.id),
      appId + " contains a duplicate domain experience ID: " + experience.id,
    );
    experienceIds.add(experience.id);
    check(
      isFragmentTarget(experience.target) && pageIds.has(experience.target.slice(1)),
      location + " target must reference an element in the app HTML.",
    );
    check(
      !experienceIntentIds.has(experience.intentId),
      appId + " contains a duplicate experience intent ID: " + experience.intentId,
    );
    experienceIntentIds.add(experience.intentId);
  }

  try {
    const introMarkup = renderAppIntro(config);
    const cardsMarkup = renderExperienceCards(config.domainExperiences);
    check(
      introMarkup.includes("aria-labelledby") && introMarkup.includes("<h1"),
      appId + " intro markup must have an accessible heading relationship.",
    );
    check(
      cardsMarkup.includes('role="list"') &&
        cardsMarkup.includes('<a class="experience-card__action"') &&
        cardsMarkup.includes("data-experience-intent"),
      appId + " experience markup must expose list semantics.",
    );
  } catch (error) {
    failures.push("Rendering failed for " + appId + ": " + error.message);
  }
}

async function validateHtmlPage(relativePath, label) {
  const html = await readText(relativePath);
  if (html === null) {
    return;
  }

  check(
    /<html\b[^>]*\blang\s*=\s*["'][^"']+["']/i.test(html),
    label + " must declare a non-empty html lang attribute.",
  );

  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const viewportMeta = metaTags.find((tag) =>
    /\bname\s*=\s*["']viewport["']/i.test(tag),
  );
  check(Boolean(viewportMeta), label + " must include a viewport meta tag.");
  check(
    Boolean(viewportMeta && /\bcontent\s*=\s*["'][^"']*width=device-width/i.test(viewportMeta)),
    label + " viewport must include width=device-width.",
  );

  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  check(
    linkTags.some((tag) =>
      /\bhref\s*=\s*["'][^"']*packages\/shared\/styles\/base\.css["']/i.test(tag),
    ),
    label + " must link the shared base stylesheet.",
  );

  const scriptTags = html.match(/<script\b[^>]*>/gi) ?? [];
  check(
    scriptTags.some((tag) => /\btype\s*=\s*["']module["']/i.test(tag)),
    label + " must load its JavaScript as a module.",
  );

  const anchorTags = html.match(/<a\b[^>]*>/gi) ?? [];
  const skipLink = anchorTags.find((tag) =>
    /\bclass\s*=\s*["'][^"']*skip-link[^"']*["']/i.test(tag),
  );
  const skipTarget = skipLink?.match(/\bhref\s*=\s*["']#([^"']+)["']/i)?.[1] ?? null;
  const mainIds = [...html.matchAll(/<main\b[^>]*\bid\s*=\s*["']([^"']+)["'][^>]*>/gi)].map(
    (match) => match[1],
  );

  check(Boolean(skipLink), label + " must include a skip-link.");
  check(mainIds.length > 0, label + " must include a main landmark with an ID.");
  check(
    Boolean(skipTarget && mainIds.includes(skipTarget)),
    label + " skip-link must target the main landmark.",
  );
}

await Promise.all([
  validateHtmlPage("index.html", "Portal"),
  ...expectedAppIds.map((appId) =>
    validateHtmlPage("apps/" + appId + "/index.html", appId),
  ),
]);

await Promise.all(
  expectedAppIds.flatMap((appId) =>
    appFileNames.map(async (fileName) => {
      const relativePath = "apps/" + appId + "/" + fileName;
      const source = await readText(relativePath);
      if (source !== null) {
        check(
          !source.includes("Claude_"),
          relativePath + " must not reference a raw Claude export path.",
        );
      }
    }),
  ),
);

try {
  const stylesheet = await readFile(
    path.join(repositoryRoot, "packages/shared/styles/base.css"),
    "utf8",
  );
  check(stylesheet.includes(":focus-visible"), "Base CSS must include visible focus styles.");
  check(
    stylesheet.includes("prefers-reduced-motion"),
    "Base CSS must respect reduced-motion preferences.",
  );
  check(
    stylesheet.includes("@media (min-width:"),
    "Base CSS must include mobile-first responsive enhancements.",
  );
} catch (error) {
  failures.push("Could not inspect the shared stylesheet: " + error.message);
}

if (failures.length > 0) {
  console.error("Validation failed:\n- " + failures.join("\n- "));
  process.exitCode = 1;
} else {
  console.log(
    "Validation passed: portal, shared foundation, and " +
      expectedAppIds.length +
      " complete apps are ready.",
  );
}
