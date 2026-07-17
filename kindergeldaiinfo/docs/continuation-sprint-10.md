# Continuation sprint 10 - trustworthy language metadata

## Context

Safe Search and Media Time are German experiences, while Help Bridge and AI
Literacy are English. The two German pages inherited the correct document
language but incorrectly overrode their generated introductions and experience
cards as English, causing assistive technology to select the wrong pronunciation.

## Product outcome

- Every app configuration declares an explicit `de` or `en` locale.
- Each app document language matches its product configuration.
- Dynamic introductions and experience cards inherit the page language instead
  of carrying stale hard-coded overrides.
- Portal cards keep their own language metadata inside the English portal.

## Quality gates

Shared tests protect the exact app-to-locale mapping. The monorepo validator
checks supported locales, document/config agreement and dynamic mount
overrides. Browser smoke coverage verifies the effective language of the portal
cards and generated regions in all four applications.
