/**
 * QuestSystem.js
 * Квесты: данные, проверка прогресса, рендер журнала, UI журнала.
 *
 * Глобальные зависимости (из game.html):
 *   PS, pg, locked, spawnParts, snd, showMsg, updHUD, checkLevelUp
 */
'use strict';

var journalOpen = false;

var QUESTS = [
  {id:'k5',  name:'Первая кровь',    desc:'Убить 5 врагов',      goal:5,  prog:0, done:false, reward:{gold:50,  xp:80}},
  {id:'g100',name:'Богатство манит', desc:'Собрать 100 золота',  goal:100,prog:0, done:false, reward:{potion:2, xp:60}},
  {id:'lv3', name:'Испытание силой', desc:'Достичь 3-го уровня', goal:3,  prog:0, done:false, reward:{gold:120, xp:0}},
  {id:'k20', name:'Страж арены',     desc:'Убить 20 врагов',     goal:20, prog:0, done:false, reward:{gold:200, xp:250}},
];

function checkQuests() {
  QUESTS[0].prog = PS.kills;
  QUESTS[1].prog = PS.gold;
  QUESTS[2].prog = PS.level;
  QUESTS[3].prog = PS.kills;

  for (var i = 0; i < QUESTS.length; i++) {
    var q = QUESTS[i];
    if (q.done) continue;
    if (q.prog >= q.goal) {
      q.done = true;
      var r = q.reward;
      if (r.gold)   { PS.gold    += r.gold; }
      if (r.xp)     { PS.xp     += r.xp; checkLevelUp(); }
      if (r.potion) { PS.potions += r.potion; }
      showMsg('✅ Квест: «' + q.name + '» выполнен!');
      spawnParts(pg.position, 0x2ecc71, 32, 6);
      snd('lvl');
      updHUD();
    }
  }
  renderJournal();
}

function renderJournal() {
  var el = document.getElementById('quest-list');
  if (!el) return;
  el.innerHTML = '';
  for (var i = 0; i < QUESTS.length; i++) {
    var q = QUESTS[i];
    var pct = Math.min(1, q.prog / q.goal);
    var cls = q.done ? ' quest-done' : '';
    el.innerHTML +=
      '<div class="quest' + cls + '">'
      + '<div class="quest-name">' + (q.done ? '✅ ' : '📋 ') + q.name + '</div>'
      + '<div class="quest-prog">' + q.desc + ': ' + Math.min(q.prog, q.goal) + '/' + q.goal + '</div>'
      + '<div class="quest-bar-bg"><div class="quest-bar-fill" style="width:' + Math.round(pct * 100) + '%"></div></div>'
      + '</div>';
  }
}

function toggleJournal() {
  journalOpen = !journalOpen;
  document.getElementById('journal').style.display = journalOpen ? 'block' : 'none';
  if (journalOpen) {
    renderJournal();
    if (locked) document.exitPointerLock();
  }
}
