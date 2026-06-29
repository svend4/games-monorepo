/**
 * Minimap.js
 * Canvas-миникарта: вода, деревья, NPC, лут, враги, игрок + направление.
 * Зависимости: WORLD, HALF, waterTiles, treePosns, NPC_POS, lootArr, enems, pg, PS
 * Экспортирует: mm, mmx, initMinimap(), drawMinimap()
 */
'use strict';

var mm, mmx;

function initMinimap() {
  mm  = document.getElementById('minimap');
  mmx = mm.getContext('2d');
}

function drawMinimap() {
  var W = mm.width, H = mm.height, sc = W / WORLD;
  mmx.fillStyle = 'rgba(0,0,20,.92)'; mmx.fillRect(0, 0, W, H);

  // Вода
  mmx.fillStyle = '#1a4a8a';
  for (var i = 0; i < waterTiles.length; i++) {
    var wt = waterTiles[i];
    mmx.fillRect((wt.x - wt.w / 2 + HALF) * sc, (wt.z - wt.d / 2 + HALF) * sc, wt.w * sc, wt.d * sc);
  }

  // Дорожки
  mmx.fillStyle = '#505060';
  mmx.fillRect(0, (HALF - .5) * sc, W, sc);
  mmx.fillRect((HALF - .5) * sc, 0, sc, H);

  // Рамка
  mmx.strokeStyle = '#2a4a8a'; mmx.lineWidth = 2; mmx.strokeRect(1, 1, W - 2, H - 2);

  // Деревья
  mmx.fillStyle = '#1a5a1a';
  for (var i = 0; i < treePosns.length; i++) {
    mmx.beginPath();
    mmx.arc((treePosns[i].x + HALF) * sc, (treePosns[i].z + HALF) * sc, 3, 0, Math.PI * 2);
    mmx.fill();
  }

  // NPC
  mmx.fillStyle = '#f39c12';
  mmx.beginPath();
  mmx.arc((NPC_POS.x + HALF) * sc, (NPC_POS.z + HALF) * sc, 4, 0, Math.PI * 2);
  mmx.fill();

  // Лут
  for (var i = 0; i < lootArr.length; i++) {
    var l = lootArr[i]; if (l.got) continue;
    mmx.fillStyle = l.type === 'gold' ? '#ffd700' : '#e91e8c';
    mmx.fillRect((l.mesh.position.x + HALF) * sc - 1.5, (l.mesh.position.z + HALF) * sc - 1.5, 3, 3);
  }

  // Враги
  for (var i = 0; i < enems.length; i++) {
    var en = enems[i]; if (en.dead) continue;
    mmx.fillStyle = '#e74c3c';
    mmx.beginPath();
    mmx.arc((en.mesh.position.x + HALF) * sc, (en.mesh.position.z + HALF) * sc, 3, 0, Math.PI * 2);
    mmx.fill();
  }

  // Игрок + направление
  var px = (pg.position.x + HALF) * sc, pz = (pg.position.z + HALF) * sc;
  mmx.fillStyle = '#c8a0ff'; mmx.beginPath(); mmx.arc(px, pz, 4.5, 0, Math.PI * 2); mmx.fill();
  mmx.strokeStyle = '#c8a0ff'; mmx.lineWidth = 1.5; mmx.beginPath();
  mmx.moveTo(px, pz);
  mmx.lineTo(px + Math.sin(PS.yaw) * -10, pz + Math.cos(PS.yaw) * -10);
  mmx.stroke();

  mmx.fillStyle = '#334'; mmx.font = '8px Courier New'; mmx.fillText('NEXUS', 4, 10);
}
