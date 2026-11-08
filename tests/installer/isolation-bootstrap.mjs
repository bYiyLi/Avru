// Test process only: keep real CLI effects inside a temporary user directory.
import os from 'node:os';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

const testHome = process.env.AVRU_TEST_HOME;
const testRoot = process.env.AVRU_DATA_DIR;
const testPort = Number(process.env.AVRU_TEST_PORT);
if (
  !testHome ||
  !testRoot ||
  !isAbsolute(testHome) ||
  !isAbsolute(testRoot) ||
  !Number.isInteger(testPort) ||
  testPort < 1024 ||
  testPort > 65535
)
  throw new Error('Missing isolated installer test settings');
const within = relative(resolve(testHome), resolve(testRoot));
if (
  !within ||
  within === '..' ||
  within.startsWith(`..${sep}`) ||
  isAbsolute(within)
)
  throw new Error('Installer test root is not inside its temporary home');
os.homedir = () => testHome;
if (process.platform === 'win32')
  process.env.APPDATA = join(testHome, 'AppData', 'Roaming');
const spawn = childProcess.spawn;
childProcess.spawn = function (command, args, options) {
  if (command === 'open' || command === 'rundll32.exe')
    return spawn(process.execPath, ['-e', 'process.exit(0)'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  if (
    Array.isArray(args) &&
    typeof args[0] === 'string' &&
    basename(args[0]) === 'daemon.cjs'
  ) {
    const path = relative(resolve(testRoot), resolve(args[0]));
    if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path))
      throw new Error('Daemon path escaped installer test root');
    return spawn(command, args, {
      ...options,
      env: { ...options?.env, AVRU_PORT: String(testPort) },
    });
  }
  return spawn(command, args, options);
};
syncBuiltinESMExports();
