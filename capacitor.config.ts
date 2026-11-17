import type { CapacitorConfig } from '@capacitor/cli';

const serverUrl = (process.env.CAPACITOR_SERVER_URL || 'https://pos.example.com')
  .trim()
  .replace(/\/+$/, '');

const config: CapacitorConfig = {
  appId: 'com.whispers.cosmetics',
  appName: 'Whispers Cosmetics',
  webDir: 'dist',
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith('http://'),
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
