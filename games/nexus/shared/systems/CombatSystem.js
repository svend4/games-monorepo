/**
 * CombatSystem.js
 * Боевая система: левел-ап, атака, зелье, рывок.
 * Зависимости: PS, pg, enems, spawnParts, addFlt, snd, spawnLoot,
 *              checkQuests, updHUD, showMsg, refreshSpr, THREE,
 *              worldEvent, keys, swingTimer (game.html)
 * Экспортирует: checkLevelUp(), attack(), drinkPot(), dash()
 */
'use strict';

function checkLevelUp() {
  while (PS.xp >= PS.xpNext) {
    PS.xp -= PS.xpNext; PS.level++;
    PS.xpNext = Math.floor(PS.xpNext * 1.4);
    PS.maxHp += 25; PS.hp = PS.maxHp; PS.atk += 6;
    spawnParts(pg.position, 0xc8a0ff, 35, 6); snd('lvl');
    showMsg('🎉 Уровень ' + PS.level + '! HP+25 ATK+6'); checkQuests();
  }
}

function attack() {
  if (PS.atkCd > 0) return;
  var blessed = worldEvent && worldEvent.type === 'bless';
  PS.atkCd = blessed ? 0.3 : 0.5; swingTimer = 0.35;
  var hit = false;
  for (var i = 0; i < enems.length; i++) {
    var en = enems[i]; if (en.dead) continue;
    if (pg.position.distanceTo(en.mesh.position) < 3.2) {
      var dmg = Math.floor((PS.atk + Math.floor(Math.random() * 16)) * (blessed ? 1.5 : 1.0));
      en.hp = Math.max(0, en.hp - dmg); refreshSpr(en.sp, en.hp / en.maxHp);
      spawnParts(en.mesh.position, 0xff4444, 10, 4);
      addFlt(en.mesh.position, '-' + dmg, '#ff6666'); snd('hit'); hit = true;
      if (en.hp <= 0) {
        en.dead = true; en.mesh.visible = false; en.respawn = 30;
        spawnParts(en.mesh.position, 0xffd700, 28, 7);
        addFlt(en.mesh.position, '💀 +' + en.xp + ' XP', '#ffd700'); snd('kill');
        if (Math.random() < .88) spawnLoot(en.mesh.position, 'gold', en.gold);
        if (Math.random() < .35) spawnLoot(en.mesh.position, 'potion');
        PS.xp += en.xp; PS.gold += en.gold; PS.kills++;
        checkLevelUp(); checkQuests(); updHUD();
      }
    }
  }
  if (!hit) {
    addFlt(pg.position.clone().add(new THREE.Vector3(0, 1.5, 0)), 'Промах!', '#666');
    snd('miss');
  }
}

function drinkPot() {
  if (PS.potions <= 0) {
    addFlt(pg.position.clone().add(new THREE.Vector3(0, 1.5, 0)), 'Нет зелий', '#666');
    return;
  }
  PS.potions--;
  var h = Math.round(PS.maxHp * .45); PS.hp = Math.min(PS.maxHp, PS.hp + h);
  spawnParts(pg.position, 0xe91e8c, 16, 4);
  addFlt(pg.position.clone().add(new THREE.Vector3(0, 1.5, 0)), '+' + h + ' HP', '#e91e8c');
  snd('pot'); updHUD();
}

function dash() {
  if (PS.dashCd > 0) return;
  PS.dashCd = 3.0 * PS.dashMult;
  var dv = new THREE.Vector3(0, 0, -1);
  if (keys['KeyS'] || keys['ArrowDown']) dv.z = 1;
  else if (keys['KeyA'] || keys['ArrowLeft']) dv.set(-1, 0, 0);
  else if (keys['KeyD'] || keys['ArrowRight']) dv.set(1, 0, 0);
  dv.applyAxisAngle(new THREE.Vector3(0, 1, 0), PS.yaw);
  PS.dVx = dv.x * 13; PS.dVz = dv.z * 13;
  spawnParts(pg.position, 0xc8a0ff, 22, 5); snd('dash');
}
