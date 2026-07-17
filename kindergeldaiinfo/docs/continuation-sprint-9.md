# Continuation sprint 9 - discoverable mobile table navigation

## Context

The Media Time planner is deliberately wider than a phone viewport so day and
category relationships remain tabular. The region was horizontally scrollable
and keyboard-focusable, but the interface did not tell young people or families
how to reach the columns outside the initial viewport.

## Product outcome

- A visible German instruction explains touch and keyboard navigation.
- The scroll region references that instruction with `aria-describedby`.
- The existing table caption remains its accessible name.
- The planner keeps native horizontal scrolling and input behaviour.

## Quality gates

Browser smoke coverage now proves that the planner really overflows at the
mobile viewport, the instruction is visible and linked, and the region remains
keyboard-focusable. Unit tests and structural validation continue to cover the
four product flows and repository contract.
