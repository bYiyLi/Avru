import { describe, expect, it } from 'vitest';
import { command } from '../src/command.js';
describe('scaffold CLI', () => {
  it('provides help without claiming installation', () => {
    expect(command(['--help']).code).toBe(0);
    expect(command(['--help']).message).toContain('not implemented');
  });
  it.each([[], ['install'], ['uninstall'], ['--help', 'uninstall']])(
    'rejects unsupported arguments %j',
    (...args) => {
      expect(command(args).code).toBe(1);
      expect(command(args).message).toContain('No system changes');
    },
  );
});
