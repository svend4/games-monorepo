/**
 * AudioSystem.js
 * Web Audio API: инициализация контекста, фоновый дрон, звуковые эффекты.
 * Зависимостей нет.
 */
'use strict';

var aud = null, ambStarted = false;

function initAud() {
  if (aud) return;
  aud = new (window.AudioContext || window.webkitAudioContext)();
  if (!ambStarted) {
    ambStarted = true;
    var o = aud.createOscillator(), g = aud.createGain();
    o.type = 'sine'; o.frequency.value = 55; g.gain.value = 0.028;
    o.connect(g); g.connect(aud.destination); o.start();
    var o2 = aud.createOscillator(), g2 = aud.createGain();
    o2.type = 'sine'; o2.frequency.value = 82.4; g2.gain.value = 0.014;
    o2.connect(g2); g2.connect(aud.destination); o2.start();
  }
}

function snd(type) {
  if (!aud) return;
  var o = aud.createOscillator(), g = aud.createGain();
  o.connect(g); g.connect(aud.destination); var n = aud.currentTime;
  if (type === 'hit') {
    o.type = 'square'; o.frequency.setValueAtTime(210, n); o.frequency.exponentialRampToValueAtTime(80, n + .09);
    g.gain.setValueAtTime(.12, n); g.gain.exponentialRampToValueAtTime(.001, n + .1); o.start(n); o.stop(n + .1);
  } else if (type === 'kill') {
    o.type = 'sawtooth'; o.frequency.setValueAtTime(320, n); o.frequency.exponentialRampToValueAtTime(50, n + .35);
    g.gain.setValueAtTime(.18, n); g.gain.exponentialRampToValueAtTime(.001, n + .35); o.start(n); o.stop(n + .35);
  } else if (type === 'lvl') {
    o.type = 'sine';
    o.frequency.setValueAtTime(440, n); o.frequency.setValueAtTime(550, n + .12);
    o.frequency.setValueAtTime(660, n + .24); o.frequency.setValueAtTime(880, n + .36);
    g.gain.setValueAtTime(.22, n); g.gain.exponentialRampToValueAtTime(.001, n + .55); o.start(n); o.stop(n + .55);
  } else if (type === 'coin') {
    o.type = 'sine'; o.frequency.setValueAtTime(1050, n);
    g.gain.setValueAtTime(.08, n); g.gain.exponentialRampToValueAtTime(.001, n + .12); o.start(n); o.stop(n + .12);
  } else if (type === 'pot') {
    o.type = 'sine'; o.frequency.setValueAtTime(580, n); o.frequency.setValueAtTime(880, n + .18);
    g.gain.setValueAtTime(.14, n); g.gain.exponentialRampToValueAtTime(.001, n + .28); o.start(n); o.stop(n + .28);
  } else if (type === 'dash') {
    o.type = 'sawtooth'; o.frequency.setValueAtTime(680, n); o.frequency.exponentialRampToValueAtTime(140, n + .16);
    g.gain.setValueAtTime(.13, n); g.gain.exponentialRampToValueAtTime(.001, n + .16); o.start(n); o.stop(n + .16);
  } else if (type === 'miss') {
    o.type = 'sine'; o.frequency.setValueAtTime(140, n);
    g.gain.setValueAtTime(.04, n); g.gain.exponentialRampToValueAtTime(.001, n + .07); o.start(n); o.stop(n + .07);
  } else if (type === 'buy') {
    o.type = 'sine'; o.frequency.setValueAtTime(660, n); o.frequency.setValueAtTime(880, n + .10);
    g.gain.setValueAtTime(.10, n); g.gain.exponentialRampToValueAtTime(.001, n + .22); o.start(n); o.stop(n + .22);
  }
}
