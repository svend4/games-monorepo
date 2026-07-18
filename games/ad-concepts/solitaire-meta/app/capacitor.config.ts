import type { CapacitorConfig } from '@capacitor/cli';

// Обвязка Проход Е: нативные проекты (android/, ios/) в репо не хранятся —
// генерируются локально через `npx cap add android|ios` (см. README).
const config: CapacitorConfig = {
  appId: 'com.surgegames.orchardpeaks',
  appName: 'Orchard Peaks',
  webDir: 'dist'
};

export default config;
