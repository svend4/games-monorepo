/**
 * Arena.js
 * Геометрия мира: земля, стены, дорожки, колонны, барьеры, вода, деревья, факелы.
 * Зависимости: scene, MAT, THREE (доступны до вызова initArena)
 * Экспортирует: WORLD, HALF, addBox, waterTiles, treePosns, torchLights, tickTorches(t)
 */
'use strict';

var WORLD = 22, HALF = WORLD / 2;
var waterTiles, treePosns, torchLights;

function addBox(x, y, z, w, h, d, mat) {
  var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; scene.add(m); return m;
}

function initArena() {
  // Земля и сетка
  var gnd = new THREE.Mesh(new THREE.PlaneGeometry(WORLD, WORLD), MAT.grass);
  gnd.rotation.x = -Math.PI / 2; gnd.receiveShadow = true; scene.add(gnd);
  scene.add(new THREE.GridHelper(WORLD, WORLD, 0x1a3a1a, 0x1a3a1a));

  // Стены
  for (var wi = -HALF; wi <= HALF; wi += 1) {
    addBox(wi, 0.75, -HALF, 1, 1.5, 1, MAT.wall); addBox(wi, 0.75, HALF, 1, 1.5, 1, MAT.wall);
    addBox(-HALF, 0.75, wi, 1, 1.5, 1, MAT.wall); addBox(HALF, 0.75, wi, 1, 1.5, 1, MAT.wall);
  }

  // Дорожки
  for (var ri = -HALF + 1; ri < HALF; ri++) {
    addBox(ri, 0.01, 0, 1, 0.02, 1, MAT.path);
    addBox(0, 0.01, ri, 1, 0.02, 1, MAT.path);
  }

  // Колонны
  var pillarPos = [{ x: -5, z: -5 }, { x: 5, z: -5 }, { x: -5, z: 5 }, { x: 5, z: 5 }];
  for (var i = 0; i < pillarPos.length; i++)
    addBox(pillarPos[i].x, 1, pillarPos[i].z, 0.9, 2, 0.9, MAT.stone);

  // Барьеры
  addBox(-7.5, 0.6, -3, 2.5, 1.2, 0.5, MAT.stone);
  addBox(7.5, 0.6, 3, 2.5, 1.2, 0.5, MAT.stone);
  addBox(3, 0.6, -7.5, 0.5, 1.2, 2.5, MAT.stone);

  // Вода
  waterTiles = [{ x: -6.5, z: -5.5, w: 3, d: 4 }, { x: 6, z: 5.5, w: 3, d: 3 }];
  for (var i = 0; i < waterTiles.length; i++) {
    var wt = waterTiles[i];
    var wm = new THREE.Mesh(new THREE.BoxGeometry(wt.w, 0.12, wt.d), MAT.water);
    wm.position.set(wt.x, 0.06, wt.z); scene.add(wm);
  }

  // Деревья
  treePosns = [
    { x: -8, z: -7 }, { x: 8, z: -7 }, { x: -8, z: 7 },
    { x: 8, z: 7 }, { x: 3, z: -9 }, { x: -3, z: 9 }
  ];
  for (var i = 0; i < treePosns.length; i++) {
    var tp = treePosns[i];
    var tr = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 1.7, 8), MAT.trunk);
    tr.position.set(tp.x, 0.85, tp.z); tr.castShadow = true; scene.add(tr);
    var cl1 = new THREE.Mesh(new THREE.SphereGeometry(0.95, 7, 5), MAT.leaf1);
    cl1.position.set(tp.x, 2.2, tp.z); cl1.castShadow = true; scene.add(cl1);
    var cl2 = new THREE.Mesh(new THREE.SphereGeometry(0.65, 7, 5), MAT.leaf2);
    cl2.position.set(tp.x, 3.0, tp.z); cl2.castShadow = true; scene.add(cl2);
  }

  // Факелы
  var torchPosns = [{ x: 0, z: -9 }, { x: 0, z: 9 }, { x: -9, z: 0 }, { x: 9, z: 0 }];
  torchLights = [];
  for (var i = 0; i < torchPosns.length; i++) {
    var tp = torchPosns[i];
    addBox(tp.x, 0.75, tp.z, 0.08, 1.5, 0.08, MAT.trunk);
    var tl = new THREE.PointLight(0xff8820, 1.5, 7.5);
    tl.position.set(tp.x, 1.85, tp.z); scene.add(tl); torchLights.push(tl);
  }
}

function tickTorches(t) {
  for (var i = 0; i < torchLights.length; i++)
    torchLights[i].intensity = 1.4 + Math.sin(t * 6.5 + i * 2) * 0.45;
}
