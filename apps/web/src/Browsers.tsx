import type { BrowserProfile, ViewState } from './controller.js';
import { translate as t, tabCount } from './i18n.js';
import type { Language } from './presentation.js';
import { versionStatus } from './presentation.js';
import { shortBrowserId } from './Overview.js';

export function browserSummary(state: ViewState) {
  if (!state.system) return null;
  return {
    total: state.browsers.length,
    online: state.browsers.filter((browser) => browser.connected).length,
  };
}

function reported(value: string | undefined, locale: Language) {
  return value && value !== 'Unknown' ? value : t(locale, 'common.unknown');
}

function BrowserRow({
  browser,
  expected,
  locale,
}: {
  browser: BrowserProfile;
  expected: string | undefined;
  locale: Language;
}) {
  const metadata = browser.connected ? browser.metadata : null;
  const name = reported(metadata?.browserName, locale);
  const label = name === t(locale, 'common.unknown') ? browser.name : name;
  const profile =
    label === browser.name
      ? t(locale, 'browsers.profileId', { id: shortBrowserId(browser.id) })
      : browser.name;
  const version = browser.connected
    ? versionStatus(metadata?.extensionVersion, expected)
    : 'unknown';
  const checkKey =
    version === 'match'
      ? 'version.match'
      : version === 'mismatch'
        ? 'browsers.updateSuggested'
        : 'browsers.pending';
  const versionSource =
    metadata?.versionSource === 'clientHints'
      ? 'version.reported'
      : metadata?.versionSource === 'userAgent'
        ? 'version.reduced'
        : 'version.unavailable';
  return (
    <tr>
      <td>
        <details className="browser-profile-details">
          <summary>
            <strong>{label}</strong>
            <span>{profile}</span>
          </summary>
          <div className="browser-profile-extra">
            <code>{browser.id}</code>
            {browser.connected && browser.tabs.length > 0 && (
              <>
                <p>{tabCount(locale, browser.tabs.length)}</p>
                <ul>
                  {browser.tabs.map((tab) => (
                    <li key={tab.id}>
                      <strong>{tab.title}</strong>
                      <small>{tab.url}</small>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </details>
      </td>
      <td>
        <span
          className={`browser-connection ${browser.connected ? 'browser-connection--online' : ''}`}
        >
          <i aria-hidden="true" />
          {t(locale, browser.connected ? 'browser.online' : 'browser.offline')}
        </span>
      </td>
      <td title={t(locale, versionSource)}>
        {reported(metadata?.browserVersion, locale)}
      </td>
      <td>{reported(metadata?.extensionVersion, locale)}</td>
      <td>
        <span className={`browser-check browser-check--${version}`}>
          {t(locale, checkKey)}
        </span>
      </td>
      <td className="browser-last-response">{t(locale, 'common.unknown')}</td>
    </tr>
  );
}

export function BrowsersPage({
  state,
  locale,
  onAddBrowser,
}: {
  state: ViewState;
  locale: Language;
  onAddBrowser: () => void;
}) {
  const summary = browserSummary(state);
  return (
    <section className="browsers-page" id="browsers-page">
      <div className="browser-page-heading">
        <div>
          <h1>{t(locale, 'browsers.title')}</h1>
          <p>{t(locale, 'browsers.description')}</p>
        </div>
        <div className="browser-page-actions">
          <span className="browser-data-indicator">
            <i className={summary ? 'is-current' : ''} aria-hidden="true" />
            {t(locale, summary ? 'browsers.current' : 'common.unknown')}
          </span>
          <button type="button" onClick={onAddBrowser}>
            <span aria-hidden="true">＋</span> {t(locale, 'browsers.add')}
          </button>
        </div>
      </div>
      <div className="browser-table-section">
        <p className="browser-count">
          {summary
            ? t(locale, 'browsers.count', {
                total: summary.total,
                online: summary.online,
              })
            : t(locale, 'browsers.countUnknown')}
        </p>
        {!summary ? (
          <p className="browser-page-empty" role="status">
            {t(locale, 'browser.unavailable')}
          </p>
        ) : summary.total === 0 ? (
          <p className="browser-page-empty" role="status">
            {t(locale, 'browser.empty')}
          </p>
        ) : (
          <div className="browser-table-scroll">
            <table className="browser-table">
              <thead>
                <tr>
                  {(
                    [
                      'browser.profile',
                      'browser.status',
                      'browser.version',
                      'browser.extensionVersion',
                      'browsers.versionCheck',
                      'browsers.lastResponse',
                    ] as const
                  ).map((key) => (
                    <th key={key} scope="col">
                      {t(locale, key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.browsers.map((browser) => (
                  <BrowserRow
                    key={browser.id}
                    browser={browser}
                    expected={state.system?.expectedExtensionVersion}
                    locale={locale}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="browser-table-note">
          {t(locale, 'browsers.versionNote', {
            version: state.system?.expectedExtensionVersion
              ? state.system.expectedExtensionVersion
              : t(locale, 'common.unknown'),
          })}
        </p>
      </div>
    </section>
  );
}
