import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Controller, ViewState } from './controller.js';
import { language, translate as t } from './presentation.js';
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
        <span>
          {t(
            locale,
            '外观随系统 · 语言随浏览器首选语言',
            'System appearance · Browser language',
          )}
        </span>
        <span>AVRU / LOCAL</span>
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
      <span className="local">
        ● {t(locale, '本地优先', 'LOCAL BY DESIGN')}
      </span>
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
    <nav aria-label={t(locale, '安装步骤', 'Setup steps')}>
      <button
        onClick={() => {
          setPage('welcome');
        }}
      >
        {t(locale, '欢迎', 'Welcome')}
      </button>
      <button
        onClick={() => {
          setPage('install');
        }}
      >
        {t(locale, '安装扩展', 'Install extension')}
      </button>
      <button
        onClick={() => {
          setPage('overview');
        }}
      >
        {t(locale, '总览', 'Overview')}
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
          {t(
            locale,
            '请重新打开守护进程启动时提供的管理链接。',
            'Reopen the private management link provided by the daemon.',
          )}
        </p>
      )}
      {state.message && (
        <p role="status" className="notice">
          {locale === 'zh'
            ? state.message
            : 'Connection or request could not be confirmed. Check the daemon and reopen its management link if needed.'}
        </p>
      )}
    </>
  );
}
