# Digital safety prototypes

This repository contains four small, focused product prototypes for young people and families. They share a dependency-free foundation while keeping each product free to develop its own interaction model.

| App ID | Product focus |
| --- | --- |
| `safe-search` | Purpose-led searching and source awareness |
| `media-time` | A balanced, editable weekly media plan |
| `help-bridge` | Calm support paths for difficult online situations |
| `ai-literacy` | Short exercises for checking and improving AI output |

Safe Search and Media Time are presented in German; Help Bridge and AI Literacy are presented in English. The portal preserves each app's language instead of mixing languages inside a workflow.

## Run the checks

Node.js 22 or newer is sufficient; there is nothing to install.

```sh
npm test
npm run validate
```

The test suite checks the public shared API, safe HTML rendering, the four product configurations, namespaced storage, and each app's pure product logic. It uses Node's in-process test isolation mode so it runs reliably in restricted Windows environments. The validator checks the complete portal and app structure, package scripts, data quality, accessible markup, raw-export isolation, and responsive CSS safeguards.

### Browser smoke check

The optional smoke check drives an isolated Chrome tab through the XAMPP site,
verifies one complete loop in every app, checks browser storage, and writes
responsive screenshots to the ignored `artifacts/` directory.

Start Chrome with a separate local test profile in another PowerShell window:

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" --headless=new --remote-debugging-port=9223 --user-data-dir="$env:TEMP\small-steps-smoke" about:blank
```

Then run:

```sh
npm run smoke
```

`APP_ORIGIN`, `CDP_ORIGIN`, and `ARTIFACT_DIR` can override the defaults.

## Shared foundation

The public module is `packages/shared/src/index.js`.

- `getAppConfig(id)` returns the immutable configuration for one of the four known IDs, or `null` for an unknown ID.
- `escapeHTML(value)` converts a value to safe text for HTML interpolation.
- `renderAppIntro(config)` renders an accessible product introduction with a safe in-page action target.
- `renderExperienceCards(items)` renders a semantic list of escaped, keyboard-operable intent links.
- `createStorage(namespace)` creates a small JSON store with `get(key, fallback)`, `set(key, value)`, `remove(key)`, and `clear()`.

Storage uses browser `localStorage` when it is available. Privacy restrictions and storage quota failures fall back to an in-memory store, so an interaction can keep working without crashing. `clear()` removes only values inside its own namespace.

The shared stylesheet is `packages/shared/styles/base.css`. It provides design tokens, app color themes, layout primitives, form and feedback states, visible focus treatment, reduced-motion support, forced-color support, and mobile-first responsive cards. It uses only system fonts and makes no external requests.


Help Bridge uses the same resilient storage wrapper only after the user chooses
to save. Its persistent draft excludes names and free-text notes so a shared
device retains less sensitive context.
## Integration example

```js
import {
  getAppConfig,
  renderAppIntro,
  renderExperienceCards,
} from '../../packages/shared/src/index.js';

const config = getAppConfig('safe-search');

document.querySelector('#app-intro').innerHTML = renderAppIntro(config);
document.querySelector('#experiences').innerHTML = renderExperienceCards(
  config.domainExperiences,
);
```

Include the foundation styles from an app HTML file:

```html
<link rel="stylesheet" href="../../packages/shared/styles/base.css">
```

All strings passed to a renderer are escaped. Apps should use DOM text properties for later updates and should never concatenate user input into markup.

## Repository layout

```text
apps/                         App-owned interfaces and interaction logic
packages/shared/src/index.js  Shared data and browser utilities
packages/shared/styles/       Shared accessible design foundation
scripts/                      Repository validation
tests/shared.test.mjs         Shared API tests
```

The shared layer deliberately owns product metadata and reusable primitives, not app-specific state machines. This keeps the four interfaces consistent in quality without forcing them into the same screen structure.
