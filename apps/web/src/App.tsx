import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Controller, ViewState } from './controller.js';
import { language } from './presentation.js';
import { translate as t } from './i18n.js';
import type { Language } from './presentation.js';
import { Welcome } from './Welcome.js';
import { Install } from './Install.js';
import { Overview } from './Overview.js';
import { Pairings } from './Pairings.js';
import type { Actions } from './Pairings.js';
export function Dashboard({
  state,
  approve,
  reject,
  revoke,
  locale = 'zh',
}: { state: ViewState; locale?: Language } & Actions) {
  return (
    <>
      <Pairings
        state={state}
        locale={locale}
        approve={approve}
        reject={reject}
      />
      <Overview state={state} locale={locale} revoke={revoke} />
    </>
  );
}
export function App({
  controller,
  preferredLanguage = navigator.language,
  agent = navigator.userAgent,
}: {
  controller: Controller;
  preferredLanguage?: string;
  agent?: string;
}) {
  const locale = language(preferredLanguage);
  const [page, setPage] = useState<'welcome' | 'install' | 'overview'>(
    'welcome',
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot,
  );
  useEffect(() => {
    controller.start();
    return controller.stop;
  }, [controller]);
  useEffect(() => {
    if (page === 'install' && state.current?.status === 'detected')
      controller.connectCurrent().catch(controller.stop);
    return () => {};
  }, [controller, page, state.current?.status]);
  const actions = {
    approve: (id: string) => {
      controller.approve(id).catch(controller.stop);
    },
    reject: (id: string) => {
      controller.reject(id).catch(controller.stop);
    },
    revoke: (id: string) => {
      controller.revoke(id).catch(controller.stop);
    },
  };
  return (
    <div className="shell" lang={locale}>
      <Header locale={locale} />
      <main>
        <Navigation locale={locale} page={page} setPage={setPage} />
        <Notices locale={locale} state={state} />
        {page === 'welcome' && (
          <Welcome
            locale={locale}
            next={() => {
              setPage('install');
            }}
          />
        )}
        {page === 'install' && (
          <>
            <Install
              locale={locale}
              agent={agent}
              files={state.system?.extensionFiles ?? null}
              current={state.current}
              next={() => {
                setPage('overview');
              }}
            />
            {state.authorized && (
              <Pairings state={state} locale={locale} {...actions} />
            )}
          </>
        )}
        {page === 'overview' && state.authorized && (
          <Dashboard state={state} locale={locale} {...actions} />
        )}
      </main>
      <footer>
        <span>{t(locale, 'shell.preferences')}</span>
        <span>{t(locale, 'shell.footer')}</span>
      </footer>
    </div>
  );
}

function Header({ locale }: { locale: Language }) {
  return (
    <header>
      <div className="wordmark">
        <span className="mark" aria-hidden="true">
          Λ
        </span>{' '}
        avru
      </div>
      <span className="local">● {t(locale, 'shell.local')}</span>
    </header>
  );
}

function Navigation({
  locale,
  page,
  setPage,
}: {
  locale: Language;
  page: string;
  setPage: (page: 'welcome' | 'install' | 'overview') => void;
}) {
  return (
    <nav aria-label={t(locale, 'nav.label')}>
      <button
        onClick={() => {
          setPage('welcome');
        }}
      >
        {t(locale, 'nav.welcome')}
      </button>
      <button
        onClick={() => {
          setPage('install');
        }}
      >
        {t(locale, 'nav.install')}
      </button>
      <button
        onClick={() => {
          setPage('overview');
        }}
      >
        {t(locale, 'nav.overview')}
      </button>
      <span>
        {page === 'welcome' ? '1' : page === 'install' ? '2' : '3'} / 3
      </span>
    </nav>
  );
}

function Notices({ locale, state }: { locale: Language; state: ViewState }) {
  return (
    <>
      {' '}
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
