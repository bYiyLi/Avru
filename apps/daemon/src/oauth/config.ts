export interface OAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
}
export interface OAuthConfig {
  issuer: string;
  clients: OAuthClient[];
}
export const scope = 'browser:read';
export function validateConfig(config: OAuthConfig): OAuthConfig {
  const issuer = new URL(config.issuer);
  if (issuer.protocol !== 'https:' || issuer.origin !== config.issuer)
    throw new Error('OAuth issuer must be an exact HTTPS origin');
  if (!config.clients.length || config.clients.length > 20)
    throw new Error('Configure 1–20 trusted OAuth clients');
  const ids = new Set<string>();
  for (const client of config.clients) {
    if (
      !client.id ||
      client.id.length > 256 ||
      ids.has(client.id) ||
      !client.name ||
      client.name.length > 80 ||
      !client.redirectUris.length ||
      client.redirectUris.length > 10
    )
      throw new Error('Invalid OAuth client');
    ids.add(client.id);
    for (const redirect of client.redirectUris) {
      const uri = new URL(redirect);
      if (
        uri.protocol !== 'https:' ||
        uri.username ||
        uri.password ||
        uri.hash ||
        uri.search ||
        uri.href !== redirect
      )
        throw new Error('Invalid redirect URI');
    }
  }
  return structuredClone(config);
}
export function parameters(raw: unknown): URLSearchParams {
  if (typeof raw !== 'string' || raw.length > 8192)
    throw new Error('invalid_request');
  const values = new URLSearchParams(raw);
  const seen = new Set<string>();
  for (const [key, value] of values) {
    if (seen.has(key) || value.length > 2048)
      throw new Error('invalid_request');
    seen.add(key);
  }
  return values;
}
