# Continuation sprint 7 - one-command browser confidence

## Context

The complete browser flow already covered the portal and all four tools, but it
depended on a separately running XAMPP site and a manually started Chrome debug
session. A missing prerequisite looked like a product failure instead of a test
environment problem.

## Product outcome

- `npm run smoke` now starts its own temporary static server.
- It launches Chrome, Chromium or Edge with an isolated throwaway profile.
- Existing `APP_ORIGIN` and `CDP_ORIGIN` overrides still support externally
  managed test environments.
- `CHROME_BIN` supports non-standard browser installations.
- Browser processes, local listeners and temporary profile data are cleaned up
  after both successful and failed runs.

## Quality gates

The validator protects the runner entry point. Unit tests cover safe static-file
resolution and deterministic browser discovery. The end-to-end scenario still
verifies all four core loops, privacy-sensitive storage, responsive screenshots
and a clean browser console.
