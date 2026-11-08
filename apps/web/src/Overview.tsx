import { Calls } from './Calls.js';
import { Connection } from './Connection.js';
import type { ConnectionActions } from './Connection.js';
import type { ViewState, BrowserProfile } from './controller.js';
import type { Actions } from './Pairings.js';
import { versionStatus } from './presentation.js';
import { translate as t, tabCount, number } from './i18n.js';
import type { Language } from './presentation.js';
function Version({
  browser,
  expected,
  locale,
}: {
  browser: BrowserProfile;
  expected: string | undefined;
  locale: Language;
}) {
  const metadata = browser.connected ? browser.metadata : null;
  const status = versionStatus(metadata?.extensionVersion, expected);
  const labels = {
    match: t(locale, 'version.match'),
    mismatch: t(locale, 'version.mismatch'),
    unknown: t(locale, 'common.unknown'),
  };
  return (
    <>
      <td>
        {reportedValue(metadata?.browserVersion, locale)}
        <small>{sourceLabel(metadata?.versionSource, locale)}</small>
      </td>
      <td>
        {metadata?.extensionVersion || '—'}
        <small className={status}>
          {labels[status]} ·{' '}
          {t(locale, 'version.expectedValue', { version: expected || '—' })}
        </small>
      </td>
    </>
  );
}
function BrowserRows({
  state,
  locale,
  revoke,
}: { state: ViewState; locale: Language } & Pick<Actions, 'revoke'>) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {[
              t(locale, 'browser.profile'),
              t(locale, 'browser.version'),
              t(locale, 'browser.extensionVersion'),
              t(locale, 'browser.status'),
              t(locale, 'browser.action'),
            ].map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {state.browsers.map((browser) => (
            <tr key={browser.id}>
              <td>
                <strong>{browser.name}</strong>
                <small>
                  {reportedValue(
                    browser.connected
                      ? browser.metadata?.browserName
                      : undefined,
                    locale,
                  )}
                </small>
                <small>{browser.id}</small>
                {browser.connected && (
                  <details>
                    <summary>{tabCount(locale, browser.tabs.length)}</summary>
                    <ul>
                      {browser.tabs.map((tab) => (
                        <li key={tab.id}>
                          <strong>{tab.title}</strong>
                          <small>{tab.url}</small>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </td>
              <Version
                browser={browser}
                expected={state.system?.expectedExtensionVersion}
                locale={locale}
              />
              <td>
                <span className={browser.connected ? 'match' : 'muted'}>
                  {browser.connected
                    ? t(locale, 'browser.online')
                    : t(locale, 'browser.offline')}
                </span>
                <small>{t(locale, 'browser.paired')}</small>
              </td>
              <td>
                <button
                  disabled={state.busy}
                  onClick={() => {
                    revoke(browser.id);
                  }}
                >
                  {t(locale, 'browser.revoke')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Overview({
  state,
  locale,
  revoke,
  connectionActions,
}: {
  state: ViewState;
  locale: Language;
  connectionActions?: ConnectionActions | undefined;
} & Pick<Actions, 'revoke'>) {
  const online = state.browsers.filter((browser) => browser.connected).length;
  return (
    <section className="overview">
      <p className="eyebrow">{t(locale, 'overview.eyebrow')}</p>
      <h1>{t(locale, 'overview.title')}</h1>
      <div className="metrics">
        <div>
          <span>{t(locale, 'overview.daemon')}</span>
          <strong>{state.system ? state.system.daemonVersion : '—'}</strong>
          <small>
            {state.system
              ? t(locale, 'overview.responding')
              : t(locale, 'overview.unconfirmed')}
          </small>
        </div>
        <div>
          <span>{t(locale, 'overview.browsers')}</span>
          <strong>
            {state.system
              ? `${number(locale, online)} / ${number(locale, state.browsers.length)}`
              : '—'}
          </strong>
          <small>
            {state.system
              ? t(locale, 'overview.onlinePaired')
              : t(locale, 'overview.unconfirmed')}
          </small>
        </div>
        <div>
          <span>MCP</span>
          <strong>
            {state.system?.mcp === 'oauthReadOnly'
              ? t(locale, 'overview.readOnly')
              : state.system
                ? t(locale, 'overview.disabled')
                : t(locale, 'overview.unconfirmed')}
          </strong>
          <small>{t(locale, 'overview.remoteNotice')}</small>
        </div>
      </div>
      <div className="section-heading">
        <h2>{t(locale, 'browser.title')}</h2>
        <span>{t(locale, 'version.comparison')}</span>
      </div>
      <BrowserContent state={state} locale={locale} revoke={revoke} />
      {state.system?.frpc === 'managed' ? (
        <Connection
          status={state.connection}
          locale={locale}
          busy={state.busy}
          actions={connectionActions}
        />
      ) : (
        <Capabilities locale={locale} />
      )}
      <Calls
        history={state.system ? (state.history ?? null) : null}
        locale={locale}
      />
    </section>
  );
}

function Capabilities({ locale }: { locale: Language }) {
  return (
    <div className="lower-grid">
      <section>
        <h2>{t(locale, 'channels.title')}</h2>
        {['ChatGPT', 'FRPC'].map((name) => (
          <details className="channel" key={name}>
            <summary>
              <strong>{name}</strong>
              <span>{t(locale, 'channels.unimplemented')} ＋</span>
            </summary>
            <p>{t(locale, 'channels.notice')}</p>
          </details>
        ))}
      </section>
    </div>
  );
}

function reportedValue(value: string | undefined, locale: Language) {
  return value && value !== 'Unknown' ? value : t(locale, 'common.unknown');
}
function sourceLabel(source: string | undefined, locale: Language) {
  if (source === 'userAgent') return t(locale, 'version.reduced');
  if (source === 'clientHints') return t(locale, 'version.reported');
  return t(locale, 'version.unavailable');
}

function BrowserContent({
  state,
  locale,
  revoke,
}: { state: ViewState; locale: Language } & Pick<Actions, 'revoke'>) {
  if (!state.system)
    return <p className="empty">{t(locale, 'browser.unavailable')}</p>;
  if (state.browsers.length)
    return <BrowserRows state={state} locale={locale} revoke={revoke} />;
  return <p className="empty">{t(locale, 'browser.empty')}</p>;
}
