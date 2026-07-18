/**
 * Точка входа Block Surge (Проход Е.1 + Е.2): сервисы меты + конфиг Phaser.
 * Порядок как в прототипе (economy.js → meta.js → game.js): сначала Store/
 * Economy/Meta и DOM-оверлей, затем сцена партии с хуками в мету.
 * Размер канваса задаёт сцена; Scale.FIT вписывает игру в колонку между
 * топбаром меты и бустер-баром с сохранением пропорций.
 */
import Phaser from 'phaser';
import { GAME_H, GAME_W, GameScene } from './scenes/GameScene';
import { Store } from './economy/store';
import { Analytics } from './economy/analytics';
import { Economy } from './economy/economy';
import { Meta } from './meta/meta';
import { BoosterController } from './meta/boosters';
import { MetaUi } from './ui/MetaUi';

/* Слой экономики и меты (Проход Б): один Store — атомарный сейв blocksurge_meta. */
const store = new Store();
const analytics = new Analytics();
const economy = new Economy(store, analytics);
const meta = new Meta(store, economy, analytics);
const boosters = new BoosterController(economy);

/* DOM-оверлей меты: топбар, бустер-бар, мета-экран, тосты. */
const ui = new MetaUi(economy, meta, boosters);
ui.mount();

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: '#0e1117',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: [new GameScene({ economy, meta, boosters, ui })]
});
