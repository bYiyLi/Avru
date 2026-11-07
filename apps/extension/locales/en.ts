export const en = {
  'popup.title': 'Avru browser connection',
  'popup.checking': 'Checking connection…',
  'popup.description':
    'Connect to sync regular web tab titles and addresses (without query strings, fragments, or private tabs). This version does not operate web pages.',
  'popup.endpoint': 'Local service',
  'popup.name': 'Browser / profile name',
  'popup.namePlaceholder': 'For example: Chrome Work',
  'popup.pairingHelp':
    'After connecting, compare the six-digit code in the local Avru management page and approve. No credentials need to be copied or entered.',
  'popup.pair': 'Pair',
  'popup.disconnect': 'Disconnect and clear local credentials',
  'popup.revokeHelp':
    'Clearing local credentials does not revoke the server registration. Revoke it in the management page to remove access completely.',
  'status.unpaired': 'Not paired',
  'status.connecting': 'Connecting',
  'status.connected': 'Connected',
  'status.pairing': 'Compare {code} in the local management page and approve',
  'status.rejected': 'Connection rejected or pairing expired. Pair again.',
  'status.reconnecting': 'Disconnected. Waiting to reconnect.',
  'status.protocolError': 'Protocol error. Pair again.',
  'status.requestFailed': 'Request failed. Check the connection settings.',
  'status.unavailable': 'Background service is not ready',
  'status.connectionFailed':
    'Connection failed. Check pairing details and the daemon.',
  'consent.title': 'Avru authorization',
  'consent.heading': 'Allow access to Avru?',
  'consent.description':
    'Approve only a request you initiated. This permits reading connected browser tab titles and addresses.',
  'consent.allow': 'Allow',
  'consent.deny': 'Deny',
  'consent.submitted': 'Decision submitted. Return to the requesting app.',
  'consent.disconnected': 'Disconnected. Start authorization again.',
  'consent.invalid':
    'No valid authorization request. Close this window and retry.',
  'consent.application': 'Application',
  'consent.redirectUri': 'Redirect URI',
  'consent.resource': 'Resource',
} as const;
export type MessageKey = keyof typeof en;
