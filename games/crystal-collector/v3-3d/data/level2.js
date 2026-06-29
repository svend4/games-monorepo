window.GAME_LEVELS = window.GAME_LEVELS || {};
window.GAME_LEVELS.level2 = window.GAME_LEVELS['2'] = {
  id: 'level2',
  number: 2,
  title: 'Variant 3 - 3D Prototype - Level 2',
  hudTitle: 'Variant 3: Level 2',
  crystalsRequired: 6,
  world: {
    size: 56,
    bounds: 22,
    playerStart: [-12, 14],
    cameraOffset: [8, 8, 10],
    fog: [0x101827, 24, 70],
    paths: [
      { position: [-6, 7], size: [3.2, 30], y: 0.018, rotation: -0.48 },
      { position: [6, -5], size: [3.0, 32], y: 0.02, rotation: 0.58 },
      { position: [1, 1], size: [26, 2.4], y: 0.022, rotation: 0.05 }
    ]
  },
  portal: {
    position: [14, -15],
    enterRadius: 1.9
  },
  crystals: [
    { position: [-16, 8] },
    { position: [-9, -1] },
    { position: [-2, 11] },
    { position: [5, 4] },
    { position: [12, -4] },
    { position: [17, -12] }
  ],
  trees: [
    { position: [-20, 17], scale: 1.0 },
    { position: [-18, 5], scale: 0.9 },
    { position: [-13, -7], scale: 1.1 },
    { position: [-6, 17], scale: 0.85 },
    { position: [0, -14], scale: 1.15 },
    { position: [4, 15], scale: 0.95 },
    { position: [9, -10], scale: 1.05 },
    { position: [15, 7], scale: 0.82 },
    { position: [19, -2], scale: 0.9 },
    { position: [20, -18], scale: 1.1 },
    { position: [-2, -20], scale: 0.78 },
    { position: [-21, -16], scale: 0.95 }
  ],
  stones: [
    { position: [-15, 13] },
    { position: [-11, 2] },
    { position: [-5, -11] },
    { position: [2, 9] },
    { position: [7, -1] },
    { position: [11, 12] },
    { position: [16, -8] },
    { position: [19, 4] },
    { position: [-19, -5] }
  ],
  text: {
    initialObjective: 'Find six crystals',
    activeObjective: 'Cross to the portal',
    completeObjective: 'Second portal stabilized',
    opened: 'Second area opened',
    found: 'Crystal found',
    portalAwake: 'Distant portal is awake',
    moving: 'Moving',
    explore: 'Explore',
    collected: 'Collected',
    portalActive: 'Portal active',
    complete: 'Area complete'
  }
};
