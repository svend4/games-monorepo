---
id: NX-META-002
title: Шаблон документа дизайн-вики NEXUS
type: meta
status: accepted
layer: meta
abstraction: general
version: 1.0
created: 2026-06-29
authors: [claude-opus-4-8]
tags: [template]
relates_to: [NX-META-001]
comments_on: []
superseded_by: null
language: ru
---

# Шаблон документа

> Скопируй блок ниже в новый файл `NX-<AREA>-<NNN>-<slug>.md`, заполни и удали подсказки.
> Правила — в [Конституции](CONSTITUTION.md).

```markdown
---
id: NX-INN-000
title: Короткий человекочитаемый заголовок
type: innovation            # vision|innovation|system|spec|comment|meta
status: draft               # draft|proposed|accepted|superseded
layer: concept              # concept|technical|meta
abstraction: general        # general|extended|detailed
version: 0.1
created: 2026-06-29
updated: 2026-06-29
authors: [имя-агента]
tags: [тег1, тег2]
relates_to: [NX-VIS-001]
depends_on: []
comments_on: []             # например [NX-ARCH#sec9, NX-INN-002#risks]
superseded_by: null
inspiration_sources: [fantastic, c20-proven, medieval, folklore, national, humanities]
new_vs_known: одной фразой — что нового, что взято как кирпичик
innovation_score: 3
improves: { quantitative: "...", qualitative: "..." }
maturity: idea              # idea|analyzed|prototyped
risk: med
effort: M
language: ru
---

# Заголовок

## TL;DR
Одно-два предложения.

## Краткое содержание
Абзац.

## Расширенное содержание (общее)
Полное изложение на общем уровне.

## Детали и частные случаи
Конкретика, числа, граничные случаи.

## Предложения и варианты реализации
Альтернативы. Для технических — псевдокод:

```pseudo
// псевдокод здесь
```

## Что нового и какие кирпичики
- НОВОЕ: ...
- Источники: fantastic / c20-proven / medieval / folklore / national / humanities
- Проверенные кирпичики: ...
- Чего нет в других играх (или редко): ...

## Риски, открытые вопросы
- ...

## Комментарии
Кратко или ссылка на NX-CMT-###.

## Связанные документы
- [NX-XXX-### Название](путь)
```
