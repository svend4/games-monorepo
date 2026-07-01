# Требования и профиль кандидата

[⌂ Вики](../../README.md) · [Позиции](../README.md) · [Agent Harness](README.md) · Требования

Страница отделяет то, что **реально сказано** в тексте вакансии, от **аналитической реконструкции** — обоснованных выводов о профиле, которых в тексте нет.

## Явно из вакансии

- **Роль:** Member of Technical Staff, Agent Harness (инженерная позиция MTS).
- **Локация и формат:** San Francisco, on-site (очно).
- **Занятость:** FullTime.
- **Вознаграждение:** $350,000–$500,000/год + значимый equity (meaningful equity).
- **Мотивация роли (дословно):** «engineer passionate about giving the model tools to perform the best it can», умеющий «deeply understand model capabilities and build efficient architectures for the model and researchers to work across».
- **Ключевые области ответственности (названы прямо):**
  - agent harness: agent loop architecture, tool integrations, prompt scaffolding, execution environments, capability primitives;
  - orchestration systems для horizontal scaling: memory, state management, multi-agent coordination, task decomposition;
  - guardrails и reliability mechanisms для long-horizon agentic tasks;
  - extension layer между моделями и внешними tools/APIs/environments;
  - evaluation и observability tooling.

> В тексте вакансии **нет** формальных требований к годам опыта, конкретным языкам программирования, образованию или конкретному технологическому стеку. Всё ниже — реконструкция.

## Вероятный профиль (аналитическая реконструкция)

*Пометка: раздел — обоснованные предположения, выведенные из формулировок вакансии и контекста компании; в тексте вакансии этого нет.*

- **Сильная системная инженерия (вероятно).** Формулировки «orchestration», «horizontal scaling», «state management», «reliability mechanisms» указывают на инженера распределённых систем, а не только на ML-специалиста.
- **Практический опыт с LLM-агентами (вероятно).** «Agent loop», «tool integrations», «prompt scaffolding» предполагают, что кандидат уже строил агентные системы поверх больших языковых моделей (LLM).
- **Понимание возможностей моделей (косвенно следует).** Прямая формулировка «deeply understand model capabilities» предполагает опыт работы бок о бок с исследователями и понимание поведения фронтир-моделей, даже если кандидат сам не тренирует модели.
- **Уклон в надёжность и продакшн (вероятно).** Акцент на guardrails, edge cases и long-horizon robustness говорит о профиле, ценящем устойчивость систем, а не только прототипирование.
- **Готовность к раннему стартапу (косвенно следует).** ~20 человек на момент анонса, отсутствие публичного продукта и «значимый equity» — типичный контекст, где ценятся широта, автономность и скорость.
- **Уровень seniority (вероятно).** Вилка $350k–$500k и обозначение MTS указывают на senior/staff-уровень с ответственностью за целую подсистему («own the extension layer»).

## Ссылки

- [← Обзор роли Agent Harness](README.md)
- [Технологический стек](tech-stack.md)
- [Связь с продуктом и тезисом](product-link.md)

— · [Методология и оговорки](../../99-meta/methodology-and-caveats.md) · независимая документация, не аффилировано с Mirendil.
