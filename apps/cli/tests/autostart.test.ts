import { describe, expect, it } from 'vitest';
import { planAutostart } from '../src/autostart.js';

const mac = {
  platform: 'darwin' as const,
  home: '/Users/Alice',
  execPath: '/Applications/Node & Tools/node',
  launcherPath: "/Users/Alice/Avru <stable>'/launcher.cjs",
};
const windows = {
  platform: 'win32' as const,
  home: 'C:\\Users\\Alice',
  execPath: 'C:\\Program Files\\nodejs\\node.exe',
  launcherPath: 'C:\\Users\\Alice\\Avru %data%! & Tools\\launcher.cjs',
};

describe('user-login autostart plans', () => {
  it('uses a macOS LaunchAgent and literal argument array, not a shell', () => {
    const result = planAutostart(mac);
    expect(result.label).toBe('ai.avru.daemon.dev');
    expect(result.filePath).toBe(
      '/Users/Alice/Library/LaunchAgents/ai.avru.daemon.dev.plist',
    );
    expect(result.content).toContain('<key>RunAtLoad</key><true/>');
    expect(result.content).toContain('/Applications/Node &amp; Tools/node');
    expect(result.content).toContain('Avru &lt;stable&gt;&apos;/launcher.cjs');
    expect(result.content).not.toContain('/bin/sh');
  });
  it('quotes Windows arguments and escapes percent expansions', () => {
    const result = planAutostart(windows);
    expect(result.filePath).toBe(
      'C:\\Users\\Alice\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\Avru-dev.cmd',
    );
    expect(result.content).toBe(
      '@echo off\r\nrem Avru managed user-login launcher\r\nsetlocal DisableDelayedExpansion\r\n"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\Alice\\Avru %%data%%! & Tools\\launcher.cjs"\r\n',
    );
  });
  it('uses redirected APPDATA when supplied', () => {
    const result = planAutostart({
      ...windows,
      roamingDir: 'D:\\Profile\\Roaming',
    });
    expect(result.filePath).toContain('D:\\Profile\\Roaming\\Microsoft');
    expect(() => planAutostart({ ...windows, roamingDir: 'relative' })).toThrow(
      'absolute',
    );
  });
  it('accepts fully qualified UNC executable paths', () => {
    const result = planAutostart({
      ...windows,
      execPath: '\\\\server\\share\\node.exe',
    });
    expect(result.content).toContain('"\\\\server\\share\\node.exe"');
  });
  it('rejects unsupported platforms without a misleading plan', () => {
    expect(() => planAutostart({ ...mac, platform: 'linux' })).toThrow(
      'macOS and Windows',
    );
  });
  it.each([
    'relative/node',
    '/Users/a\nnode',
    '/Users/a\u0000node',
    '/Users/a"node',
  ])('rejects unsafe macOS paths: %j', (execPath) => {
    expect(() => planAutostart({ ...mac, execPath })).toThrow('absolute');
  });
  it.each(['C:relative', '\\relative', 'C:\\bad\rnode', 'C:\\bad"node'])(
    'rejects unsafe Windows paths: %j',
    (launcherPath) => {
      expect(() => planAutostart({ ...windows, launcherPath })).toThrow(
        'absolute',
      );
    },
  );
  it('validates the home directory as well as program paths', () => {
    expect(() => planAutostart({ ...mac, home: '.' })).toThrow('absolute');
  });
});
