# Continuation sprint 8 - addressable guided entry points

## Context

Experience cards already applied useful context when selected in the current
page, but every card in an app shared the same fragment target. Opening a card
in a new tab or copying its link lost the chosen starting point.

## Product outcome

- Every experience card has a unique, local fragment target.
- Selecting a card updates the address without reloading the page.
- Direct links restore the intended search room, planning category, incident
  type or AI-literacy exercise.
- Unknown, external and executable targets are ignored by the shared resolver.

## Privacy and safety

Fragments contain only fixed intent identifiers from the product configuration.
Search terms, form answers, names, notes and saved progress never enter the URL.
All restoration remains local and makes no network request.

## Quality gates

Shared unit tests cover safe target resolution. The validator requires unique
targets, real HTML anchors and resolver wiring in all four apps. Browser smoke
coverage starts each workflow from a direct link and verifies that later card
selection keeps the fragment and focused experience in sync.
