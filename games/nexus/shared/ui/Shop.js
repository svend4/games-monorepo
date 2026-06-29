/**
 * Shop.js
 * Магазин торговца Арона: открытие/закрытие, покупки.
 *
 * Глобальные зависимости (из game.html):
 *   PS, pg, NPC_POS, locked, spawnParts, snd, showMsg, updHUD, checkQuests
 *
 * Экспортирует:
 *   shopOpen   — флаг (используется в game.html для блокировки движения/мыши)
 *   openShop()
 *   closeShop()
 *   window.buyItem(type)
 *   window.closeShop
 */
'use strict';

var shopOpen = false;

var SHOP_ITEMS = {
  potion: { cost: 25,  label: '🧪 ×2 Зелья получены',  apply: function () { PS.potions += 2; } },
  atk:    { cost: 60,  label: '⚔️ ATK +10!',            apply: function () { PS.atk += 10; } },
  hp:     { cost: 80,  label: '🛡️ Макс.HP +50!',        apply: function () { PS.maxHp += 50; PS.hp = Math.min(PS.hp + 50, PS.maxHp); } },
  dash:   { cost: 120, label: '✨ Рывок быстрее!',       apply: function () { PS.dashMult = Math.max(0.4, PS.dashMult - 0.25); } },
};

function openShop() {
  if (pg.position.distanceTo(NPC_POS) > 3.5) {
    showMsg('Подойдите к торговцу Арону!');
    return;
  }
  shopOpen = true;
  document.getElementById('shop').style.display = 'block';
  document.getElementById('sg').textContent = PS.gold;
  if (locked) document.exitPointerLock();
}

function closeShop() {
  shopOpen = false;
  document.getElementById('shop').style.display = 'none';
}

window.buyItem = function (type) {
  var item = SHOP_ITEMS[type];
  if (!item) return;
  if (PS.gold < item.cost) { showMsg('Недостаточно золота!'); snd('miss'); return; }
  PS.gold -= item.cost;
  item.apply();
  showMsg(item.label);
  spawnParts(pg.position, 0xffd700, 20, 5);
  snd('buy');
  updHUD();
  checkQuests();
  document.getElementById('sg').textContent = PS.gold;
};

window.closeShop = closeShop;
