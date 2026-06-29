/**
 * EnemySystem.js
 * Определения врагов, HP-спрайты, инициализация, AI-тик, возрождение.
 * Зависимости: scene, MAT, THREE, spawnParts, addFlt, updHUD, worldEvent, pg, PS
 * Экспортирует: enems[], makeHpSpr, refreshSpr, initEnemies(), tickEnemies(dt,t)
 */
'use strict';

var eDefs = [
  { x: -5, z: -3, c: 0x27ae60, n: 'Гоблин',  hp: 60,  atk: 8,  xp: 30, g: 8,  w: .4,   h: .82,  d: .4,   yB: .41, spd: 2.6 },
  { x:  5, z:  4, c: 0xe74c3c, n: 'Орк',     hp: 130, atk: 17, xp: 65, g: 22, w: .68,  h: 1.12, d: .68,  yB: .56, spd: 2.0 },
  { x: -5, z:  7, c: 0xf39c12, n: 'Тролль',  hp: 200, atk: 25, xp: 96, g: 38, w: 1.02, h: 1.52, d: 1.02, yB: .76, spd: 1.4 },
  { x:  7, z: -6, c: 0x85c1e9, n: 'Призрак', hp: 90,  atk: 14, xp: 52, g: 16, w: .38,  h: 1.55, d: .18,  yB: .78, spd: 2.9 },
  { x: -8, z:  3, c: 0xbdc3c7, n: 'Скелет',  hp: 75,  atk: 12, xp: 42, g: 11, w: .28,  h: 1.1,  d: .28,  yB: .55, spd: 2.3 },
];

var enems = [];

function makeHpSpr(height) {
  var c = document.createElement('canvas'); c.width = 64; c.height = 10;
  var cx = c.getContext('2d'); cx.fillStyle = '#e74c3c'; cx.fillRect(0, 0, 64, 10);
  var tx = new THREE.CanvasTexture(c);
  var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, depthTest: false }));
  sp.scale.set(1.5, .22, 1); sp.position.set(0, height / 2 + 0.55, 0);
  sp._c = c; sp._cx = cx; sp._tx = tx; return sp;
}

function refreshSpr(sp, pct) {
  var cx = sp._cx; cx.fillStyle = '#333'; cx.fillRect(0, 0, 64, 10);
  cx.fillStyle = pct > .5 ? '#2ecc71' : pct > .25 ? '#f39c12' : '#e74c3c';
  cx.fillRect(0, 0, Math.round(64 * pct), 10); sp._tx.needsUpdate = true;
}

function initEnemies() {
  enems = eDefs.map(function (d) {
    var mat = new THREE.MeshLambertMaterial({ color: d.c });
    var mesh = new THREE.Mesh(new THREE.BoxGeometry(d.w, d.h, d.d), mat);
    mesh.position.set(d.x, d.yB, d.z); mesh.castShadow = true; scene.add(mesh);
    var sp = makeHpSpr(d.h); mesh.add(sp);
    return {
      mesh: mesh, sp: sp, hp: d.hp, maxHp: d.hp, atk: d.atk,
      xp: d.xp, gold: d.g, name: d.n, dead: false,
      aiCd: Math.random() * 2, spawnPos: new THREE.Vector3(d.x, d.yB, d.z),
      yB: d.yB, spd: d.spd, respawn: 0
    };
  });
}

function tickEnemies(dt, t) {
  for (var i = 0; i < enems.length; i++) {
    var en = enems[i];
    if (en.dead) {
      if (en.respawn > 0) {
        en.respawn -= dt;
        if (en.respawn <= 0) {
          en.dead = false; en.hp = en.maxHp; en.mesh.visible = true;
          en.mesh.position.copy(en.spawnPos); refreshSpr(en.sp, 1);
          spawnParts(en.spawnPos, 0x2ecc71, 12, 3);
          addFlt(en.spawnPos, 'Возрождение!', '#2ecc71');
        }
      }
      continue;
    }
    en.mesh.position.y = en.yB + Math.sin(t * 2.2 + i * 1.4) * 0.06;
    en.aiCd = Math.max(0, en.aiCd - dt); if (en.aiCd > 0) continue;
    var rage = worldEvent && worldEvent.type === 'rage';
    en.aiCd = rage ? 0.5 + Math.random() * .3 : 1.2 + Math.random() * .8;
    var dist = en.mesh.position.distanceTo(pg.position);
    if (dist < 1.7) {
      var dmg = Math.floor((en.atk + Math.floor(Math.random() * 5)) * (rage ? 1.6 : 1.0));
      PS.hp = Math.max(0, PS.hp - dmg);
      spawnParts(pg.position, 0xff4444, 6, 3);
      addFlt(pg.position.clone().add(new THREE.Vector3(0, 1.5, 0)), '-' + dmg, '#ff4444');
      updHUD();
    } else if (dist < 10) {
      var sv = en.spd * (rage ? 1.5 : 1.0) * dt;
      var step = pg.position.clone().sub(en.mesh.position).normalize().multiplyScalar(sv);
      en.mesh.position.x += step.x; en.mesh.position.z += step.z;
      en.mesh.lookAt(pg.position);
    }
  }
}
