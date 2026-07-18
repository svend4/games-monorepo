import type { CapacitorConfig } from '@capacitor/cli';

// Обвязка Проход Е: нативные проекты (android/, ios/) в репо не хранятся —
// генерируются локально через `npx cap add android|ios` (см. README).
const config: CapacitorConfig = {
  appId: 'com.surgegames.wordgrove',
  appName: 'WordGrove',
  webDir: 'dist'
};

export default config;
