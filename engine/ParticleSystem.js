/**
 * ParticleSystem.js
 * Буферная система частиц (MAX 400).
 * Зависимости: scene, THREE (доступны до вызова initParticles)
 * Экспортирует: activeParts, spawnParts(pos,hex,n,spd), tickParts(dt)
 */
'use strict';

var MAX_PART = 400;
var pPos = new Float32Array(MAX_PART * 3), pCol = new Float32Array(MAX_PART * 3);
var pGeo, pMat, pSystem;
var activeParts = [];

function initParticles() {
  pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color',    new THREE.BufferAttribute(pCol, 3));
  pMat = new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, depthWrite: false });
  pSystem = new THREE.Points(pGeo, pMat);
  scene.add(pSystem);
}

function spawnParts(pos, hex, n, spd) {
  n = n || 12; spd = spd || 5;
  var r = ((hex >> 16) & 0xff) / 255, g = ((hex >> 8) & 0xff) / 255, b = (hex & 0xff) / 255;
  for (var i = 0; i < n; i++) {
    var a = Math.random() * Math.PI * 2, v = (0.4 + Math.random()) * spd;
    activeParts.push({
      x: pos.x, y: pos.y + 0.6, z: pos.z,
      vx: Math.sin(a) * v * (0.4 + Math.random() * 0.6),
      vy: v * Math.random(),
      vz: Math.cos(a) * v * (0.4 + Math.random() * 0.6),
      r: r, g: g, b: b, life: 0.5 + Math.random() * 0.5
    });
  }
}

function tickParts(dt) {
  for (var i = activeParts.length - 1; i >= 0; i--) {
    var p = activeParts[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.vy -= 9 * dt; p.life -= dt;
    if (p.life <= 0) activeParts.splice(i, 1);
  }
  var lim = Math.min(activeParts.length, MAX_PART);
  for (var i = 0; i < MAX_PART; i++) {
    if (i < lim) {
      var p = activeParts[i];
      pPos[i * 3] = p.x; pPos[i * 3 + 1] = p.y; pPos[i * 3 + 2] = p.z;
      pCol[i * 3] = p.r; pCol[i * 3 + 1] = p.g; pCol[i * 3 + 2] = p.b;
    } else { pPos[i * 3 + 1] = -999; }
  }
  pGeo.attributes.position.needsUpdate = true;
  pGeo.attributes.color.needsUpdate = true;
}
