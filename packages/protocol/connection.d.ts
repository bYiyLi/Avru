export type ConnectionState =
  | 'unconfigured'
  | 'applying'
  | 'connecting'
  | 'registered'
  | 'unavailable'
  | 'unknown';
export type ConnectionEventCode =
  | 'configuration_imported'
  | 'configuration_removed'
  | 'configuration_invalid'
  | 'configuration_conflict'
  | 'process_started'
  | 'process_exited'
  | 'process_stopped'
  | 'proxy_registered'
  | 'connection_unavailable'
  | 'ownership_unknown';
export interface ConnectionEvent {
  id: string;
  at: number;
  code: ConnectionEventCode;
}
export interface ConnectionStatus {
  state: ConnectionState;
  configured: boolean;
  issuer: string | null;
  mcpUrl: string | null;
  programVersion: string;
  programAvailable: boolean;
  verification: { publicEntry: 'notVerified'; chatgpt: 'notVerified' };
  events: ConnectionEvent[];
  retention: { limit: number; persistent: boolean };
}
