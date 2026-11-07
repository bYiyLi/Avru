import { defineConfig } from 'wxt';
export default defineConfig({
  manifest: {
    name: 'Avru Browser Connection',
    description: 'Connect browser tabs to your local Avru daemon.',
    version: '0.0.1',
    minimum_chrome_version: '116',
    permissions: ['storage', 'tabs', 'alarms'],
    host_permissions: ['http://127.0.0.1/*'],
  },
});
