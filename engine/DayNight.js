/**
 * DayNight.js
 * Цикл дня и ночи: dayTime, DAY_DUR, applyDayNight().
 * Зависимости (глобальные, доступны в момент вызова): scene, sun, ambLight, worldEvent
 */
'use strict';

var dayTime = 0.55, DAY_DUR = 180;

function applyDayNight(t) {
  var noon = Math.cos((t - 0.5) * Math.PI * 2) * 0.5 + 0.5;
  var skyR = Math.round(noon * 40 + 13), skyG = Math.round(noon * 60 + 18), skyB = Math.round(noon * 80 + 20);
  scene.background.setHex((skyR << 16) | (skyG << 8) | skyB);
  scene.fog.color.setHex((skyR << 16) | (skyG << 8) | skyB);
  sun.intensity = noon * 1.2 + 0.05;
  sun.color.setRGB(1.0, (200 + noon * 55) / 255, (150 + noon * 90) / 255);
  ambLight.color.setRGB(0.08 + noon * 0.28, 0.10 + noon * 0.24, 0.20 + noon * 0.18);
  if (!(worldEvent && worldEvent.type === 'fog'))
    scene.fog.density = 0.055 - noon * 0.028;
  var s = t < 0.15 || t > 0.85 ? '🌙 Ночь' : t < 0.30 ? '🌅 Рассвет' : t < 0.70 ? '☀️ День' : '🌇 Закат';
  document.getElementById('time-ind').textContent = s;
}
