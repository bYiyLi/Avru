import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { verifiedProgram } from './frpc-program.js';
import { admin, processExists, processIdentity } from './frpc-admin.js';
import type { ProcessIdentity } from './frpc-admin.js';
import type { ConnectionBundle } from './connection-bundle.js';
import { prepareProcess } from './frpc-config.js';
import { readPrivate, writePrivate, removePrivate } from './private-files.js';

export interface ConnectionDriver {
  start(bundle: ConnectionBundle): Promise<void>;
  stop(): Promise<void>;
  registered(): Promise<boolean>;
}
interface ProcessOptions {
  directory: string;
  payloadRoot: string;
  localPort: number;
  channel: 'dev' | 'prod';
  spawn?: (file: string, args: string[], options: SpawnOptions) => ChildProcess;
  verify?: typeof verifiedProgram;
}
export class FrpcProcess implements ConnectionDriver {
  private child: ChildProcess | undefined;
  private identity: ProcessIdentity | undefined;
  private exited = false;
  constructor(private readonly options: ProcessOptions) {}
  private get descriptor() {
    return join(this.options.directory, 'process.json');
  }
  async start(bundle: ConnectionBundle): Promise<void> {
    await this.stop();
    const program = await (this.options.verify ?? verifiedProgram)(
      this.options.payloadRoot,
    );
    const prepared = await prepareProcess(
      this.options.directory,
      bundle,
      this.options.localPort,
    );
    this.identity = prepared.identity;
    this.exited = false;
    const child = (this.options.spawn ?? spawn)(
      program,
      ['-c', prepared.configPath],
      {
        cwd: this.options.directory,
        env: prepared.env,
        stdio: 'ignore',
        windowsHide: true,
        shell: false,
      },
    );
    this.child = child;
    child.once('error', () => {
      this.exited = true;
    });
    child.once('exit', () => {
      this.exited = true;
    });
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('spawn', resolve);
    });
    this.identity.pid = child.pid ?? 0;
    try {
      await writePrivate(this.descriptor, JSON.stringify(this.identity));
    } catch (error) {
      await this.stop();
      throw error;
    }
  }
  async registered(): Promise<boolean> {
    if (this.exited) throw new Error('process_exited');
    if (!this.identity) return false;
    try {
      return await admin(this.identity);
    } catch {
      return false;
    }
  }
  async stop(): Promise<void> {
    if (this.child) await this.stopChild();
    else await this.recoverPrevious();
    this.child = undefined;
    this.identity = undefined;
    await removePrivate(this.descriptor);
    for (const name of ['frpc.json', 'ca.pem', 'certificate.pem', 'key.pem'])
      await removePrivate(join(this.options.directory, name));
  }
  private async stopChild(): Promise<void> {
    const child = this.child;
    if (!child || this.exited) return;
    child.kill('SIGTERM');
    for (let i = 0; i < 50 && !this.hasExited(); i++) await delay(100);
    if (!this.hasExited()) child.kill('SIGKILL');
    for (let i = 0; i < 20 && !this.hasExited(); i++) await delay(100);
    if (!this.hasExited()) throw new Error('ownership_unknown');
  }
  private hasExited(): boolean {
    return this.exited;
  }
  private async recoverPrevious(): Promise<void> {
    const identity = await this.previousIdentity();
    if (!identity) return;
    if (!identity.proxy.startsWith(`avru-${this.options.channel}-`))
      throw new Error('ownership_unknown');
    if (!processExists(identity.pid)) return;
    try {
      if (!(await admin(identity, false, true)))
        throw new Error('ownership_unknown');
      await admin(identity, true);
    } catch {
      throw new Error('ownership_unknown');
    }
    for (let i = 0; i < 50 && processExists(identity.pid); i++)
      await delay(100);
    if (processExists(identity.pid)) throw new Error('ownership_unknown');
  }
  private async previousIdentity(): Promise<ProcessIdentity | undefined> {
    try {
      const previous = await readPrivate(this.descriptor);
      return previous
        ? processIdentity(JSON.parse(previous) as unknown)
        : undefined;
    } catch {
      throw new Error('ownership_unknown');
    }
  }
}
