/**
 * NPC.js
 * Торговец Арон: 3D-модель, свет, анимация, подсказка.
 * Зависимости: scene, MAT, THREE (init), pg (tick)
 * Экспортирует: NPC_POS, npcGroup, npcLight, initNPC(), tickNPC(t)
 */
'use strict';

var NPC_POS, npcGroup, npcLight;

function initNPC() {
  NPC_POS = new THREE.Vector3(2.5, 0, -3.5);

  npcGroup = new THREE.Group();
  npcGroup.position.copy(NPC_POS);
  scene.add(npcGroup);

  var npcBody = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, 0.44), MAT.npcRobe);
  npcBody.position.y = 0.5; npcBody.castShadow = true; npcGroup.add(npcBody);

  var npcHead = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), MAT.npcSkin);
  npcHead.position.y = 1.22; npcHead.castShadow = true; npcGroup.add(npcHead);

  var npcHat1 = new THREE.Mesh(new THREE.CylinderGeometry(0.0, 0.27, 0.38, 8), MAT.npcHat);
  npcHat1.position.y = 1.63; npcGroup.add(npcHat1);

  var npcHat2 = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.06, 8), MAT.npcHat);
  npcHat2.position.y = 1.46; npcGroup.add(npcHat2);

  var npcStaff = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.85, 6), MAT.trunk);
  npcStaff.position.set(0.34, 0.92, 0); npcGroup.add(npcStaff);

  var npcOrb = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 8, 8),
    new THREE.MeshLambertMaterial({ color: 0x00e5ff, emissive: 0x004466 })
  );
  npcOrb.position.set(0.34, 1.88, 0); npcGroup.add(npcOrb);

  npcLight = new THREE.PointLight(0x00e5ff, 0.9, 4.0);
  npcLight.position.set(NPC_POS.x, 2.1, NPC_POS.z);
  scene.add(npcLight);
}

function tickNPC(t) {
  npcGroup.position.y = Math.sin(t * 1.6) * 0.045;
  npcLight.intensity = 0.8 + Math.sin(t * 3.2) * 0.35;
  document.getElementById('npc-hint').style.display =
    pg.position.distanceTo(NPC_POS) < 3.5 ? 'block' : 'none';
}
