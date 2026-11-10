import { useState } from 'react';
import type { ConnectionStatus } from '../../../packages/protocol/connection.d.ts';
import type { Language } from './presentation.js';
import { translate as t, timestamp } from './i18n.js';
export interface ConnectionActions {
  importConnection(raw: unknown): Promise<void>;
  clearConnection(): Promise<void>;
}
export async function connectionFile(
  file: Pick<File, 'size' | 'text'>,
): Promise<unknown> {
  if (file.size > 262144) throw new Error('connection.fileInvalid');
  return JSON.parse(await file.text()) as unknown;
}
export function Connection({
  status,
  locale,
  busy,
  actions,
}: {
  status: ConnectionStatus | null | undefined;
  locale: Language;
  busy: boolean;
  actions?: ConnectionActions | undefined;
}) {
  const [message, setMessage] = useState<
    'connection.fileInvalid' | 'connection.saved' | ''
  >('');
  const importFile = (input: HTMLInputElement) => {
    const file = input.files?.[0];
    if (!file || !actions) return;
    setMessage('');
    connectionFile(file)
      .then((raw) => actions.importConnection(raw))
      .then(() => {
        setMessage('connection.saved');
      })
      .catch(() => {
        setMessage('connection.fileInvalid');
      })
      .finally(() => {
        input.value = '';
      });
  };
  return (
    <section className="connection-settings" id="connection">
      <div className="section-heading">
        <h2>{t(locale, 'connection.title')}</h2>
        <span>
          {status
            ? t(locale, `connection.state.${status.state}`)
            : t(locale, 'connection.unavailable')}
        </span>
      </div>
      <p>{t(locale, 'connection.description')}</p>
      {status && (
        <>
          <ConnectionSummary status={status} locale={locale} />
          <p className="muted">{t(locale, 'connection.notVerified')}</p>
          <div className="connection-actions">
            <label>
              {t(locale, 'connection.import')}
              <input
                type="file"
                accept=".json,application/json"
                disabled={busy || !actions}
                onChange={(event) => {
                  importFile(event.currentTarget);
                }}
              />
            </label>
            <button
              disabled={busy || !actions || !status.configured}
              onClick={() => {
                actions?.clearConnection().catch(() => {
                  setMessage('connection.fileInvalid');
                });
              }}
            >
              {t(locale, 'connection.remove')}
            </button>
            {busy && status.configured && (
              <span className="muted">
                {t(locale, 'connection.removeBusy')}
              </span>
            )}
            {!status.configured && (
              <span className="muted">
                {t(locale, 'connection.removeNotConfigured')}
              </span>
            )}
          </div>
          <ConnectionActivity status={status} locale={locale} />
        </>
      )}
      {message && (
        <p role={message === 'connection.fileInvalid' ? 'alert' : 'status'}>
          {t(locale, message)}
        </p>
      )}
    </section>
  );
}
function ConnectionSummary({
  status,
  locale,
}: {
  status: ConnectionStatus;
  locale: Language;
}) {
  return (
    <>
      <p>
        {t(locale, 'connection.program', { version: status.programVersion })} ·{' '}
        {status.programAvailable
          ? t(locale, 'connection.prepared')
          : t(locale, 'connection.programMissing')}
      </p>
      {status.mcpUrl && (
        <p>
          <span>{t(locale, 'connection.address')}</span>{' '}
          <code>{status.mcpUrl}</code>
        </p>
      )}
    </>
  );
}
function ConnectionActivity({
  status,
  locale,
}: {
  status: ConnectionStatus;
  locale: Language;
}) {
  return (
    status.events.length > 0 && (
      <details>
        <summary>{t(locale, 'connection.activity')}</summary>
        <ol>
          {status.events.map((event) => (
            <li key={event.id}>
              <time dateTime={new Date(event.at).toISOString()}>
                {timestamp(locale, event.at)}
              </time>{' '}
              {t(locale, `connection.event.${event.code}`)}
            </li>
          ))}
        </ol>
      </details>
    )
  );
}
