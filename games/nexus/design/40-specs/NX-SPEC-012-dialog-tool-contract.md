---
id: NX-SPEC-012
title: Диалог-система и контракт инструментов LLM-NPC (зарезервировано)
type: spec
status: planned
layer: technical
abstraction: general
version: 0.1
created: 2026-06-29
updated: 2026-06-29
authors: [claude-opus-4-8]
tags: [llm, dialogue, npc, tool-contract, grounding, permission-layer, reserved, stub]
relates_to: [NX-INN-008, NX-SYS-002, NX-INN-002, NX-INN-006, NX-VIS-004]
depends_on: [NX-SYS-002]
comments_on: []
superseded_by: null
reserved_from: NX-SPEC-005
language: ru
---

# Диалог-система и контракт инструментов LLM-NPC (зарезервировано)

> **Статус: зарезервировано (заглушка).** ID выделен, документ планируется. Технический контракт
> диалога LLM-NPC, вынесенный из форвард-ссылки [NX-INN-008](../20-innovation/NX-INN-008-llm-driven-npcs.md).
> ID `NX-SPEC-012` присвоен при разрешении коллизии имён `NX-SPEC-005`
> ([CONSTITUTION §3](../00-meta/CONSTITUTION.md): ID уникальны и неизменны).

## TL;DR
Реализуемый контракт диалоговой системы: схема инструментов (function-calling), фактический/
разрешительный слой (анти-выдумка), память/цели NPC, бюджеты вызовов и кэш, офлайн-фолбэк на
классические диалоговые деревья.

## Краткое содержание (план)
Будет зафиксировано: формат запроса/ответа диалога, белый список инструментов и их контракты,
grounding-слой (что NPC может знать/делать), серверная валидация ([NX-SYS-002]), бюджеты/кэш,
интеграция с субстратом «Койне» ([NX-VIS-004]) и текстовым слоем ([NX-INN-014]).

## Связанные документы
- [NX-INN-008 LLM-управляемые NPC](../20-innovation/NX-INN-008-llm-driven-npcs.md) — концепция (откуда вынесено).
- [NX-SYS-002 Сеть и эхо] · [NX-INN-006 Мифосинтез] · [NX-VIS-004 Койне].
