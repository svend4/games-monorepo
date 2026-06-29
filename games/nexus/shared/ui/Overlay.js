/**
 * Overlay.js
 * Canvas-оверлей для плавающего текста (+урон, +лут, промахи).
 * Зависимости: camera (доступна в момент вызова updateOverlay)
 * Экспортирует: oc, octx, flts[], initOverlay(), addFlt(pos,txt,col), updateOverlay()
 */
'use strict';

var oc, octx, flts = [];

function initOverlay() {
  oc = document.getElementById('overlay');
  octx = oc.getContext('2d');
  oc.width = innerWidth;
  oc.height = innerHeight - 60;
}

function addFlt(pos, txt, col) {
  flts.push({ pos: pos.clone(), txt: txt, col: col, life: 1.5 });
}

function updateOverlay() {
  octx.clearRect(0, 0, oc.width, oc.height);
  for (var i = 0; i < flts.length; i++) {
    var f = flts[i], v = f.pos.clone().project(camera);
    var sx = (v.x * .5 + .5) * oc.width, sy = (1 - (v.y * .5 + .5)) * oc.height;
    if (sx < 0 || sx > oc.width || sy < 0 || sy > oc.height || v.z > 1) continue;
    octx.globalAlpha = Math.min(1, f.life);
    octx.font = 'bold 13px Courier New';
    octx.fillStyle = f.col; octx.textAlign = 'center';
    octx.shadowColor = f.col; octx.shadowBlur = 7;
    octx.fillText(f.txt, sx, sy); octx.shadowBlur = 0;
  }
  octx.globalAlpha = 1; octx.textAlign = 'left';
}
