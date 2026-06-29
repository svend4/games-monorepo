window.GAME_LEVELS = window.GAME_LEVELS || {};
window.GAME_LEVELS.level3 = window.GAME_LEVELS['3'] = {
  id: 'level3',
  number: 3,
  title: 'Variant 3 - 3D Prototype - Level 3',
  hudTitle: 'Variant 3: Level 3',
  crystalsRequired: 7,
  world: {
    size: 64,
    bounds: 26,
    playerStart: [18, 18],
    cameraOffset: [9, 8.5, 11],
    fog: [0x0f1724, 28, 82],
    paths: [
      { position: [10, 11], size: [3.4, 36], y: 0.018, rotation: 0.72 },
      { position: [-4, 0], size: [3.2, 42], y: 0.02, rotation: -0.22 },
      { position: [-16, -12], size: [3.0, 26], y: 0.022, rotation: 0.7 },
      { position: [0, -6], size: [30, 2.3], y: 0.024, rotation: -0.1 }
    ]
  },
  portal: {
    position: [-21, -20],
    enterRadius: 2.05
  },
  crystals: [
    { position: [20, 11] },
    { position: [12, 3] },
    { position: [4, 15] },
    { position: [-3, 4] },
    { position: [-9, -8] },
    { position: [-17, -2] },
    { position: [-22, -17] }
  ],
  trees: [
    { position: [24, 21], scale: 1.05 },
    { position: [19, 4], scale: 0.88 },
    { position: [14, 18], scale: 1.15 },
    { position: [7, 24], scale: 0.9 },
    { position: [5, -2], scale: 1.0 },
    { position: [-2, 20], scale: 0.78 },
    { position: [-8, 10], scale: 1.12 },
    { position: [-12, -14], scale: 0.95 },
    { position: [-18, 7], scale: 0.9 },
    { position: [-24, -4], scale: 1.18 },
    { position: [-25, -22], scale: 0.82 },
    { position: [-6, -24], scale: 1.08 },
    { position: [11, -19], scale: 0.92 },
    { position: [23, -10], scale: 1.0 }
  ],
  stones: [
    { position: [21, 15] },
    { position: [16, 7] },
    { position: [9, -3] },
    { position: [2, 11] },
    { position: [-5, 1] },
    { position: [-8, -12] },
    { position: [-13, 4] },
    { position: [-18, -9] },
    { position: [-23, -15] },
    { position: [-20, 14] },
    { position: [2, -22] },
    { position: [18, -18] }
  ],
  text: {
    initialObjective: 'Trace seven crystals',
    activeObjective: 'Reach the final portal',
    completeObjective: 'Third portal stabilized',
    opened: 'Third area opened',
    found: 'Crystal found',
    portalAwake: 'Final portal is awake',
    moving: 'Moving',
    explore: 'Explore',
    collected: 'Collected',
    portalActive: 'Portal active',
    complete: 'Area complete'
  }
};
