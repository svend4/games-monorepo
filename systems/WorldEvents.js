/**
 * WorldEvents.js
 * Случайные мировые события: Ярость, Золотой дождь, Туман, Благословение.
 *
 * Глобальные зависимости (из game.html):
 *   scene, pg, THREE, spawnLoot, snd
 *
 * Экспортирует глобальные переменные/функции:
 *   worldEvent  — текущее активное событие (null или {type, dur, timer})
 *   tickEvent(dt)
 *   triggerEvent()
 */
'use strict';

var worldEvent    = null;
var eventCooldown = 70; // секунд до первого события

var EVENTS = [
  { name:'⚡ Буря ярости!',   type:'rage',  dur:20, col:'#e74c3c', desc:'Враги атакуют быстрее!' },
  { name:'💰 Золотой дождь!', type:'gold',  dur:15, col:'#ffd700', desc:'Бонусное золото!'        },
  { name:'🌫️ Густой туман!',  type:'fog',   dur:18, col:'#aaa',    desc:'Видимость снижена!'      },
  { name:'✨ Благословение!',  type:'bless', dur:22, col:'#c8a0ff', desc:'ATK и скорость +50%!'   },
];

function triggerEvent() {
  var ev = EVENTS[Math.floor(Math.random() * EVENTS.length)];
  worldEvent = { type: ev.type, dur: ev.dur, timer: ev.dur };

  var ban = document.getElementById('event-banner');
  if (ban) {
    ban.textContent    = ev.name + ' ' + ev.desc;
    ban.style.borderColor = ev.col;
    ban.style.opacity  = '1';
    setTimeout(function () { ban.style.opacity = '0'; }, 3500);
  }

  snd('lvl');

  if (ev.type === 'gold') {
    for (var i = 0; i < 4; i++) {
      spawnLoot(
        new THREE.Vector3((Math.random() - .5) * 16, 0, (Math.random() - .5) * 16),
        'gold',
        15 + Math.floor(Math.random() * 20)
      );
    }
  }

  if (ev.type === 'fog') {
    scene.fog = new THREE.FogExp2(0x0d1520, 0.095);
    setTimeout(function () {
      scene.fog = new THREE.FogExp2(0x1a3050, 0.028);
    }, ev.dur * 1000);
  }
}

function tickEvent(dt) {
  eventCooldown -= dt;
  if (eventCooldown <= 0 && !worldEvent) {
    eventCooldown = 55 + Math.random() * 35;
    triggerEvent();
  }
  if (worldEvent) {
    worldEvent.timer -= dt;
    if (worldEvent.timer <= 0) worldEvent = null;
  }
}
