import { escapeHTML, getAppConfig } from "./packages/shared/src/index.js";

const tools = [
  {
    id: "safe-search",
    path: "./apps/safe-search/",
    number: "01",
    action: "Sicher suchen",
  },
  {
    id: "media-time",
    path: "./apps/media-time/",
    number: "02",
    action: "Eine Woche ausgleichen",
  },
  {
    id: "help-bridge",
    path: "./apps/help-bridge/",
    number: "03",
    action: "Make a calm help plan",
  },
  {
    id: "ai-literacy",
    path: "./apps/ai-literacy/",
    number: "04",
    action: "Practise checking AI",
  },
];

const grid = document.querySelector("#tool-grid");

function toolCard(tool) {
  const config = getAppConfig(tool.id);
  const title = config.name ?? config.title ?? tool.id;
  const description = config.description ?? config.tagline ?? "Open this focused activity.";
  const experienceCount = Array.isArray(config.domainExperiences)
    ? config.domainExperiences.length
    : 0;

  return `
    <article class="portal-card portal-card--${escapeHTML(tool.id)}" lang="${escapeHTML(config.locale ?? "en")}">
      <div class="portal-card__topline">
        <span>${escapeHTML(tool.number)}</span>
        <span>${escapeHTML(config.locale === "de" ? `${experienceCount || 3} geführte Schritte` : `${experienceCount || 3} guided moments`)}</span>
      </div>
      <div>
        <h3>${escapeHTML(title)}</h3>
        <p>${escapeHTML(description)}</p>
      </div>
      <a href="${escapeHTML(tool.path)}">
        ${escapeHTML(tool.action)}
        <span aria-hidden="true">↗</span>
      </a>
    </article>
  `;
}

grid.innerHTML = tools.map(toolCard).join("");
