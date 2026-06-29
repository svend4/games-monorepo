---
id: NX-SPEC-011
title: Симуляция фракций и nemesis — контракт (зарезервировано)
type: spec
status: planned
layer: technical
abstraction: general
version: 0.1
created: 2026-06-29
updated: 2026-06-29
authors: [claude-opus-4-8]
tags: [factions, nemesis, world-tick, simulation, contract, reserved, stub]
relates_to: [NX-SPEC-004, NX-INN-002, NX-SYS-005, NX-INN-009]
depends_on: [NX-SPEC-004]
comments_on: []
superseded_by: null
reserved_from: NX-SPEC-005
language: ru
---

# Симуляция фракций и nemesis — контракт (зарезервировано)

> **Статус: зарезервировано (заглушка).** ID выделен, документ планируется. Это «фракционная
> половина» мир-тика, вынесенная из [NX-SPEC-004](NX-SPEC-004-ecology-sim.md) (форвард-ссылка).
> ID `NX-SPEC-011` присвоен при разрешении коллизии имён `NX-SPEC-005`
> ([CONSTITUTION §3](../00-meta/CONSTITUTION.md): ID уникальны и неизменны).

## TL;DR
Контракт «фракционной» части мир-тика: `factionTick`, цели и конфликты фракций, nemesis-память
о игроке, борьба за зоны. Дополняет экологическое ядро [NX-SPEC-004].

## Краткое содержание (план)
Будет зафиксировано: формат агрегата фракции, правила целей/войн/территорий, nemesis-записи
(через субстрат «Койне» [NX-VIS-004]), стык с экологией ([NX-SPEC-004]) и бюджетом симуляции
([NX-SYS-005]). Источник идей — [NX-INN-002] (живой мир) и [NX-INN-009] (политика/право).

## Связанные документы
- [NX-SPEC-004 Симулятор экологии](NX-SPEC-004-ecology-sim.md) — экологическое ядро (откуда вынесено).
- [NX-INN-002 Живой мир] · [NX-INN-009 Экономика/политика] · [NX-SYS-005 Бюджеты симуляции].
