# Continuation sprint 11 - deterministic Windows browser cleanup

## Context

The smoke workflows completed quickly, but Windows could keep helper processes
from the isolated Chromium session alive after the main browser process closed.
Those helpers held temporary profile files open and made cleanup retry for close
to a minute even though the product checks had already passed.

## Product outcome

- Windows smoke runs terminate the complete process tree rooted at the exact
  browser PID launched by the runner.
- The forceful path stays scoped to the runner's isolated throwaway browser and
  never targets an existing user browser session.
- macOS and Linux keep the graceful DevTools shutdown path.
- Temporary profile removal remains mandatory after every successful or failed
  smoke run.

## Quality gates

A unit test protects the platform-to-shutdown-strategy mapping. The full
browser smoke check verifies all four product workflows and must still finish
with a clean console and no temporary `small-steps-smoke-*` profile directory.
