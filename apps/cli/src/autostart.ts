import { releaseChannel } from '../../../packages/protocol/environment.js';
import type { ReleaseChannel } from './channel-root.js';
import { posix, win32 } from 'node:path';

export interface AutostartOptions {
  platform: NodeJS.Platform;
  channel?: ReleaseChannel;
  home: string;
  execPath: string;
  launcherPath: string;
  roamingDir?: string;
}

export interface AutostartPlan {
  filePath: string;
  content: string;
  label: string;
}

export const autostartMarker = 'Avru managed user-login launcher';

function unsafeCharacters(value: string): boolean {
  for (const character of value) {
    if (character.charCodeAt(0) < 32 || character === '"') return true;
  }
  return false;
}

function validatePath(value: string, windows: boolean): void {
  const absolute = windows
    ? /^(?:[a-z]:\\|\\\\[^\\]+\\[^\\]+\\)/iu.test(value)
    : posix.isAbsolute(value);
  if (!absolute || unsafeCharacters(value)) {
    throw new Error(
      'Autostart paths must be absolute and contain no control characters or quotes',
    );
  }
}

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll("'", '&apos;');
}

/** Describe user-login startup only. This function does not install or load a service. */
export function planAutostart(options: AutostartOptions): AutostartPlan {
  const { platform, home, execPath, launcherPath } = options;
  const channel = options.channel ?? releaseChannel();
  const label = `ai.avru.daemon.${channel}`;
  if (platform !== 'darwin' && platform !== 'win32') {
    throw new Error('Avru autostart supports macOS and Windows only');
  }
  const windows = platform === 'win32';
  for (const value of [home, execPath, launcherPath])
    validatePath(value, windows);
  if (windows) {
    const roamingDir =
      options.roamingDir ?? win32.join(home, 'AppData', 'Roaming');
    validatePath(roamingDir, true);
    // Percent expansion still happens inside CMD quotes; delayed expansion is disabled.
    const quote = (value: string): string => `"${value.replaceAll('%', '%%')}"`;
    return {
      label,
      filePath: win32.join(
        roamingDir,
        'Microsoft',
        'Windows',
        'Start Menu',
        'Programs',
        'Startup',
        `Avru-${channel}.cmd`,
      ),
      content: `@echo off\r\nrem ${autostartMarker}\r\nsetlocal DisableDelayedExpansion\r\n${quote(execPath)} ${quote(launcherPath)}\r\n`,
    };
  }
  return {
    label,
    filePath: posix.join(home, 'Library', 'LaunchAgents', `${label}.plist`),
    content: `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<!-- ${autostartMarker} -->\n<plist version="1.0"><dict>\n<key>Label</key><string>${label}</string>\n<key>ProgramArguments</key><array><string>${xml(execPath)}</string><string>${xml(launcherPath)}</string></array>\n<key>RunAtLoad</key><true/>\n</dict></plist>\n`,
  };
}
