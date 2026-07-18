# Монорепозиторий `htdocs/01`

Несколько независимых проектов, ранее лежавших вперемешку в одной папке. Теперь каждый — в своём каталоге.

## Структура

| Путь | Проект | Что это |
|------|--------|---------|
| `games/nexus/` | Игра **NEXUS** | Браузерная экшен-RPG в трёх версиях рендера: v1 (2D-MMO), v2 (изометрия), v3 (Three.js 3D) |
| `games/crystal-collector/` | **Crystal Collector** | Отдельные прототипы-тесты рендера (собрать кристаллы → портал): 2.5D и 3D |
| `games/ad-concepts/` | **Ad-concepts** | Три рекламно-монетизируемые мобильные игры (Block Surge / Orchard Peaks / WordGrove): книги GDD + играбельные прототипы, проходы А→Д. Хаб: `games/ad-concepts/index.html` |
| `sites/pomosch-po-domu/` | Лендинг **«Помощь по дому»** | Статичный сайт бытовых услуг + генераторы прайса (Python/PHP) |
| `vendor/tiddlywiki/` | TiddlyWiki | Сторонний вики-движок (пустой экспорт), не часть проектов |

## Запуск (XAMPP)

Папка отдаётся Apache как `http://localhost/01/`. Примеры точек входа:

- NEXUS v3 (3D): `http://localhost/01/games/nexus/v3-3d/game.html`
- NEXUS v2 (изометрия): `http://localhost/01/games/nexus/v2-isometric/game.html`
- NEXUS v1 (2D MMO): `http://localhost/01/games/nexus/v1-2d-mmo/game.html` — нужен MySQL + импорт `nexus_setup.sql`
- Лендинг (витрина прайса): `http://localhost/01/sites/pomosch-po-domu/prais.php`

Детали по каждому проекту — в его собственном `README.md`.

## История

Репозиторий инициализирован локально; реструктуризация в монорепо выполнена через `git mv`,
поэтому история файлов сохранена (`git log --follow <файл>`).
