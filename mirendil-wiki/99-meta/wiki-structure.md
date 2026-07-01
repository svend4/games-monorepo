# Структура вики

[⌂ Вики](../README.md) · Мета · Структура

Вики оформлена как папочная Markdown-документация; навигация — `_sidebar.md` (для [Docsify](https://docsify.js.org)) и `SUMMARY.md` (для [GitBook](https://www.gitbook.com)/[mdBook](https://rust-lang.github.io/mdBook/)).

## Дерево

```
mirendil-wiki/
├── README.md                     # главная
├── _sidebar.md                   # навигация (Docsify)
├── SUMMARY.md                    # оглавление (GitBook/mdBook)
├── 00-overview/                  # обзор компании
│   ├── README.md                # Обзор компании — оглавление
│   ├── mission-and-thesis.md    # Миссия и тезис
│   ├── team-and-founders.md     # Команда и основатели
│   ├── funding-and-investors.md # Финансирование и инвесторы
│   ├── self-accelerating-ai.md  # Тезис: self-accelerating AI
│   ├── safety-debate.md         # Спор о безопасности (RSI)
│   ├── comparison-anthropic-openai.md # Сравнение с Anthropic и OpenAI
│   ├── timeline.md              # Хронология
│   ├── glossary.md              # Глоссарий
│   ├── sources.md               # Источники
├── 10-positions/                 # 14 позиций
│   ├── README.md                 # индекс + таблица
│   ├── common-conditions-and-culture.md
│   ├── 01-pretraining/
│   │   ├── README.md
│   │   ├── tasks/  (5 стр.)
│   │   ├── requirements.md · tech-stack.md · product-link.md
│   ├── 02-post-training-rl/
│   │   ├── README.md
│   │   ├── tasks/  (8 стр.)
│   │   ├── requirements.md · tech-stack.md · product-link.md
│   ├── 03-post-training-rl-environments/
│   │   ├── README.md
│   │   ├── tasks/  (5 стр.)
│   │   ├── requirements.md · tech-stack.md · product-link.md
│   ├── 04-post-training-rl-infra/
│   │   ├── README.md
│   │   ├── tasks/  (5 стр.)
│   │   ├── requirements.md · tech-stack.md · product-link.md
│   ├── 05-ai-for-ai-systems/
│   │   ├── README.md
│   │   ├── tasks/  (4 стр.)
│   │   ├── requirements.md · tech-stack.md · product-link.md
│   ├── 06-agent-harness/
│   │   ├── README.md
│   │   ├── tasks/  (5 стр.)
│   │   ├── requirements.md · tech-stack.md · product-link.md
│   ├── 07-model-evaluation/
│   │   ├── README.md
│   │   ├── tasks/  (5 стр.)
│   │   ├── requirements.md · tech-stack.md · product-link.md
│   ├── 08-inference/
│   │   ├── README.md
│   │   ├── tasks/  (6 стр.)
│   │   ├── requirements.md · tech-stack.md · product-link.md
│   ├── 09-kernels/
│   │   ├── README.md
│   │   ├── tasks/  (3 стр.)
│   │   ├── requirements.md · tech-stack.md · product-link.md
│   ├── 10-infrastructure/
│   │   ├── README.md
│   │   ├── tasks/  (5 стр.)
│   │   ├── requirements.md · tech-stack.md · product-link.md
│   ├── 11-platform/
│   │   ├── README.md
│   │   ├── tasks/  (4 стр.)
│   │   ├── requirements.md · tech-stack.md · product-link.md
│   ├── 12-product-development/
│   │   ├── README.md
│   │   ├── tasks/  (5 стр.)
│   │   ├── requirements.md · tech-stack.md · product-link.md
│   ├── 13-design-engineer/
│   │   ├── README.md
│   │   ├── tasks/  (6 стр.)
│   │   ├── requirements.md · tech-stack.md · product-link.md
│   ├── 14-security-engineer/
│   │   ├── README.md
│   │   ├── tasks/  (5 стр.)
│   │   ├── requirements.md · tech-stack.md · product-link.md
└── 99-meta/
    ├── wiki-structure.md
    └── methodology-and-caveats.md
```

## Конвенции

- Язык — русский; технические термины с английским оригиналом в скобках при первом упоминании.
- Slug-имена папок/файлов — латиницей и в нижнем регистре (как в остальном монорепозитории), заголовки и текст — по-русски.
- Каждая страница начинается с H1 и хлебных крошек; кросс-ссылки — относительными путями.
- Одна задача из вакансии = одна страница в `tasks/` (принцип «каждой задаче — отдельная подтема»).
- Факт и аналитическая реконструкция явно разделены.

## Как смотреть

- Просто как файлы на GitHub/в редакторе (ссылки кликабельны).
- Или поднять Docsify: положить `index.html` Docsify рядом и открыть — `_sidebar.md` подхватится.
- Или собрать mdBook/GitBook по `SUMMARY.md`.

---
_· независимая документация, не аффилировано с Mirendil._
