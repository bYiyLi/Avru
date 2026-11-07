import { describe, expect, it } from 'vitest';
import { command } from '../src/command.js';
describe('scaffold CLI', () => {
  it.each(['--help', '-h'])(
    'provides help for %s without claiming installation',
    (flag) => {
      expect(command([flag]).code).toBe(0);
      expect(command([flag]).message).toContain('not implemented');
    },
  );
  it('reports an unreleased version', () => {
    expect(command(['--version'])).toEqual({
      code: 0,
      message: '0.0.0 (unreleased scaffold)',
    });
  });
  it.each([[], ['install'], ['uninstall'], ['--help', 'uninstall']])(
    'rejects unsupported arguments %j',
    (...args) => {
      expect(command(args).code).toBe(1);
      expect(command(args).message).toContain('No system changes');
    },
  );
});
