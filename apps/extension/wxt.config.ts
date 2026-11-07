import { defineConfig } from 'wxt';
import { releaseChannel } from '../../packages/protocol/environment.js';
import { parseChannel } from './utils/channel';
import manifestKeys from './manifest-keys.json';
const channel = parseChannel(
  process.env.AVRU_BUILD_CHANNEL ?? releaseChannel(),
);
export default defineConfig({
  outDir: `.output/${channel}`,
  vite: () => ({ define: { __AVRU_CHANNEL__: JSON.stringify(channel) } }),
  manifest: {
    name: channel === 'dev' ? '__MSG_nameDev__' : '__MSG_name__',
    description: '__MSG_description__',
    default_locale: 'en',
    key: manifestKeys[channel],
    version: '0.0.1',
    minimum_chrome_version: '116',
    permissions: ['storage', 'tabs', 'alarms'],
    host_permissions: ['http://127.0.0.1/*'],
  },
});
