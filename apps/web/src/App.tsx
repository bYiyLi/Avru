import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Controller, ViewState, DiagnosticReport } from './controller.js';
import { translate as t } from './i18n.js';
import type { Language } from './presentation.js';
import {
  applyLocalePreference,
  applyThemePreference,
  initialLocale,
  initialTheme,
  otherLanguage,
  otherTheme,
  persistLocale,
  persistTheme,
  watchSystemTheme,
} from './preferences.js';
import type { Theme } from './preferences.js';
import { Welcome } from './Welcome.js';
import { Install, InstallHeader } from './Install.js';
import { Overview } from './Overview.js';
import { BrowsersPage } from './Browsers.js';
import { LogsPage } from './Logs.js';
import { EventLogsPage } from './EventLogs.js';
import { ConsoleNavigation, ConsoleTopbar } from './ConsoleShell.js';
import type { ConsolePage } from './ConsoleShell.js';
import { ConnectionsPage } from './WorkspacePages.js';
import type { ConnectionActions } from './Connection.js';

const LANGUAGE_BUTTON_KEYS = {
  zh: 'language.toEnglish',
  en: 'language.toChinese',
} as const;

export type Page = 'welcome' | 'install' | ConsolePage;
function isConsolePage(page: Page): page is ConsolePage {
  return page !== 'welcome' && page !== 'install';
}

export function Dashboard({
  state,
  locale = 'zh',
  onOpenLogs,
  onOpenBrowsers = onOpenLogs,
  onOpenActivity = onOpenLogs,
  onOpenConnection = onOpenLogs,
  onOpenInstall,
  runDiagnostics,
}: {
  state: ViewState;
  locale?: Language;
  connectionActions?: ConnectionActions;
  onOpenLogs: () => void;
  onOpenBrowsers?: () => void;
  onOpenActivity?: () => void;
  onOpenConnection?: () => void;
  onOpenInstall: (anchor?: string) => void;
  runDiagnostics: () => Promise<DiagnosticReport>;
}) {
  return (
    <Overview
      state={state}
      locale={locale}
      onOpenBrowsers={onOpenBrowsers}
      onOpenActivity={onOpenActivity}
      onOpenConnection={onOpenConnection}
      onOpenInstall={onOpenInstall}
      runDiagnostics={runDiagnostics}
    />
  );
}

export function App({
  controller,
  preferredLanguage = navigator.language,
}: {
  controller: Controller;
  preferredLanguage?: string;
}) {
  const [page, setPage] = useState<Page>(() =>
    globalThis.location.hash === '#overview' ? 'overview' : 'welcome',
  );
  const [installAnchor, setInstallAnchor] = useState<string | null>(null);
  const prefs = useHeaderPreferences(preferredLanguage);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot,
  );
  const goTo = (next: Page) => {
    setInstallAnchor(null);
    setPage(next);
  };
  const openInstall = (anchor?: string) => {
    setInstallAnchor(anchor ?? null);
    setPage('install');
  };
  useEffect(() => {
    controller.start();
    return controller.stop;
  }, [controller]);
  useEffect(() => {
    if (isConsolePage(page) && typeof window !== 'undefined')
      window.scrollTo(0, 0);
    return () => {};
  }, [page]);
  return (
    <div
      className={
        isConsolePage(page)
          ? 'shell shell--console'
          : page === 'install'
            ? 'shell shell--install'
            : 'shell'
      }
      lang={prefs.locale}
    >
      <AppHeader page={page} prefs={prefs} state={state} navigate={goTo} />
      <main>
        {isConsolePage(page) ? (
          <ConsoleTopbar
            page={page}
            locale={prefs.locale}
            state={state}
            onAddBrowser={() => {
              openInstall();
            }}
          />
        ) : page === 'welcome' ? (
          <Navigation locale={prefs.locale} page={page} setPage={goTo} />
        ) : null}
        <Notices locale={prefs.locale} state={state} />
        <StandalonePages
          page={page}
          state={state}
          locale={prefs.locale}
          installAnchor={installAnchor}
          goTo={goTo}
        />
        <WorkspacePages
          page={page}
          state={state}
          locale={prefs.locale}
          controller={controller}
          goTo={goTo}
          openInstall={openInstall}
        />
      </main>
      {page === 'welcome' && <AppFooter locale={prefs.locale} />}
    </div>
  );
}

function AppHeader({
  page,
  prefs,
  state,
  navigate,
}: {
  page: Page;
  prefs: ReturnType<typeof useHeaderPreferences>;
  state: ViewState;
  navigate: (page: Page) => void;
}) {
  if (isConsolePage(page))
    return (
      <ConsoleNavigation
        page={page}
        locale={prefs.locale}
        theme={prefs.theme}
        state={state}
        onNavigate={navigate}
        onWelcome={() => {
          navigate('welcome');
        }}
        onSwitchTheme={prefs.onSwitchTheme}
        onSwitchLocale={prefs.onSwitchLocale}
      />
    );
  if (page === 'install')
    return (
      <InstallHeader
        locale={prefs.locale}
        theme={prefs.theme}
        onOverview={() => {
          navigate('overview');
        }}
        onSwitchTheme={prefs.onSwitchTheme}
        onSwitchLocale={prefs.onSwitchLocale}
      />
    );
  return <Header {...prefs} />;
}

function StandalonePages({
  page,
  state,
  locale,
  installAnchor,
  goTo,
}: {
  page: Page;
  state: ViewState;
  locale: Language;
  installAnchor: string | null;
  goTo: (page: Page) => void;
}) {
  if (page === 'welcome')
    return (
      <Welcome
        locale={locale}
        history={state.system ? (state.history ?? null) : null}
        onOpenLogs={() => {
          goTo('logs');
        }}
        next={() => {
          goTo('overview');
        }}
      />
    );
  if (page === 'install')
    return (
      <Install
        locale={locale}
        files={state.system?.extensionFiles ?? null}
        browsers={state.browsers}
        expectedExtensionVersion={state.system?.expectedExtensionVersion}
        anchor={installAnchor}
        next={() => {
          goTo('overview');
        }}
      />
    );
  return null;
}

function WorkspacePages({
  page,
  state,
  locale,
  controller,
  goTo,
  openInstall,
}: {
  page: Page;
  state: ViewState;
  locale: Language;
  controller: Controller;
  goTo: (page: Page) => void;
  openInstall: (anchor?: string) => void;
}) {
  if (page === 'overview')
    return (
      <Dashboard
        state={state}
        locale={locale}
        onOpenLogs={() => {
          goTo('logs');
        }}
        onOpenBrowsers={() => {
          goTo('browsers');
        }}
        onOpenActivity={() => {
          goTo('activity');
        }}
        onOpenConnection={() => {
          goTo('connection');
        }}
        onOpenInstall={openInstall}
        runDiagnostics={() => controller.runDiagnostics()}
      />
    );
  if (page === 'browsers')
    return (
      <BrowsersPage
        state={state}
        locale={locale}
        onAddBrowser={() => {
          openInstall();
        }}
      />
    );
  if (page === 'activity')
    return (
      <LogsPage
        history={state.system ? (state.history ?? null) : null}
        locale={locale}
        onOpenInstall={() => {
          openInstall();
        }}
      />
    );
  if (page === 'connection')
    return (
      <ConnectionsPage state={state} locale={locale} actions={controller} />
    );
  if (page === 'logs')
    return (
      <EventLogsPage
        history={state.system ? (state.history ?? null) : null}
        locale={locale}
      />
    );
  return null;
}

function useHeaderPreferences(preferredLanguage: string) {
  const [locale, setLocale] = useState<Language>(
    initialLocale(preferredLanguage),
  );
  const [theme, setTheme] = useState<Theme>(initialTheme());
  useEffect(() => watchSystemTheme(setTheme), []);
  const switchTheme = () => {
    const next = otherTheme(theme);
    setTheme(next);
    persistTheme(next);
    applyThemePreference(next);
  };
  const switchLocale = () => {
    const next = otherLanguage(locale);
    setLocale(next);
    persistLocale(next);
    applyLocalePreference(next);
  };
  useEffect(() => {
    applyThemePreference(theme);
    return () => {};
  }, [theme]);
  useEffect(() => {
    applyLocalePreference(locale);
    return () => {};
  }, [locale]);
  return {
    locale,
    theme,
    onSwitchTheme: switchTheme,
    onSwitchLocale: switchLocale,
  };
}

function Header({
  locale,
  theme,
  onSwitchTheme,
  onSwitchLocale,
}: {
  locale: Language;
  theme: Theme;
  onSwitchTheme: () => void;
  onSwitchLocale: () => void;
}) {
  return (
    <header>
      <div className="wordmark">
        <span className="mark" aria-hidden="true">
          Λ
        </span>{' '}
        avru
      </div>
      <div className="header-actions">
        <button type="button" onClick={onSwitchTheme}>
          {t(locale, theme === 'dark' ? 'theme.toLight' : 'theme.toDark')}
        </button>
        <button type="button" onClick={onSwitchLocale}>
          {t(locale, LANGUAGE_BUTTON_KEYS[locale])}
        </button>
        <span className="local">● {t(locale, 'shell.local')}</span>
      </div>
    </header>
  );
}

function Navigation({
  locale,
  page,
  setPage,
}: {
  locale: Language;
  page: Page;
  setPage: (page: Page) => void;
}) {
  return (
    <nav aria-label={t(locale, 'nav.label')}>
      {(['welcome', 'overview', 'browsers', 'install', 'logs'] as const).map(
        (target) => (
          <button
            key={target}
            type="button"
            aria-current={page === target ? 'page' : undefined}
            onClick={() => {
              setPage(target);
            }}
          >
            {t(locale, `nav.${target}`)}
          </button>
        ),
      )}
    </nav>
  );
}

function Notices({ locale, state }: { locale: Language; state: ViewState }) {
  return (
    <>
      {!state.authorized && (
        <p role="alert" className="notice">
          {t(locale, 'session.reopen')}
        </p>
      )}
      {state.message && (
        <p role="status" className="notice">
          {t(locale, state.message)}
        </p>
      )}
    </>
  );
}

function AppFooter({ locale }: { locale: Language }) {
  return (
    <footer>
      <span>{t(locale, 'shell.preferences')}</span>
      <span>{t(locale, 'shell.footer')}</span>
    </footer>
  );
}
