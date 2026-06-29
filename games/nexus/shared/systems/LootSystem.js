/**
 * LootSystem.js
 * Лут: создание, подбор, анимация вращения.
 * Зависимости: scene, MAT, THREE, pg, PS, snd, addFlt, checkQuests, updHUD
 * Экспортирует: lootArr[], spawnLoot(pos,type,amount), tickLoot(dt)
 */
'use strict';

var lootArr = [];

function spawnLoot(pos, type, amount) {
  var mesh = type === 'gold'
    ? new THREE.Mesh(new THREE.CylinderGeometry(.16, .16, .07, 8), MAT.gold)
    : new THREE.Mesh(new THREE.CylinderGeometry(.07, .1, .32, 8), MAT.potion);
  mesh.position.set(
    pos.x + (Math.random() - .5) * .7, .22,
    pos.z + (Math.random() - .5) * .7
  );
  mesh.castShadow = true; scene.add(mesh);
  lootArr.push({ mesh: mesh, type: type, amt: amount || 10, got: false, st: Math.random() * 6 });
}

function tickLoot(dt) {
  for (var i = 0; i < lootArr.length; i++) {
    var l = lootArr[i]; if (l.got) continue;
    l.st += dt * 2.5; l.mesh.rotation.y = l.st;
    l.mesh.position.y = .2 + Math.sin(l.st * 1.5) * .05;
    if (pg.position.distanceTo(l.mesh.position) < .9) {
      l.got = true; l.mesh.visible = false;
      if (l.type === 'gold') {
        PS.gold += l.amt; snd('coin');
        addFlt(l.mesh.position, '+' + l.amt + ' 💰', '#ffd700');
      } else {
        PS.potions++; snd('pot');
        addFlt(l.mesh.position, '+🧪 Зелье', '#e91e8c');
      }
      checkQuests(); updHUD();
    }
  }
}
