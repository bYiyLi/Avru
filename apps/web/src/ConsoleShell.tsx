import type { ViewState } from './controller.js';
import { translate as t } from './i18n.js';
import type { Language } from './presentation.js';
import type { Theme } from './preferences.js';
import './console-shell.css';

const LANGUAGE_BUTTON_KEYS = {
  zh: 'language.toEnglish',
  en: 'language.toChinese',
} as const;

export type ConsolePage =
  'overview' | 'browsers' | 'activity' | 'connection' | 'logs' | 'maintenance';

const PAGES = [
  { page: 'overview', label: 'overview.title' },
  { page: 'browsers', label: 'console.browser' },
  { page: 'activity', label: 'console.calls' },
  { page: 'connection', label: 'console.connection' },
  { page: 'logs', label: 'nav.logs' },
  { page: 'maintenance', label: 'console.maintenance' },
] as const;

const DESCRIPTIONS = {
  overview: 'overview.subtitle',
  browsers: 'browsers.description',
  activity: 'console.activityDescription',
  connection: 'console.connectionDescription',
  logs: 'logs.pageSubtitle',
  maintenance: 'console.maintenanceDescription',
} as const;

function NavIcon({ page }: { page: ConsolePage }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {page === 'overview' && (
        <>
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </>
      )}
      {page === 'browsers' && (
        <>
          <rect x="3" y="5" width="18" height="14" rx="1" />
          <path d="M3 9h18M7 7h.01" />
        </>
      )}
      {page === 'activity' && (
        <>
          <path d="M4 5h16M4 12h12M4 19h16" />
          <circle cx="19" cy="12" r="1" />
        </>
      )}
      {page === 'connection' && (
        <>
          <path d="M9 8H7a4 4 0 0 0 0 8h3m4-8h3a4 4 0 0 1 0 8h-3M8 12h8" />
        </>
      )}
      {page === 'logs' && (
        <>
          <path d="M4 5h16M4 12h16M4 19h12" />
        </>
      )}
      {page === 'maintenance' && (
        <>
          <path d="M4 6h16M4 12h16M4 18h16" />
          <path d="M9 3v6M15 9v6M9 15v6" />
        </>
      )}
    </svg>
  );
}

export function ConsoleNavigation({
  page,
  locale,
  theme,
  state,
  onNavigate,
  onWelcome,
  onSwitchTheme,
  onSwitchLocale,
}: {
  page: ConsolePage;
  locale: Language;
  theme: Theme;
  state: ViewState;
  onNavigate: (page: ConsolePage) => void;
  onWelcome: () => void;
  onSwitchTheme: () => void;
  onSwitchLocale: () => void;
}) {
  return (
    <nav className="console-nav" aria-label={t(locale, 'nav.label')}>
      <button
        className="console-brand"
        type="button"
        onClick={onWelcome}
        aria-label={t(locale, 'console.returnWelcome')}
      >
        <span className="console-brand-mark" aria-hidden="true">
          Λ
        </span>
        <strong>avru</strong>
        <span className="console-brand-badge">DEV</span>
      </button>
      <span className="console-nav-caption">
        {t(locale, 'console.workspace')}
      </span>
      <div className="console-nav-pages">
        {PAGES.map((item) => (
          <button
            type="button"
            key={item.page}
            aria-current={page === item.page ? 'page' : undefined}
            onClick={() => {
              onNavigate(item.page);
            }}
          >
            <span className="console-nav-icon">
              <NavIcon page={item.page} />
            </span>
            {t(locale, item.label)}
          </button>
        ))}
      </div>
      <div className="console-nav-footer">
        <span className="console-device">
          <NavIcon page="browsers" /> {t(locale, 'console.localWorkspace')}
        </span>
        <span className="console-version">
          {state.system?.daemonVersion ?? '—'}
          <small>{t(locale, 'console.preview')}</small>
        </span>
        <div className="console-preferences">
          <button type="button" onClick={onSwitchTheme}>
            {t(locale, theme === 'dark' ? 'theme.toLight' : 'theme.toDark')}
          </button>
          <button type="button" onClick={onSwitchLocale}>
            {t(locale, LANGUAGE_BUTTON_KEYS[locale])}
          </button>
        </div>
      </div>
    </nav>
  );
}

export function ConsoleTopbar({
  page,
  locale,
  state,
  onAddBrowser,
}: {
  page: ConsolePage;
  locale: Language;
  state: ViewState;
  onAddBrowser: () => void;
}) {
  const item = PAGES.find((entry) => entry.page === page);
  if (!item) return null;
  return (
    <header className="console-topbar">
      <div className="console-topbar-heading">
        <h1>{t(locale, item.label)}</h1>
        <p>{t(locale, DESCRIPTIONS[page])}</p>
      </div>
      <div className="console-topbar-actions">
        <span
          className={
            state.system ? 'console-live-state is-ready' : 'console-live-state'
          }
        >
          <i aria-hidden="true" />
          {t(
            locale,
            state.system ? 'console.liveStatus' : 'console.unknownStatus',
          )}
        </span>
        <button type="button" onClick={onAddBrowser}>
          ＋ {t(locale, 'overview.addBrowser')}
        </button>
      </div>
    </header>
  );
}
