---
id: NX-SPEC-009
title: Текстовый слой — грамматика команд (рус+англ) + контракт ITextRenderer и маппинг записей→текст
type: spec
status: proposed
layer: technical
abstraction: detailed
version: 0.1
created: 2026-06-29
updated: 2026-06-29
authors: [claude-opus-4-8]
tags: [text, mud, parser, ebnf, grammar, irenderer, text-renderer, render-abstraction, koine, records-to-text, bilingual, es-modules, modern-first, contract, layer-render, accessibility]
relates_to: [NX-INN-014, NX-SYS-004, NX-SPEC-006, NX-VIS-004, NX-STRAT-004, NX-SPEC-007, NX-SPEC-003]
depends_on: [NX-INN-014, NX-SYS-004, NX-SPEC-006]
comments_on: [NX-INN-014#predlozheniya, NX-SYS-004#kontrakt-irenderer, NX-STRAT-004#princip-sovremennoe-pervym]
superseded_by: null
language: ru
---

# Текстовый слой — грамматика команд + контракт ITextRenderer

## TL;DR
Детальный **стек-агностичный** контракт 1D-текстового измерения NEXUS ([NX-INN-014]): (1) **EBNF-грамматика
команд** парсера на двух языках (рус+англ) с каноническими глаголами, синонимами и формой
разобранной команды `ParsedCommand`; (2) контракт **`ITextRenderer`** — текстовая реализация порта
`IRenderer` ([NX-SYS-004]), у которой `present(alpha)` рисует **строки**, а не пиксели, и которая
добавляет ввод-строку; (3) **детерминированный маппинг записей субстрата → текст** (`recordToText`),
переводящий `SubstrateRecord` ([NX-SPEC-006]) в папирус/строку чата/событие. По принципу
«современное-первым» ([NX-STRAT-004]) ядро парсера и рендера — **ES-модуль** с современными
браузерными API (`Intl.Segmenter`, `String.prototype.normalize`, `structuredClone`); легаси
(PHP-вывод HTML, серверный MUD-сокет) — **только опциональный адаптер за тем же интерфейсом
`ITextRenderer`/`TextSink`**, не ядро. Фиксируем сигнатуры, форматы, инварианты, критерии приёмки и
минимальные тест-кейсы.

## Краткое содержание
[NX-INN-014] объявил текст **первоклассным режимом** мира и дал контурный псевдокод
(`TextRenderer.render` = печать отформатированных записей; `TextRenderer.input` = парсинг строки →
запись-намерение). Этот документ — **реализуемый контракт** этого режима. Он закрывает три вопроса,
оставленные открытыми в [NX-INN-014] и [NX-SYS-004]:

1. **«Какая именно грамматика команд?»** — нормативная EBNF (глагол + цели + предлоги + модификаторы),
   двуязычный лексикон канонических глаголов с синонимами, правила нормализации ввода и форма
   результата разбора `ParsedCommand`.
2. **«Как текст вписан в единый рендер?»** — `ITextRenderer extends IRenderer`: те же
   `init/resize/beginFrame/sync/present/dispose` ([NX-SYS-004]), но `present` выводит **поток строк**;
   `worldToScreen`/`screenToWorld` вырождаются в адресацию строк/курсора; добавлен **канал ввода**
   `readLine`/`onInput`, которого нет у графических бэкендов.
3. **«Как запись становится текстом?»** — чистая функция `recordToText(record, ctx)`, детерминированно
   маппящая `SubstrateRecord` ([NX-SPEC-006]) на текстовое представление по `type` через **реестр
   шаблонов** (`TextTemplateRegistry`), с фолбэком и локалью.

Главный инженерный тезис: **текст — не запасной UI, а ещё один адаптер за портом `IRenderer`**.
Та же симуляция и тот же субстрат записей, что кормят Canvas2D/Iso/Three ([NX-SYS-004]), кормят
текстовый бэкенд; различие — только в `present` (строки vs пиксели) и в наличии **строкового ввода**
(MUD-парсер). Это прямое исполнение «один мир — окна в разных измерениях» из [NX-STRAT-004] для 1D.

## Расширенное содержание (общее)

### Место текстового слоя в архитектуре (слои)
```
СЛОЙ 0  EventBus            — нотификации (record:written, input:line)          [NX-SPEC-007]
СЛОЙ 1  Substrate           — append-only журнал Record                          [NX-SPEC-006]
СЛОЙ 2  World (ECS)         — текущее состояние (проекция записей)               [NX-SPEC-002]
СЛОЙ R  IRenderer (порт)    — окна в мир: Canvas2D | Iso | Three | ТЕКСТ          [NX-SYS-004]
         └─ ITextRenderer (ЭТОТ) — 1D-окно: строки наружу, строка-команда внутрь  [NX-SPEC-009]
```
Текстовый слой состоит из **трёх независимых частей**, каждую можно тестировать в изоляции:
- **Грамматика/парсер** (`parseCommand`) — чистая функция `string → ParsedCommand`, без зависимостей
  от мира/субстрата/рендера. Полностью юнит-тестируема в Node.
- **`ITextRenderer`** — адаптер порта `IRenderer`; читает снимок ([NX-SYS-004]) и/или поток записей
  ([NX-SPEC-006]) и выводит строки в `TextSink`; принимает строки ввода и отдаёт их наверх.
- **Маппинг записей→текст** (`recordToText` + `TextTemplateRegistry`) — чистая функция
  `SubstrateRecord → string`, без побочных эффектов.

Текстовый слой **может**: знать про `IRenderer`-снимок ([NX-SYS-004]), про форму `SubstrateRecord`
([NX-SPEC-006]) — но только читать; эмитить `input:line`/команды-намерения наверх (в слой 3/2, не
напрямую в субстрат). Текстовый слой **не может**: писать в субстрат сам (парсер лишь **строит
намерение**; запись делает игровая логика слоя 3 — как в [NX-INN-014] псевдокоде
`Substrate.write(intent_record(cmd))` вызывается **снаружи** рендера), знать про Three.js/Canvas,
интерпретировать `payload` по своему усмотрению вне реестра шаблонов.

### Принцип «современное-первым» — где он проявляется
По [NX-STRAT-004#princip-sovremennoe-pervym] и параллельно [NX-SPEC-006]:
- **Ядро современно.** Парсер и рендер — **ES-модули** (`export function parseCommand`, `class
  TextRenderer implements ITextRenderer`). Сегментация графем/слов — `Intl.Segmenter` (для корректной
  работы с пробелами и пунктуацией в рус/англ); нормализация регистра/диакритики —
  `String.prototype.normalize('NFC')` + `toLocaleLowerCase(locale)`; глубокое копирование снимка —
  `structuredClone`. Вывод по умолчанию — **DOM-`TextSink`** (живой лог в браузере) или
  **`ConsoleSink`** (Node/тест).
- **Легаси — опциональный адаптер.** PHP-вывод HTML-страницы лога или серверный MUD-сокет (telnet)
  реализуют **тот же интерфейс `TextSink`** (и/или `ITextRenderer` на сервере) и подключаются **по
  выбору**, по умолчанию выключены. Они **не блокируют** ядро: без сервера текстовый режим полноценно
  живёт локально поверх локального субстрата ([NX-SPEC-006] I-8). PHP — сменный модуль за интерфейсом,
  **не ядро архитектуры**.
- **Деградация, а не зависимость.** Нет `Intl.Segmenter` (старый движок) → фолбэк на регэксп-токенизацию
  по `\p{L}\p{N}`-классам (или ASCII-фолбэк). Контракт парсера при этом **не меняется** (инвариант I-6).

### Почему грамматика двуязычна и канонична
Субстрат и мир языконезависимы ([NX-VIS-004]); язык — деталь **представления и ввода**. Поэтому парсер
переводит ввод на любом из поддерживаемых языков в **единый канонический глагол** (`CanonicalVerb`,
язык-нейтральный enum-подобный строковый id, напр. `"look"`, `"read"`, `"leave-message"`). Дальнейшая
логика игры работает только с каноническими id — добавление третьего языка ([NX-INN-010]) не трогает
геймплей, только лексикон. Это та же дисциплина «язык — линза над субстратом», что у профессий-линз в
[NX-VIS-004].

## Детали и частные случаи

### Часть 1. Грамматика команд (EBNF, нормативная)

#### Конвейер разбора
```
сырая строка
  → нормализация (trim, NFC, схлопывание пробелов, lower по локали)
  → токенизация (Intl.Segmenter | regex-фолбэк)
  → лексикон (синоним → CanonicalVerb; стоп-слова/артикли отброшены)
  → разбор по EBNF → ParsedCommand | ParseError
```

#### EBNF (нормативная грамматика ввода)
Грамматика **язык-агностична по структуре**; лексические классы (`verb`, `preposition`, `article`,
`direction`) наполняются из таблицы лексикона ниже для нужного языка. Терминалы — токены после
нормализации.

```ebnf
(* === Команда === *)
command        = [ channel-prefix ] , verb-phrase , { argument } , [ comment ] ;

(* Префикс канала: говорить/шептать/кричать без явного глагола.
   Пример: "'привет всем"  ≡  "сказать привет всем" *)
channel-prefix = "'" | '"' | ":" ;          (* ' = say, " = shout, : = emote *)

verb-phrase    = verb , [ particle ] ;       (* particle: рус. возвратное/частицы, англ. phrasal "up"/"down" *)
verb           = ? любой синоним из лексикона, отображаемый в CanonicalVerb ? ;
particle       = ? частица из лексикона (опц.), уточняющая глагол ? ;

argument       = direction
               | quoted-text
               | prepositional
               | quantity
               | noun-phrase ;

prepositional  = preposition , noun-phrase ;  (* "на север", "in chest", "with key" *)
preposition    = ? предлог из лексикона ? ;

direction      = ? канонизируется в Direction (N|S|E|W|NE|NW|SE|SW|U|D|IN|OUT) ? ;

quantity       = integer , [ noun-phrase ] ;  (* "взять 3 травы" *)
integer        = digit , { digit } ;

quoted-text    = '"' , { ? любой символ кроме '"' ? } , '"' ;  (* свободный текст послания/чата *)

noun-phrase    = { article } , noun , { adjective | noun } ;
noun           = word ;
adjective      = word ;
article        = ? артикль/местоимение из стоп-листа, ОТБРАСЫВАЕТСЯ при канонизации ? ;
word           = letter , { letter | digit | "-" | "'" } ;

comment        = "#" , { ? любой символ до конца строки ? } ;  (* игнорируется парсером *)
```

Замечания к грамматике (нормативные):
- **Глагол обязателен**, кроме случая `channel-prefix` (тогда подразумевается `say/shout/emote`).
- **Порядок аргументов свободен** после глагола: `дать ключ стражнику` ≡ `дать стражнику ключ` —
  разрешение ролей (кому/что) — задача слоя 3 по `targets` (парсер лишь раскладывает по группам:
  прямые `nouns`, предложные `prepObjects` с предлогом). Парсер **не** делает семантическую валидацию
  «существует ли стражник» — это слой мира.
- **Цитаты приоритетны:** всё между `"` … `"` — единый `freeText`-аргумент (для посланий-эхо/чата),
  не токенизируется на слова.
- **Числа:** ведущий integer перед существительным даёт `quantity`.
- **Регистр и диакритика** не значимы (нормализованы); `ё`≡`е` нормализуется в лексиконе как алиас.

#### Канонические глаголы (минимальный нормативный набор) и лексикон
`CanonicalVerb` — язык-нейтральный строковый id. Таблица — **минимальный обязательный** набор для
приёмки; реестр расширяем (см. `VerbRegistry` ниже). «Намерение» — тип записи-намерения, которую
**слой 3** запишет в субстрат по результату ([NX-SPEC-006] `WriteInput.type`); парсер сам **не пишет**.

| CanonicalVerb | RU-синонимы (примеры) | EN-синонимы (примеры) | Арность | Намерение (слой 3 → Substrate.type) |
|---|---|---|---|---|
| `look` | смотреть, осмотреть, оглядеться, см | look, l, examine, x | 0–1 | (чтение, без записи) |
| `read` | читать, прочесть, читать руну | read, peruse | 1 | (чтение, без записи) |
| `go` | идти, иди, на, дви́гаться | go, move, walk | 1 (direction) | `intent.move` |
| `take` | взять, поднять, подобрать | take, get, pick | 1–2 | `intent.take` |
| `drop` | бросить, положить, оставить-предмет | drop, put | 1–2 | `intent.drop` |
| `say` | сказать, говорить, ' (префикс) | say, ' (prefix) | 1 (freeText) | `chat.say` |
| `shout` | кричать, " (префикс) | shout, yell, " (prefix) | 1 (freeText) | `chat.shout` |
| `emote` | действие, : (префикс) | emote, me, : (prefix) | 1 (freeText) | `chat.emote` |
| `leave-message` | оставить, оставить-весть, начертать | leave, inscribe, post | 1–2 (freeText, [tgt]) | `echo.message` |
| `give` | дать, передать, вручить | give, hand | 2 | `intent.give` |
| `use` | использовать, применить, активировать | use, apply, activate | 1–2 | `intent.use` |
| `inventory` | инвентарь, вещи, и | inventory, inv, i | 0 | (чтение, без записи) |
| `help` | помощь, справка, ? | help, ?, commands | 0–1 | (служебная) |

Лексические классы (наполнение для парсера; примеры, реестр расширяем):
```ts
// Предлоги (отбрасываются как токен-маркеры роли, но запоминают связку preposition→object)
RU_PREPOSITIONS = ["на","в","во","с","со","к","ко","из","от","у","за","под","над","для"];
EN_PREPOSITIONS = ["on","in","into","with","to","from","at","under","over","for","of"];

// Артикли/стоп-слова (ОТБРАСЫВАЮТСЯ при канонизации noun-phrase)
RU_STOPWORDS    = ["это","этот","эта","эти","тот","та","все","всем"]; // "'привет всем" → freeText "привет всем" сохраняется как есть
EN_STOPWORDS    = ["the","a","an","this","that","these","those","all"];

// Направления → Direction
RU_DIRECTIONS = { север:"N", юг:"S", восток:"E", запад:"W", "северо-восток":"NE", вверх:"U", вниз:"D", внутрь:"IN", наружу:"OUT" };
EN_DIRECTIONS = { north:"N", n:"N", south:"S", s:"S", east:"E", e:"E", west:"W", w:"W", up:"U", u:"U", down:"D", d:"D", in:"IN", out:"OUT" };
```

#### Форма результата разбора (`ParsedCommand`)
```ts
type CanonicalVerb = string;        // язык-нейтральный id: "look" | "go" | "leave-message" | ...
type Direction = "N"|"S"|"E"|"W"|"NE"|"NW"|"SE"|"SW"|"U"|"D"|"IN"|"OUT";

/** Один разобранный аргумент. */
interface Arg {
  kind: "noun" | "direction" | "quantity" | "freeText" | "prepObject";
  text: string;                     // нормализованный текст (для noun/freeText)
  lemma?: string;                   // канонизированная основа noun (стоп-слова отброшены), опц.
  direction?: Direction;            // если kind==="direction"
  count?: number;                   // если kind==="quantity"
  preposition?: string;             // канонический предлог, если kind==="prepObject" ("on"|"with"|...)
}

/** РЕЗУЛЬТАТ УСПЕШНОГО РАЗБОРА — чистые данные, без побочных эффектов. */
interface ParsedCommand {
  ok: true;
  verb: CanonicalVerb;              // канонический глагол (из лексикона)
  raw: string;                      // исходная строка (для лога/отладки)
  channel?: "say"|"shout"|"emote";  // если был channel-prefix
  args: Arg[];                      // аргументы в порядке появления
  nouns: Arg[];                     // подмножество args c kind в {noun,quantity} (прямые объекты)
  prepObjects: Arg[];               // подмножество args c kind==="prepObject" (косвенные)
  freeText?: string;               // склеенный текст послания/чата (для say/leave-message)
  locale: string;                   // локаль ввода ("ru"|"en"|...), на которой распознан глагол
}

/** РЕЗУЛЬТАТ НЕУДАЧИ — НИКОГДА не бросает исключение на пользовательский ввод (инвариант I-2). */
interface ParseError {
  ok: false;
  code: ParseErrorCode;             // см. таблицу кодов
  raw: string;
  hint?: string;                    // человекочитаемая подсказка (локализованная), напр. "Не знаю глагол «фываы»"
  near?: string;                    // токен, на котором споткнулись
}

type ParseResult = ParsedCommand | ParseError;
```

#### Сигнатура парсера (нормативная)
```ts
interface ParserOptions {
  locale?: string;                  // предпочитаемая локаль; по умолч. автоопределение по глаголу
  locales?: string[];               // какие лексиконы пробовать (по умолч. ["ru","en"])
  registry?: VerbRegistry;          // расширяемый реестр глаголов/синонимов (по умолч. встроенный)
}

/** Чистая функция: строка → результат. Детерминирована, без побочных эффектов, НЕ бросает на вводе. */
function parseCommand(input: string, opts?: ParserOptions): ParseResult;

/** Реестр канонических глаголов — точка расширения лексикона (модами/локалями). */
interface VerbRegistry {
  /** Зарегистрировать глагол с синонимами по локалям. */
  define(verb: CanonicalVerb, synonyms: Record<string /*locale*/, string[]>, arity?: [min:number,max:number]): void;
  /** Канонизировать токен-глагол → CanonicalVerb|null, с локалью, на которой совпало. */
  resolve(token: string, locales: string[]): { verb: CanonicalVerb; locale: string } | null;
  /** Список известных глаголов (для help). */
  list(): CanonicalVerb[];
}
```

#### Коды ошибок парсера
| Код (`ParseErrorCode`) | Когда | `hint` (пример) |
|---|---|---|
| `E_EMPTY` | пустая строка/только пробелы/только комментарий | «Пустая команда» |
| `E_UNKNOWN_VERB` | первый токен не канонизируется ни в одной локали и нет channel-prefix | «Не знаю глагол «X»» |
| `E_MISSING_ARG` | глагол требует аргумент (arity.min>0), а его нет (напр. `read` без объекта) | «Что читать?» |
| `E_BAD_DIRECTION` | `go` получил не-направление | «Куда идти? (север/юг/…)» |
| `E_UNTERMINATED_QUOTE` | открыта `"`, не закрыта | «Незакрытая кавычка» |
| `E_TOO_MANY_ARGS` | аргументов больше arity.max | «Слишком много слов для «X»» |

### Часть 2. Контракт `ITextRenderer` (текстовая реализация `IRenderer`)

`ITextRenderer` **расширяет** порт `IRenderer` из [NX-SYS-004]: те же методы жизненного цикла и приёма
снимка, но семантика «вывода» — **поток строк**, и добавлен **канал ввода** (которого нет у графических
бэкендов). Это удерживает инвариант [NX-SYS-004] «симуляция не знает, чем её рисуют»: `buildSnapshot`
([NX-SYS-004]) и субстрат ([NX-SPEC-006]) одинаковы для всех окон.

#### Базовый порт (напоминание из [NX-SYS-004], нормативно наследуется)
```ts
interface IRenderer {
  init(canvasEl: Element, opts?: object): void;
  resize(w: number, h: number, dpr: number): void;
  beginFrame(camera: Camera): void;
  sync(snapshot: Snapshot): void;
  present(alpha: number): void;
  worldToScreen(p: Vec3): { sx: number; sy: number };
  screenToWorld(sx: number, sy: number): Vec3;
  dispose(): void;
}
```

#### Расширение для текста (нормативные сигнатуры)
```ts
/** Куда уходят строки. Подменяемый сток — точка подмены legacy (DOM | console | PHP-HTML | socket). */
interface TextSink {
  write(line: TextLine): void;       // вывести одну логическую строку
  clear(): void;                     // очистить видимый лог (не журнал субстрата!)
  readonly name: string;             // "dom" | "console" | "php-html" | "socket"
}

/** Логическая строка вывода: текст + семантические теги (адаптер стока решает, как показать). */
interface TextLine {
  text: string;                      // готовая строка (результат recordToText или системное сообщение)
  channel: "world"|"chat"|"echo"|"system"|"error"|"papyrus"; // канал → стиль/цвет/группировка
  recordId?: string;                 // ссылка на исходный SubstrateRecord (если строка из записи)
  ts?: number;                       // время (для таймстампа в логе)
  meta?: Record<string, unknown>;    // напр. {author, zone, dim:"papyrus"} — для DOM-стилей/фильтра
}

interface TextRendererOptions {
  sink?: TextSink;                   // по умолчанию DOM-сток (или ConsoleSink в Node)
  locale?: string;                   // локаль вывода (для recordToText), по умолч. "ru"
  registry?: TextTemplateRegistry;   // реестр шаблонов записей→текст
  timestamps?: boolean;              // показывать ли время строки
  echoVerbosity?: "full"|"compact";  // как подробно рисовать эхо ([NX-INN-003])
}

/** ТЕКСТОВЫЙ РЕНДЕР = адаптер порта IRenderer + ввод-строка. */
interface ITextRenderer extends IRenderer {
  // — из IRenderer (семантика переопределена для текста) —
  // init(el, opts): подключить TextSink к el (или к консоли/сокету)
  // sync(snapshot): диффит снимок; новые/изменённые renderable → строки "world"/"system"
  // present(alpha): СБРОСИТЬ накопленные строки кадра в sink (alpha игнорируется — текст не интерполирует)
  // beginFrame(camera): запомнить «область видимости» (zone камеры) для фильтра записей
  // worldToScreen(p): { sx: lineIndex, sy: 0 } — вырожденная адресация (см. инвариант I-9)
  // screenToWorld(sx, sy): обратное вырождение; для текста обычно неинформативно
  // resize(w,h,dpr): w→ширина переноса строк (wrap), h→высота окна лога; dpr игнорируется
  // dispose(): отключить sink, снять подписки

  // — ДОБАВЛЕНО текстовым бэкендом —

  /** Напечатать запись субстрата как текст (через recordToText + sink.write). Идемпотентно по record.id. */
  emitRecord(record: SubstrateRecord): void;

  /** Напечатать произвольную системную/служебную строку (ответ парсера, подсказка help). */
  print(line: TextLine | string, channel?: TextLine["channel"]): void;

  /** Прочитать одну строку ввода (Promise) — для пошагового REPL/MUD-цикла. */
  readLine(prompt?: string): Promise<string>;

  /** Подписка на ввод (push-режим): каждая введённая строка → handler. Возвращает отписку. */
  onInput(handler: (line: string) => void): () => void;
}
```

#### Как `ITextRenderer` соединён с парсером и субстратом (поток данных)
Нормативная схема (соответствует псевдокоду [NX-INN-014], но с явными границами слоёв — рендер **не
пишет** в субстрат):
```
ВЫВОД (записи → строки):
  Substrate.subscribe(rec → textRenderer.emitRecord(rec))     // [NX-SPEC-006].subscribe
     или  sync(snapshot): renderable → строка                 // [NX-SYS-004] путь снимка
  emitRecord(rec): line = recordToText(rec, ctx); sink.write(line)

ВВОД (строка → намерение, запись делает слой 3):
  textRenderer.onInput(line => {
    pc = parseCommand(line, {locales:["ru","en"]})             // ЧИСТЫЙ парсер (Часть 1)
    if (!pc.ok) { textRenderer.print(pc.hint, "error"); return }
    bus.emit("input:command", pc)                              // НАВЕРХ, слою 3 (НЕ в субстрат напрямую)
  })
  // Слой 3 (игровая логика) сам решает и пишет:
  //   Substrate.write({ type: intentTypeFor(pc.verb), payload: toPayload(pc), place, sig })  [NX-SPEC-006]
```
Инвариант границы (нормативный, I-7): **`ITextRenderer` никогда не вызывает `Substrate.write`**. Он
читает (через `subscribe`/снимок) и парсит ввод в `ParsedCommand`, но **намерение записывает слой 3**.
Это сохраняет однонаправленность слоёв из [NX-SPEC-006] (рендер — окно, не источник истины) и
повторяет дисциплину [NX-SYS-004] «стрелка только вниз».

### Часть 3. Маппинг записей → текст (`recordToText`)

#### Контекст и сигнатура
```ts
interface RenderCtx {
  locale: string;                    // "ru" | "en" | ...
  echoVerbosity: "full"|"compact";
  now: number;                       // для относительного времени ("3 ч. назад")
  viewerId?: string;                 // чей взгляд (для «вы»/«он» и фильтра приватного)
  zone?: string;                     // активная зона (для маркера «здесь»/«поодаль»)
}

/** ЧИСТАЯ детерминированная функция: запись → строка. Без побочных эффектов. */
function recordToText(record: SubstrateRecord, ctx: RenderCtx, reg?: TextTemplateRegistry): TextLine;

/** Реестр шаблонов по типу записи — точка расширения (моды/новые типы записей). */
interface TextTemplateRegistry {
  /** Зарегистрировать шаблон для type (точный) или префикса type (через trailing '.'). */
  register(typeOrPrefix: string, tpl: TextTemplate): void;
  /** Найти лучший шаблон: точный type → префикс → дефолтный фолбэк. */
  resolve(type: string): TextTemplate;
}

/** Шаблон: как из payload+place сделать строку и канал. Чистая функция. */
type TextTemplate = (record: SubstrateRecord, ctx: RenderCtx) => TextLine;
```

#### Нормативная таблица маппинга `type → текст`
Маппинг **детерминирован** (одна запись + один `ctx` ⇒ одна и та же строка, инвариант I-3). `type`
записей — из пространства имён [NX-SPEC-006]/[NX-VIS-004] (`echo.*`, `world.*`, `myth.*`, `chat.*`).

| `record.type` | Канал `TextLine.channel` | Шаблон (RU) | Источник payload |
|---|---|---|---|
| `echo.message` | `echo` | «Эхо {author}: „{payload.text}"» (compact: «Эхо: „{text}"») | [NX-INN-003], [NX-SPEC-003] |
| `echo.ghost` | `echo` | «Тень {author} проходит {dir(payload.heading)}.» | [NX-INN-003] |
| `echo.build` | `echo` | «Здесь оставлена постройка: {payload.kind}.» | [NX-INN-003] |
| `chat.say` | `chat` | «{author} говорит: „{payload.text}"» | этот док (Часть 1) |
| `chat.shout` | `chat` | «{author} кричит: „{payload.text}"!» | этот док |
| `chat.emote` | `chat` | «* {author} {payload.text}» | этот док |
| `world.need` | `world` | «{author} испытывает нужду: {payload.need}.» | [NX-INN-002], [NX-SPEC-004] |
| `world.event` | `world` | «{payload.summary}.» | [NX-INN-002] |
| `myth.symbol` | `papyrus` | «Складывается символ: {payload.name} — {payload.gloss}.» | [NX-INN-006] |
| `papyrus.*` | `papyrus` | «{payload.title}\n{payload.body}» (многострочный документ) | [NX-INN-014] |
| (любой иной) | `system` | фолбэк: «[{type}] {compactJson(payload)}» (DEBUG) / «(непонятная запись)» (prod) | — |

Правила (нормативные):
- **`author`** резолвится из `record.sig.authorId` через словарь имён ctx (или показывается id, если имя
  неизвестно). Если `viewerId === authorId` → «вы» вместо имени (локализуемо).
- **`{dir(...)}`** — локализованное направление из `Direction` (обратная таблица к лексикону Части 1).
- **Место.** Если `record.place === null` ([NX-SPEC-006] допускает) — строка печатается **без**
  пространственного маркера; если `place.zone !== ctx.zone` → суффикс «(поодаль)». Это исполняет
  [NX-SPEC-006] I-5 (место рендер-независимо: текст не знает пикселей, только зону/мировые коорд.).
- **Экранирование.** `payload.text` пользователя экранируется по стоку: DOM-сток — HTML-escape; console
  — без изменений; это ответственность `TextSink`, не `recordToText` (она возвращает чистый текст +
  канал; сток решает рендер). Так анти-XSS не «течёт» в чистую функцию маппинга.
- **Многострочность.** Папирусы (`papyrus.*`) возвращают `text` с `\n`; `TextSink` отвечает за разбиение
  на видимые строки/перенос по ширине `resize(w,…)`.

### Инварианты (нормативные, проверяемы в DEBUG)
- **I-1 (канонизация глагола).** Любой синоним из лексикона локали L отображается ровно в один
  `CanonicalVerb`; результат `parseCommand` для `look` и для рус. `осмотреть` имеет `verb==="look"`.
- **I-2 (парсер не бросает на ввод).** `parseCommand` для **любой** строки возвращает `ParseResult`
  (`ok:true|false`), **никогда** не выбрасывает исключение. Мусорный ввод ⇒ `ParseError`, не throw.
- **I-3 (детерминизм маппинга).** `recordToText(r, ctx)` для фиксированных `r` и `ctx` всегда даёт
  идентичный `TextLine` (чистая функция; одинаковая запись в журнале → одинаковый текст у всех окон).
- **I-4 (агностичность места при выводе).** Текст использует только `record.place.zone`/мировые
  координаты, **никогда** не пиксели/тайлы рендера ([NX-SYS-004], [NX-SPEC-006] I-5).
- **I-5 (язык — линза).** Канонический `verb`/`Direction`/`type` язык-нейтральны; смена `locale` меняет
  лексикон ввода и шаблоны вывода, но **не** меняет каноническую логику и не трогает субстрат.
- **I-6 (деградация токенизатора).** При отсутствии `Intl.Segmenter` парсер даёт **те же**
  `ParsedCommand` на тестовом наборе (regex-фолбэк эквивалентен на поддерживаемых языках).
- **I-7 (рендер не пишет в субстрат).** `ITextRenderer` не вызывает `Substrate.write`; он лишь читает
  записи и эмитит `input:command`/`ParsedCommand` наверх. Запись намерения — слой 3.
- **I-8 (идемпотентность вывода записи).** `emitRecord(r)` дважды с одним `r.id` печатает строку **один
  раз** (дедуп по `recordId`), что согласовано с идемпотентностью субстрата ([NX-SPEC-006] I-3).
- **I-9 (вырождение проекции).** `worldToScreen`/`screenToWorld` у текста определены, но **вырождены**
  (строка/курсор, не пиксель); вызывающий код [NX-SYS-004], опирающийся на пиксельную проекцию, в
  текстовом окне обязан учитывать «нет пикселя» (метки позиционируются по зоне/строке).
- **I-10 (legacy-неблокирование).** Без PHP/сокет-стока текстовый режим полностью функционален локально
  (DOM/console sink + локальный субстрат [NX-SPEC-006] I-8). Серверный сток — опциональное расширение.

### Граничные случаи
- **Пустой/комментарий-only ввод** (`"   "`, `"# заметка"`) → `ParseError{code:E_EMPTY}`; рендер
  печатает подсказку в канал `error`, наверх ничего не эмитит.
- **Смешанные языки в одной строке** (`"go север"`): глагол распознан как EN `go`, направление — из
  RU-лексикона. Парсер пробует `locales` по порядку **по-токенно**; `locale` команды = локаль глагола.
  Допустимо (I-5), полезно для двуязычных игроков.
- **Неизвестное направление** (`go nowhere`) → `ParseError{code:E_BAD_DIRECTION}`.
- **Запись неизвестного `type`** → шаблон-фолбэк (`system`-канал), строка **не теряется** (параллель
  [NX-SPEC-006] I-6 «непрозрачность payload»): текст показывает факт существования записи, не падает.
- **`place:null`** ([NX-SPEC-006]) → текст без пространственного маркера (чисто текстовый факт/миф-символ).
- **Очень длинный папирус** → `TextSink` переносит/пагинирует по `resize(w,h)`; `recordToText` не
  занимается версткой (разделение ответственности).
- **Незакрытая кавычка** (`скажи "привет`) → `ParseError{code:E_UNTERMINATED_QUOTE}` с `hint`.

### Связь со смежными контрактами
- **[NX-SYS-004] (порт `IRenderer`).** `ITextRenderer` — четвёртый адаптер за тем же портом; `sync`
  принимает тот же `Snapshot`/`Renderable`, что Canvas2D/Iso/Three. Текстовый бэкенд — прямое
  подтверждение тезиса [NX-SYS-004] «стоимость нового бэкенда — один адаптер»: текст добавлен без
  изменения симуляции.
- **[NX-SPEC-006] (субстрат).** Источник записей для вывода — `Substrate.query`/`subscribe`; форма
  `SubstrateRecord` (`type/place/payload/sig`) — вход `recordToText`. Намерения парсера записываются
  слоем 3 через `Substrate.write` (рендер — нет, I-7).
- **[NX-SPEC-007] (EventBus).** Ввод эмитится как событие `input:command` (с `ParsedCommand`); вывод
  может слушать `record:written` ([NX-SPEC-006]) для push-печати новых записей.
- **[NX-SPEC-003] (эхо).** `echo.*` записи — частный, нативно текстовый случай маппинга (послание-эхо =
  `echo.message`), как и предсказано [NX-INN-014]. Серверный сток/адаптер — опционален (I-10).

## Предложения и варианты реализации

Псевдокод — заготовка для роя. **ES-модули**: `parser.js` (Часть 1), `textRenderer.js` (Часть 2),
`recordToText.js` (Часть 3). Legacy v1/v2 получают тонкий UMD-шим поверх тех же модулей (адаптер
совместимости, не ядро — параллель [NX-SPEC-006]).

```pseudo
// ── parser.js (чистый, без зависимостей) ──
export function parseCommand(input, opts = {}) {
  const reg = opts.registry ?? DEFAULT_REGISTRY
  const locales = opts.locales ?? ["ru","en"]
  const norm = normalize(input)                 // trim, NFC, схлопывание пробелов, lower по локали
  if (!norm || isCommentOnly(norm)) return { ok:false, code:"E_EMPTY", raw:input }
  const { channel, rest } = stripChannelPrefix(norm)   // ' " : → say/shout/emote
  const tokens = tokenize(rest)                 // Intl.Segmenter | regex-фолбэк (I-6)
  let verb, locale
  if (channel) { verb = channel; locale = guessLocale(tokens, locales) }
  else {
    const hit = reg.resolve(tokens[0], locales)
    if (!hit) return { ok:false, code:"E_UNKNOWN_VERB", raw:input, near:tokens[0], hint:hintUnknown(tokens[0], locale) }
    verb = hit.verb; locale = hit.locale; tokens.shift()
  }
  const args = classifyArgs(tokens, locale, channel)   // direction|quantity|prepObject|noun|freeText
  const checked = checkArity(verb, args, reg)           // E_MISSING_ARG / E_TOO_MANY_ARGS / E_BAD_DIRECTION
  if (!checked.ok) return checked
  return {
    ok:true, verb, raw:input, channel, locale, args,
    nouns: args.filter(a => a.kind==="noun" || a.kind==="quantity"),
    prepObjects: args.filter(a => a.kind==="prepObject"),
    freeText: joinFreeText(args, channel)
  }
}

// ── recordToText.js (чистый) ──
export function recordToText(record, ctx, reg = DEFAULT_TEMPLATES) {
  const tpl = reg.resolve(record.type)          // точный → префикс → фолбэк
  const line = tpl(record, ctx)                 // TextLine{ text, channel, recordId:record.id, ts:record.t }
  return line
}

// ── textRenderer.js (адаптер порта IRenderer + ввод) ──
export class TextRenderer /* implements ITextRenderer */ {
  constructor(opts = {}) { this.sink = opts.sink ?? new DomTextSink(); this.ctx = makeCtx(opts); this._seen = new Set() }
  init(el) { this.sink.attach?.(el) }
  resize(w,h) { this.sink.setWrap?.(w); this.sink.setViewport?.(h) }
  beginFrame(camera) { this.ctx.zone = camera?.zone }       // запомнить область видимости
  sync(snapshot) {                                            // путь снимка (NX-SYS-004)
    for (const r of snapshot) if (r.flags.justEntered || r.flags.dirty) this.print(renderableToLine(r, this.ctx))
  }
  present(_alpha) { this.sink.flush?.() }                     // текст не интерполирует (I-9 примечание)
  worldToScreen(p) { return { sx: this._lineIndexFor(p), sy: 0 } }  // вырождение (I-9)
  screenToWorld(_sx,_sy) { return { x:NaN, y:NaN, z:NaN } }         // неинформативно для текста
  dispose() { this.sink.detach?.(); this._unsub?.() }

  emitRecord(rec) {                                          // путь субстрата (NX-SPEC-006)
    if (this._seen.has(rec.id)) return                      // идемпотентность вывода (I-8)
    this._seen.add(rec.id)
    this.sink.write(recordToText(rec, this.ctx, this.templates))
  }
  print(line, channel="system") { this.sink.write(typeof line==="string" ? { text:line, channel } : line) }
  onInput(handler) { return this.sink.onLine(handler) }      // sink поставляет строки (DOM input / stdin / socket)
  readLine(prompt) { return this.sink.readLine(prompt) }
}

// ── СТОКИ: точка подмены legacy за интерфейсом TextSink ──
export class DomTextSink   { name="dom";   write(l){ /* escape+append <div class=channel> */ } onLine(h){/*input*/} }
export class ConsoleSink   { name="console"; write(l){ print(l.text) } readLine(p){ /* stdin */ } }   // Node/тест
// ОПЦИОНАЛЬНЫЕ legacy-адаптеры (по умолчанию выключены, I-10):
export function PhpHtmlSink({ postUrl }) { return { name:"php-html", write(l){ /* POST строки в nexus_api.php лог */ } } }
export function SocketSink({ socket })   { return { name:"socket", write(l){ socket.send(l.text+"\n") }, onLine(h){ socket.onmessage = e=>h(e.data) } } }
```

**Развилки реализации:**
- **A. Парсер: словарный (рекомендую для старта) vs грамматический генератор.** Старт — словарь
  синонимов + ручной EBNF-разбор (предсказуемо, отлаживаемо, без зависимостей). Позже при росте
  лексикона — табличный/PEG-генератор. Контракт `parseCommand`/`ParsedCommand` от этого не меняется.
- **B. Вывод: push (`subscribe`) vs pull (снимок `sync`).** Параллель развилкам [NX-SYS-004] A/B/C.
  Push (`Substrate.subscribe → emitRecord`) естественен для ленты чата/эхо; снимок (`sync`) — для
  «осмотреться» (срез зоны). Гибрид: статика зоны через `query`-снимок, динамика (чат/эхо) — push.
  Рекомендую гибрид (как [NX-SYS-004] C).
- **C. `freeText` vs структурный аргумент для `leave-message`.** Послание-эхо может быть свободным
  текстом (`"…"`) или структурой (адресат+тело). Контракт допускает оба: `freeText` + опц. `prepObject`
  («оставить весть стражнику»). Слой 3 решает тип записи (`echo.message`).
- **D. Кнопки + текст (interactive fiction) — вариант 2 из [NX-INN-014].** Гибрид: те же
  `CanonicalVerb`, но часть команд подаётся кликом (кнопка эмитит готовый `ParsedCommand`, минуя
  парсер). Контракт `ITextRenderer.onInput`/`bus.emit("input:command")` это поддерживает без изменений.
- **E. Текст как отладочный/авторский вид субстрата (вариант 3 из [NX-INN-014]).** Тот же
  `recordToText` используется как лог записей мира при разработке 2D/3D — переиспользование маппинга.

**Минимальные тест-кейсы (обязательные для приёмки):**

*Парсер (Часть 1):*
1. `parseCommand("смотреть")` → `{ok:true, verb:"look", args:[]}`; `parseCommand("look")` → тот же `verb` (I-1).
2. `parseCommand("идти на север")` → `verb:"go"`, `args` содержит `{kind:"direction", direction:"N"}`;
   `parseCommand("go north")` эквивалентен по `verb`/`direction` (I-1/I-5).
3. `parseCommand("дать ключ стражнику")` и `parseCommand("дать стражнику ключ")` дают одинаковые
   множества `nouns`/`prepObjects` (свободный порядок аргументов).
4. `parseCommand('скажи "привет всем"')` → `verb:"say"`, `freeText:"привет всем"`; то же для префикса
   `parseCommand("'привет всем")` → `channel:"say"`, `freeText:"привет всем"`.
5. `parseCommand("фываы")` → `{ok:false, code:"E_UNKNOWN_VERB"}` и **не бросает** (I-2).
6. `parseCommand("")` и `parseCommand("# коммент")` → `{ok:false, code:"E_EMPTY"}` (I-2).
7. `parseCommand("go nowhere")` → `{ok:false, code:"E_BAD_DIRECTION"}`; `parseCommand("идти")` →
   `E_MISSING_ARG`; `parseCommand('скажи "привет')` → `E_UNTERMINATED_QUOTE`.
8. **Деградация (I-6):** прогон кейсов 1–7 с отключённым `Intl.Segmenter` (regex-фолбэк) даёт
   идентичные `ParsedCommand`.

*Маппинг (Часть 3):*
9. `recordToText({type:"echo.message", sig:{authorId:"u1"}, payload:{text:"эй"}}, ctx)` →
   `channel:"echo"`, `text` содержит «эй» и имя/`u1`; `recordId === record.id`.
10. **Детерминизм (I-3):** два вызова `recordToText` с одинаковыми `r`/`ctx` дают идентичный `TextLine`.
11. **Фолбэк:** `recordToText({type:"unknown.kind", payload:{a:1}}, ctx)` → `channel:"system"`, строка не
    пуста (запись не теряется; параллель [NX-SPEC-006] I-6).
12. **Место (I-4):** запись с `place:null` рендерится без пространственного маркера; запись с
    `place.zone !== ctx.zone` получает суффикс «(поодаль)»; пиксели/тайлы в строке отсутствуют.
13. **Локаль (I-5):** одна и та же запись при `ctx.locale:"ru"` и `"en"` даёт текст на нужном языке,
    `channel` и `recordId` неизменны.

*Рендер/границы (Часть 2):*
14. **Идемпотентность вывода (I-8):** `emitRecord(r)` дважды с одним `r.id` → `sink.write` вызван один раз.
15. **Рендер не пишет в субстрат (I-7):** мок-`Substrate` фиксирует, что за весь цикл ввода/вывода
    `ITextRenderer` **не** вызвал `write`; ввод привёл к `bus.emit("input:command", pc)`.
16. **Сток-инвариантность (I-10):** один сценарий вывода на `ConsoleSink` и `DomTextSink` даёт
    идентичную последовательность `TextLine.text`/`channel` (сток меняет лишь рендер, не содержание);
    `PhpHtmlSink`/`SocketSink` подключаются опционально и не требуются для прохождения 1–15.

## Что нового и какие кирпичики

> Раздел не обязателен для `spec`, но кратко — откуда решения (по [NX-META-001] §7).

- **Проверенные кирпичики (c20-proven / гуманитарные дисциплины):** MUD/MUSH-парсер «глагол + объекты +
  предлоги» (1980-е; LPMud, TinyMUSH), interactive fiction (Inform/ZIL — каноникализация глаголов и
  стоп-слов), компиляторная связка «лексер → токены → грамматика → AST», ports-and-adapters (Cockburn,
  как и в [NX-SYS-004]/[NX-SPEC-006]) для подмены стока вывода, шаблонизация представления (View) с
  локалью (i18n/ICU `Intl`).
- **Что нового против обычных веб-игр:** текстовый бэкенд как **полноправный адаптер единого порта
  `IRenderer`** ([NX-SYS-004]) над **тем же субстратом записей** ([NX-SPEC-006]), что 2D/3D, плюс
  **язык-нейтральная каноникализация** (рус+англ ⇒ один `CanonicalVerb`), благодаря которой геймплей
  языконезависим. В типовой текстовой игре парсер жёстко сцеплен с миром и одним языком; здесь —
  чистая функция за контрактом, и текст «бесплатно» виден тем же, что графика.
- **Чего мало в вебе:** один мир, который можно **читать** (1D, этот док) и **видеть** (2D/3D,
  [NX-SYS-004]) через один порт и один журнал ([NX-VIS-004], [NX-STRAT-004]); двуязычный MUD-парсер,
  отображающий оба языка в общий канонический словарь намерений, записываемых в общий субстрат.

## Риски, открытые вопросы
- **Неоднозначность естественного ввода.** Свободный порядок и синонимы рождают двусмысленности
  («дай ему его» — кому/что?). Митигация: парсер раскладывает по группам (`nouns`/`prepObjects`), а
  разрешение ролей и уточняющий вопрос («Кому дать?») — слой 3; гибрид с кнопками (развилка D) снижает риск.
- **Объём лексикона и поддержка языков.** Рост синонимов/языков — нагрузка на реестр `VerbRegistry`.
  Митигация: лексикон — данные (таблицы), а не код; третий язык ([NX-INN-010]) добавляется без правки
  парсера (I-5).
- **Сегментация без `Intl.Segmenter`.** На старых движках regex-фолбэк может расходиться на сложной
  пунктуации/дефисах. Митигация: тест I-6 на эталонном наборе; ASCII-фолбэк как нижняя граница.
- **Безопасность текстового обмена и LLM-вывода** ([NX-INN-008], [NX-RND-004]). Экранирование — на
  `TextSink` (DOM-escape), модерация/факт-слой — вне рендера. Митигация: рендер не доверяет `payload`,
  сток экранирует; LLM-вывод проходит факт/разрешительный слой до записи ([NX-INN-014] деталь).
- **Согласование с эхо-протоколом** ([NX-SPEC-003]). Серверный сток/адаптер и анти-чит — опциональны
  (I-10); локальный текстовый режим самодостаточен. Распределённый порядок строк (несколько игроков) —
  по `seq` субстрата ([NX-SPEC-006] I-2), отдельная спека синка.

## Комментарии
Документ переводит контурный псевдокод [NX-INN-014] (`TextRenderer.render`/`input`) в **реализуемый
контракт** 1D-окна и явно фиксирует «современное-первым»: ES-модульные чистые `parseCommand`/
`recordToText` + `ITextRenderer` поверх порта [NX-SYS-004]; PHP-HTML-сток и MUD-сокет — **опциональные
адаптеры за интерфейсом `TextSink`/`ITextRenderer`**, не блокирующие ядро (I-10). Структурно параллелен
[NX-SPEC-006] (тот же стиль «контракт + инварианты + коды ошибок + тест-кейсы», та же дисциплина «легаси
за адаптером»). Зрелость — `analyzed` (реального кода текстового слоя в `shared/*` нет; ближайший
прецедент — текст-чат/лог в существующих v1/v2/v3, но без единого парсера и без порта `IRenderer`).
Возражения и развилки — в `90-comments/`.

## Связанные документы
- [NX-INN-014 Текстовый/MUD-слой](../20-innovation/NX-INN-014-text-mud-layer.md) — родительский концепт (depends_on); контурный псевдокод `TextRenderer.render/input`
- [NX-SYS-004 Рендер-абстракция / IRenderer](../30-systems/NX-SYS-004-render-abstraction.md) — порт, который реализует `ITextRenderer` (depends_on); `Snapshot`/`Renderable`/`Camera`
- [NX-SPEC-006 Койне-субстрат — API записей](./NX-SPEC-006-koine-substrate-api.md) — форма `SubstrateRecord`, вход `recordToText`; запись намерений слоем 3 (depends_on)
- [NX-SPEC-007 EventBus 2.0](./NX-SPEC-007-eventbus2-api.md) — события `input:command`/`record:written`
- [NX-SPEC-003 Эхо-протокол](./NX-SPEC-003-echo-protocol.md) — `echo.*` как нативно текстовый случай маппинга; опциональный серверный сток
- [NX-VIS-004 Мета-слой Койне](../10-vision/NX-VIS-004-meta-layer-koine.md) — «текст первичен», субстрат как общий язык
- [NX-STRAT-004 Многомерная стратегия](../15-strategy/NX-STRAT-004-dimensional-strategy.md) — 1D-текст первоклассный; принцип «современное-первым»
- [Конституция вики](../00-meta/CONSTITUTION.md) · [Шаблон](../00-meta/TEMPLATE.md)
