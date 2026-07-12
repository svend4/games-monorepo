# Continuation sprint 6 - guided entry points and safer drafts

## Context

Sprint 5 completed one useful local interaction loop in each app. The domain
experience cards still looked actionable without carrying the user's chosen
context into those tools, and Help Bridge persisted more sensitive draft data
than its core flow required.

## Product outcome

- Every domain experience is a real keyboard-operable link to its app workflow.
- Safe Search preselects the matching school, news, or creative room.
- Media Time focuses and temporarily highlights the matching planning category.
- Help Bridge preselects the matching incident without skipping its safety check.
- AI Literacy opens and focuses the matching exercise.
- Choosing a card never submits a form or completes an activity automatically.

## Privacy and safety

Help Bridge builds a plan without silently saving it. Saving remains an explicit
action and stores only structured check-in choices; names and free-text notes are
kept out of persistent browser storage. Urgent answers receive an immediate,
visible reminder to involve a nearby adult or emergency services.

## Quality gates

The shared validator requires safe fragment targets, verifies that every target
exists in the corresponding HTML page, and checks that every app handles the
shared experience-intent contract. Pure logic tests cover the intent mappings
and privacy-safe draft shape; browser smoke checks cover one full loop per app.
