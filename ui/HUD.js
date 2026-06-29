/**
 * HUD.js
 * Функции обновления интерфейса: сообщения, полосы HP/XP/статы.
 * Зависимости: PS
 * Экспортирует: showMsg(text), updHUD()
 */
'use strict';

function showMsg(t) {
  var m = document.getElementById('msg');
  m.textContent = t; m.style.opacity = '1';
  clearTimeout(m._t);
  m._t = setTimeout(function () { m.style.opacity = '0'; }, 2800);
}

function updHUD() {
  var hp = Math.max(0, PS.hp);
  document.getElementById('hp-fill').style.width = (hp / PS.maxHp * 100) + '%';
  document.getElementById('hp-val').textContent  = hp + '/' + PS.maxHp;
  document.getElementById('xp-fill').style.width = (PS.xp / PS.xpNext * 100) + '%';
  document.getElementById('xp-val').textContent  = PS.xp + '/' + PS.xpNext;
  document.getElementById('lvl-val').textContent  = PS.level;
  document.getElementById('atk-val').textContent  = PS.atk;
  document.getElementById('gold-val').textContent = PS.gold;
  document.getElementById('kill-val').textContent = PS.kills;
  document.getElementById('pot-val').textContent  = PS.potions;
}
