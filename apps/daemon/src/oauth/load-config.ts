import { readFile } from 'node:fs/promises';
import { record } from '../messages.js';
import { validateConfig } from './config.js';
import type { OAuthConfig } from './config.js';
export async function loadOAuthConfig(
  path: string | undefined,
): Promise<(OAuthConfig & { port: number }) | undefined> {
  if (!path) return undefined;
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (
    !record(raw) ||
    typeof raw.issuer !== 'string' ||
    !Array.isArray(raw.clients) ||
    typeof raw.port !== 'number' ||
    !Number.isInteger(raw.port) ||
    raw.port < 1024 ||
    raw.port > 65535
  )
    throw new Error('Invalid OAuth configuration');
  const clients = raw.clients.map((item: unknown) => {
    if (
      !record(item) ||
      typeof item.id !== 'string' ||
      typeof item.name !== 'string' ||
      !Array.isArray(item.redirectUris) ||
      !item.redirectUris.every((uri: unknown) => typeof uri === 'string')
    )
      throw new Error('Invalid OAuth client configuration');
    return {
      id: item.id,
      name: item.name,
      redirectUris: item.redirectUris,
    };
  });
  return { ...validateConfig({ issuer: raw.issuer, clients }), port: raw.port };
}
