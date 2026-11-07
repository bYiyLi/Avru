import { record } from './protocol';
import { pairingText, text } from './i18n';
import type { Locale } from './i18n';
const states = [
  'unpaired',
  'connecting',
  'connected',
  'rejected',
  'reconnecting',
  'protocolError',
  'requestFailed',
] as const;
export type ConnectionStatus =
  { code: (typeof states)[number] } | { code: 'pairing'; pairingCode: string };
export function statusText(locale: Locale, value: unknown): string {
  const state = record(value);
  if (
    state?.code === 'pairing' &&
    typeof state.pairingCode === 'string' &&
    /^\d{6}$/.test(state.pairingCode)
  )
    return pairingText(locale, state.pairingCode);
  const code = states.find((candidate) => candidate === state?.code);
  return text(locale, code ? `status.${code}` : 'status.unavailable');
}
