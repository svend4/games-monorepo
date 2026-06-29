window.GAME_LEVELS = window.GAME_LEVELS || {};
window.GAME_LEVELS.level1 = window.GAME_LEVELS['1'] = {
  id: 'level1',
  number: 1,
  title: 'Variant 3 - 3D Prototype - Level 1',
  hudTitle: 'Variant 3: Level 1',
  crystalsRequired: 5,
  world: {
    size: 48,
    bounds: 18,
    playerStart: [0, 5],
    cameraOffset: [7, 7.2, 9],
    fog: [0x111827, 20, 58],
    paths: [
      { position: [0, -2.4], size: [3.2, 28], y: 0.018 },
      { position: [0, 1.8], size: [24, 2.2], y: 0.02 }
    ]
  },
  portal: {
    position: [0, -10],
    enterRadius: 1.7
  },
  crystals: [
    { position: [-7, -6] },
    { position: [-2, -9] },
    { position: [6, -7] },
    { position: [8, 3] },
    { position: [-6, 5] }
  ],
  trees: [
    { position: [-9, -2], scale: 1.05 },
    { position: [-8, 8], scale: 0.85 },
    { position: [-3, 8], scale: 1.1 },
    { position: [5, 7], scale: 0.95 },
    { position: [10, -1], scale: 1.15 },
    { position: [3, -12], scale: 0.9 },
    { position: [-11, -8], scale: 0.8 },
    { position: [12, 10], scale: 0.82 },
    { position: [-14, 12], scale: 0.9 }
  ],
  stones: [
    { position: [-4, -4] },
    { position: [4, 1] },
    { position: [9, 8] },
    { position: [-10, 2] },
    { position: [12, -7] },
    { position: [-13, -11] }
  ],
  text: {
    initialObjective: 'Gather crystals',
    activeObjective: 'Enter the portal',
    completeObjective: 'Portal stabilized',
    opened: 'Area opened',
    found: 'Crystal found',
    portalAwake: 'Portal is awake',
    moving: 'Moving',
    explore: 'Explore',
    collected: 'Collected',
    portalActive: 'Portal active',
    complete: 'Area complete'
  }
};
