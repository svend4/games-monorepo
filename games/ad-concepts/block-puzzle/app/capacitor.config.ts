/**
 * Конфиг Capacitor (Проход Е.3): webDir = dist (vite build, base './').
 * Нативные проекты android/ и ios/ НЕ в репозитории — генерируются локально:
 *   npx cap add android   /   npx cap add ios
 * (см. README, раздел «Capacitor: путь до устройств»).
 */
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.surgegames.blocksurge',
  appName: 'Block Surge',
  webDir: 'dist'
};

export default config;
