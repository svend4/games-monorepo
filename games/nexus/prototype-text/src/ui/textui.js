// ui/textui.js — Текстовый рендер + MUD-парсер команд (точка взаимодействия).
//
// Это единственный слой, который знает про DOM. Он не держит игровую логику:
// топология мира приходит из world/zone (getRoom, state, player), прогрессия —
// из systems/knowledge, следы игроков — из systems/echo, журнал — из core/substrate.
// Реактивность — через шину: на каждую новую запись субстрата UI оживает строкой.
//
// Парсер — двуязычный (рус+англ), глаголо-ориентированный, как в классических MUD:
//   осмотреться / смотреть / look          — описать комнату
//   идти <напр> / go <dir>                 — перейти по выходу
//   читать <руна> / read <rune>            — дешифровать руну (нужен факт)
//   изучить <факт> / learn <fact>          — узнать факт (тестовый ввод прогрессии)
//   оставить <текст> / echo <text>         — оставить эхо в текущей комнате
//   вести / echoes                         — найти эхо здесь
//   знания / known                         — перечислить известные факты
//   помощь / help                          — справка
//
// Привязка: NX-VIS-004 (мета-слой «Койне»), столпы ЭХО + ЗНАНИЕ; NX-INN-003/004.

import { bus } from '../core/eventbus.js';
import { state, getRoom, player } from '../world/zone.js';
import { knowledge } from '../systems/knowledge.js';
import { echo } from '../systems/echo.js';
import { substrate } from '../core/substrate.js';

// --- DOM-ссылки (находятся в start()) ---------------------------------------
let logEl = null;
let inputEl = null;

// Чтобы не подписаться на шину дважды при повторном start().
let wired = false;

// --- Локализация направлений -------------------------------------------------
// Ключи выходов в zone.js — русские (север/юг/восток/запад/вниз/вверх).
// Принимаем и англ. синонимы, и однобуквенные сокращения, маппя их на ключ.
const DIR_ALIASES = {
  север: 'север', с: 'север', north: 'север', n: 'север',
  юг: 'юг', ю: 'юг', south: 'юг', s: 'юг',
  восток: 'восток', в: 'восток', east: 'восток', e: 'восток',
  запад: 'запад', з: 'запад', west: 'запад', w: 'запад',
  вверх: 'вверх', up: 'вверх', u: 'вверх', наверх: 'вверх',
  вниз: 'вниз', down: 'вниз', d: 'вниз',
};

// Человекочитаемые подписи направлений для строки выходов.
const DIR_LABEL = {
  север: 'север', юг: 'юг', восток: 'восток',
  запад: 'запад', вверх: 'вверх', вниз: 'вниз',
};

// --- Синонимы глаголов → канонические команды --------------------------------
const VERB_ALIASES = {
  осмотреться: 'look', осмотр: 'look', смотреть: 'look', оглядеться: 'look',
  смотрю: 'look', л: 'look', look: 'look', l: 'look', examine: 'look',
  идти: 'go', иди: 'go', пойти: 'go', go: 'go', move: 'go', walk: 'go',
  читать: 'read', прочесть: 'read', прочитать: 'read', read: 'read',
  изучить: 'learn', изучаю: 'learn', узнать: 'learn', learn: 'learn',
  оставить: 'echo', оставь: 'echo', эхо: 'echo', echo: 'echo', leave: 'echo',
  вести: 'echoes', эха: 'echoes', echoes: 'echoes', listen: 'echoes',
  знания: 'known', знание: 'known', факты: 'known', known: 'known', facts: 'known',
  помощь: 'help', справка: 'help', help: 'help', '?': 'help',
};

// Если первое слово — направление, считаем это сокращением для «идти <напр>».
function isBareDirection(word) {
  return Object.prototype.hasOwnProperty.call(DIR_ALIASES, word);
}

// --- Утилиты вывода ----------------------------------------------------------

/** Экранирование, чтобы пользовательский ввод/эхо не ломали разметку лога. */
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// --- Публичный объект UI -----------------------------------------------------
export const textui = {
  /**
   * Напечатать строку в лог. Класс задаёт тон строки (room/echo/sys/err/...).
   * Безопасно к вызову до start(): просто промолчит, если #log ещё не найден.
   * @param {string} str — текст (будет экранирован).
   * @param {string} [cls] — css-класс строки.
   */
  print(str, cls) {
    if (!logEl) return;
    const line = document.createElement('div');
    line.className = 'line' + (cls ? ' ' + cls : '');
    // \n внутри строки превращаем в переносы, остальное экранируем.
    line.innerHTML = escapeHtml(str).replace(/\n/g, '<br>');
    logEl.appendChild(line);
    // Автоскролл к последней строке.
    logEl.scrollTop = logEl.scrollHeight;
  },

  /**
   * Привязка к DOM и запуск ввода. Находит #log и #input, вешает Enter→handle,
   * подписывается на шину субстрата. Идемпотентно (повторный вызов не дублирует).
   */
  start() {
    logEl = document.getElementById('log');
    inputEl = document.getElementById('input');

    if (inputEl) {
      inputEl.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        const line = inputEl.value;
        inputEl.value = '';
        textui.handle(line);
      });
      inputEl.focus();
    }

    // Реактивность: всякая новая запись субстрата отзывается в логе.
    // Подписка один раз, итерация в шине идёт по копии — безопасно.
    if (!wired) {
      bus.on('record:written', onRecord);
      wired = true;
    }
  },

  /**
   * Обработать одну строку ввода игрока: распарсить и выполнить команду.
   * @param {string} line — сырой ввод.
   */
  handle(line) {
    const raw = String(line ?? '').trim();
    if (!raw) return;

    // Эхо ввода в лог — чтобы был виден диалог «команда → ответ».
    textui.print('> ' + raw, 'echo-input');

    // Разбор: первое слово — глагол (или голое направление), остальное — аргумент.
    const firstSpace = raw.indexOf(' ');
    const head = (firstSpace === -1 ? raw : raw.slice(0, firstSpace)).toLowerCase();
    const arg = firstSpace === -1 ? '' : raw.slice(firstSpace + 1).trim();

    // Голое направление = «идти <напр>».
    if (isBareDirection(head)) {
      cmdGo(head);
      return;
    }

    const verb = VERB_ALIASES[head];
    switch (verb) {
      case 'look': cmdLook(); break;
      case 'go': cmdGo(arg); break;
      case 'read': cmdRead(arg); break;
      case 'learn': cmdLearn(arg); break;
      case 'echo': cmdEcho(arg); break;
      case 'echoes': cmdEchoes(); break;
      case 'known': cmdKnown(); break;
      case 'help': cmdHelp(); break;
      default:
        textui.print(
          'Койне не понимает этого слова. Наберите «помощь», чтобы увидеть глаголы.',
          'err',
        );
    }
  },
};

// --- Команды -----------------------------------------------------------------

/** Описать текущую комнату: имя, описание, выходы, видимые руны, счётчик эха. */
function cmdLook() {
  renderRoom();
}

/** Перейти по выходу. Принимает направление в любом синониме. */
function cmdGo(dirInput) {
  const room = getRoom(state.room);
  if (!room) {
    textui.print('Вокруг лишь пустота — комната потеряна.', 'err');
    return;
  }
  const word = String(dirInput ?? '').trim().toLowerCase();
  if (!word) {
    textui.print('Идти куда? Укажите направление (например, «идти север»).', 'err');
    return;
  }
  const dir = DIR_ALIASES[word];
  const exits = room.exits || {};
  if (!dir || !(dir in exits)) {
    textui.print('Туда пути нет.', 'err');
    return;
  }
  state.room = exits[dir];
  textui.print(`Вы идёте на ${DIR_LABEL[dir] || dir}.`, 'sys');
  renderRoom();
}

/** Прочесть руну: дешифровка через знание. Руну ищем среди рун комнаты. */
function cmdRead(arg) {
  const room = getRoom(state.room);
  const runeIds = (room && room.runes) || [];
  if (runeIds.length === 0) {
    textui.print('Здесь нет рун, которые можно прочесть.', 'err');
    return;
  }

  // Выбор руны: без аргумента читаем единственную; иначе матчим по id/части.
  let runeId = null;
  const q = String(arg ?? '').trim().toLowerCase();
  if (!q) {
    if (runeIds.length === 1) {
      runeId = runeIds[0];
    } else {
      textui.print(
        'Здесь несколько рун. Уточните, какую читать: ' + runeIds.join(', '),
        'err',
      );
      return;
    }
  } else {
    runeId = runeIds.find((id) => String(id).toLowerCase() === q)
      || runeIds.find((id) => String(id).toLowerCase().includes(q))
      || null;
  }

  if (!runeId) {
    textui.print('Такой руны здесь нет.', 'err');
    return;
  }

  const { ok, text } = knowledge.decode(runeId);
  textui.print(text, ok ? 'rune' : 'rune-locked');
}

/**
 * Изучить факт — служебный ввод прогрессии (по контракту, «для теста»).
 * В живой игре факты узнаются из описаний; здесь даём прямой глагол, чтобы
 * проверить связку знание→дешифровка руны.
 */
function cmdLearn(arg) {
  const factId = String(arg ?? '').trim();
  if (!factId) {
    textui.print('Изучить что? Укажите факт (например, «изучить arch-key»).', 'err');
    return;
  }
  const fresh = knowledge.learn(factId);
  if (fresh) {
    textui.print(`Вы постигаете: ${factId}. Знание осело в Койне.`, 'sys');
  } else {
    textui.print(`Это уже вам ведомо: ${factId}.`, 'sys');
  }
}

/** Оставить эхо в текущей комнате. */
function cmdEcho(arg) {
  const text = String(arg ?? '').trim();
  if (!text) {
    textui.print('Оставить какое эхо? Напишите послание после глагола.', 'err');
    return;
  }
  try {
    echo.leave(text);
    // Сама запись отрисуется реактивно через onRecord; здесь — подтверждение.
    textui.print('Ваше слово оседает в камне этого места.', 'sys');
  } catch (err) {
    textui.print('Пустое эхо оставить нельзя.', 'err');
  }
}

/** Найти эхо в текущей комнате (по умолчанию echo.find без аргумента). */
function cmdEchoes() {
  const recs = echo.find();
  if (!recs.length) {
    textui.print('Здесь тихо. Ни одного отголоска.', 'sys');
    return;
  }
  textui.print(`Отголоски этого места (${recs.length}):`, 'sys');
  for (const rec of recs) {
    const author = rec?.author === player.id ? 'вы' : (rec?.author ?? 'некто');
    const text = rec?.payload?.text ?? '';
    textui.print(`  «${text}» — ${author}`, 'echo');
  }
}

/** Перечислить известные факты (knowledge.known). */
function cmdKnown() {
  const facts = knowledge.known();
  if (!facts.length) {
    textui.print('Пока вы не знаете ничего, что открыло бы руны.', 'sys');
    return;
  }
  textui.print('Вам ведомо:', 'sys');
  for (const f of facts) {
    textui.print('  • ' + f, 'fact');
  }
}

/** Справка по глаголам. */
function cmdHelp() {
  textui.print(
    [
      'Глаголы Койне (рус / англ):',
      '  осмотреться · look            — осмотреть комнату',
      '  идти <напр> · go <dir>        — север/юг/восток/запад/вверх/вниз',
      '  читать <руна> · read <rune>   — дешифровать руну (нужен факт)',
      '  изучить <факт> · learn <fact> — узнать факт',
      '  оставить <текст> · echo <…>   — оставить эхо здесь',
      '  вести · echoes                — найти эхо в этой комнате',
      '  знания · known                — что вам уже ведомо',
      '  помощь · help                 — этот список',
    ].join('\n'),
    'help',
  );
}

// --- Рендер ------------------------------------------------------------------

/**
 * Отрисовать текущую комнату: имя, описание, выходы, видимые руны и число эха.
 * Экспортируемой её делать не нужно — вызывается изнутри команд; main.js
 * рисует стартовую комнату своей логикой по контракту (через intro+textui).
 */
function renderRoom() {
  const room = getRoom(state.room);
  if (!room) {
    textui.print('Здесь нет ничего — даже названия.', 'err');
    return;
  }

  textui.print(room.name || room.id, 'room-name');
  if (room.desc) textui.print(room.desc, 'room-desc');

  // Выходы.
  const exits = Object.keys(room.exits || {});
  if (exits.length) {
    const labels = exits.map((d) => DIR_LABEL[d] || d).join(', ');
    textui.print('Выходы: ' + labels, 'exits');
  } else {
    textui.print('Выходов отсюда нет.', 'exits');
  }

  // Видимые руны (id — единственное, что нам гарантированно доступно из room).
  const runes = room.runes || [];
  if (runes.length) {
    const word = runes.length === 1 ? 'руна' : 'руны';
    textui.print(`Здесь ${word}: ${runes.join(', ')} (попробуйте «читать»).`, 'rune-here');
  }

  // Предметы — справочно (взаимодействия с ними прототип не требует).
  const items = room.items || [];
  if (items.length) {
    textui.print('Заметно: ' + items.join(', '), 'items');
  }

  // Счётчик эха в комнате — «здесь есть вести: N».
  const here = echo.find();
  if (here.length) {
    textui.print(`Здесь есть вести: ${here.length} (наберите «вести»).`, 'echo-count');
  }
}

// --- Реакция на субстрат -----------------------------------------------------

/**
 * Обработчик 'record:written'. Эхо, оставленное игроком (или пришедшее извне),
 * сразу проявляется в логе, если относится к текущей комнате. Знание/служебные
 * записи не дублируем — их подтверждают сами команды.
 * @param {{type?:string, place?:string, author?:string, payload?:any}} rec
 */
function onRecord(rec) {
  if (!rec || rec.type !== 'echo') return;
  // Показываем только эхо текущего места, чтобы лог не засорялся чужими комнатами.
  if (rec.place !== state.room) return;
  // Своё только что оставленное эхо — уже подтверждено командой; но проявить
  // текст полезно для эффекта «слово осело». Помечаем автора.
  const author = rec.author === player.id ? 'вы' : (rec.author ?? 'некто');
  const text = rec?.payload?.text ?? '';
  textui.print(`…отголосок: «${text}» — ${author}`, 'echo-live');
}
