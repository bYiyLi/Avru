import { useEffect, useState } from 'react';
import { copyText } from './Calls.js';
import type { BrowserProfile, ExtensionFiles } from './controller.js';
import type { Language } from './presentation.js';
import type { Theme } from './preferences.js';
import { translate as t } from './i18n.js';
import { INSTALL_VERSION_ANCHOR, scrollToSection } from './scroll.js';
import './install.css';
export type InstallStepStatus = 'ready' | 'connected' | 'unknown';
export function installFilesStatus(
  files: ExtensionFiles | null | undefined,
): InstallStepStatus {
  return files ? 'ready' : 'unknown';
}
export function installBrowserStatus(browsers: BrowserProfile[]): {
  status: InstallStepStatus;
  name: string | null;
} {
  const connected = browsers.find((browser) => browser.connected);
  return {
    status: connected ? 'connected' : 'unknown',
    name: connected?.metadata?.browserName ?? null,
  };
}
export function installVersionStatus(
  browsers: BrowserProfile[],
  expected: string | undefined,
): { status: InstallStepStatus; actual: string | undefined } {
  const actual = browsers
    .filter((browser) => browser.connected)
    .map((browser) => browser.metadata?.extensionVersion)
    .find((version) => version);
  if (!actual || !expected) return { status: 'unknown', actual };
  return { status: actual === expected ? 'ready' : 'unknown', actual };
}
function statusLabel(status: InstallStepStatus, locale: Language): string {
  if (status === 'ready') return t(locale, 'install.status.ready');
  if (status === 'connected') return t(locale, 'install.status.connected');
  return t(locale, 'common.unknown');
}
function displayName(name: string | null, locale: Language): string {
  return name && name !== 'Unknown' ? name : t(locale, 'common.unknown');
}
type BrowserChoice = 'Chrome' | 'Edge';
const MANAGER_ADDRESSES: Record<BrowserChoice, string> = {
  Chrome: 'chrome://extensions/',
  Edge: 'edge://extensions/',
};
const INSTALL_STEP_KEYS = [
  'install.openExtensions',
  'install.prepareExtension',
  'install.loadAndCheck',
] as const;
const INSTALL_LANGUAGE_SWITCH_KEYS = {
  zh: 'language.toEnglish',
  en: 'language.toChinese',
} as const;

export function InstallHeader({
  locale,
  theme,
  onOverview,
  onSwitchTheme,
  onSwitchLocale,
}: {
  locale: Language;
  theme: Theme;
  onOverview: () => void;
  onSwitchTheme: () => void;
  onSwitchLocale: () => void;
}) {
  return (
    <header className="install-site-header">
      <div className="install-wordmark">
        <span aria-hidden="true">Λ</span> avru
      </div>
      <nav aria-label={t(locale, 'nav.label')}>
        <span aria-current="page">{t(locale, 'install.navTitle')}</span>
        <button type="button" onClick={onOverview}>
          {t(locale, 'install.navOverview')}
        </button>
        <button type="button" onClick={onSwitchTheme}>
          {t(locale, theme === 'dark' ? 'theme.toLight' : 'theme.toDark')}
        </button>
        <button type="button" onClick={onSwitchLocale}>
          {t(locale, INSTALL_LANGUAGE_SWITCH_KEYS[locale])}
        </button>
      </nav>
    </header>
  );
}

function ManagerAddress({
  browser,
  locale,
}: {
  browser: BrowserChoice;
  locale: Language;
}) {
  const address = MANAGER_ADDRESSES[browser];
  const [copied, setCopied] = useState('');
  const [failed, setFailed] = useState(false);
  const copyAddress = () => {
    setCopied('');
    setFailed(false);
    void copyText(address).then(
      (ok) => {
        if (ok) setCopied(address);
        else setFailed(true);
      },
      () => {
        setFailed(true);
      },
    );
  };
  return (
    <div className="install-address-block">
      <div className="install-address-row">
        <code className="selectable">{address}</code>
        <button type="button" onClick={copyAddress}>
          {t(locale, 'install.copyAddressButton')}
        </button>
      </div>
      {copied === address && (
        <p role="status">{t(locale, 'install.addressCopied')}</p>
      )}
      {failed && <p role="status">{t(locale, 'install.addressCopyFailed')}</p>}
      <small>
        Chrome: {MANAGER_ADDRESSES.Chrome} · Edge: {MANAGER_ADDRESSES.Edge}
      </small>
    </div>
  );
}

function InstallStepRail({
  locale,
  step,
  onSelect,
}: {
  locale: Language;
  step: number;
  onSelect: (step: number) => void;
}) {
  return (
    <nav
      className="install-step-rail"
      aria-label={t(locale, 'install.stepsLabel')}
    >
      <span className="install-rail-title">
        {t(locale, 'install.railTitle')}
      </span>
      {INSTALL_STEP_KEYS.map((key, index) => (
        <button
          type="button"
          key={key}
          className={step === index ? 'is-active' : ''}
          aria-current={step === index ? 'step' : undefined}
          onClick={() => {
            onSelect(index);
          }}
        >
          <span className="install-step-number">0{index + 1}</span>
          <span>
            <strong>{t(locale, key)}</strong>
            <small>{t(locale, 'install.guideLabel')}</small>
          </span>
        </button>
      ))}
      <p className="install-rail-note">{t(locale, 'install.noAutoInstall')}</p>
    </nav>
  );
}

function InstallStepContent({
  locale,
  step,
  browserChoice,
  files,
  browsers,
  expected,
}: {
  locale: Language;
  step: number;
  browserChoice: BrowserChoice;
  files: ExtensionFiles | null;
  browsers: BrowserProfile[];
  expected: string | undefined;
}) {
  if (step === 0)
    return (
      <section className="install-step-copy">
        <h2>{t(locale, 'install.openHeading')}</h2>
        <p>
          {t(locale, 'install.openDescription', { browser: browserChoice })}
        </p>
        <ManagerAddress locale={locale} browser={browserChoice} />
      </section>
    );
  if (step === 1)
    return (
      <section className="install-step-copy">
        <h2>{t(locale, 'install.prepareHeading')}</h2>
        <p>{t(locale, 'install.loadInstructions')}</p>
        <p className="install-step-meta">
          {t(locale, 'install.stepFiles')}:{' '}
          {statusLabel(installFilesStatus(files), locale)}
        </p>
        {files ? (
          <>
            <code
              className="install-folder-path selectable"
              aria-label={t(locale, 'install.directory')}
            >
              {files.directory}
            </code>
            <p>{t(locale, 'install.pathHelp')}</p>
            <p>{t(locale, 'install.reload')}</p>
          </>
        ) : (
          <>
            <p>{t(locale, 'install.filesUnconfirmed')}</p>
            <p>{t(locale, 'install.defaultDirectories')}</p>
          </>
        )}
      </section>
    );
  const connected = installBrowserStatus(browsers);
  const version = installVersionStatus(browsers, expected);
  return (
    <section className="install-step-copy" id={INSTALL_VERSION_ANCHOR}>
      <h2>{t(locale, 'install.checkHeading')}</h2>
      <p>{t(locale, 'install.automaticConnection')}</p>
      <p className="install-step-meta">
        {t(locale, 'install.stepBrowser')}:{' '}
        {statusLabel(connected.status, locale)}
      </p>
      <p>
        {t(locale, 'install.currentBrowser', {
          name: displayName(connected.name, locale),
        })}
      </p>
      <p className="install-step-meta">
        {t(locale, 'install.stepVersion')}:{' '}
        {statusLabel(version.status, locale)}
      </p>
      <p>
        {t(locale, 'install.version', {
          actual: version.actual ?? t(locale, 'common.unknown'),
          expected: expected ?? t(locale, 'common.unknown'),
        })}
      </p>
      <p>{t(locale, 'install.versionHelp')}</p>
    </section>
  );
}

function InstallIllustration({
  locale,
  browser,
  step,
}: {
  locale: Language;
  browser: BrowserChoice;
  step: number;
}) {
  return (
    <div className="install-illustration" aria-hidden="true">
      <div className="install-illustration-top">
        <span className="install-dots">● ● ●</span>
        <code>{MANAGER_ADDRESSES[browser]}</code>
      </div>
      <div className="install-faux-browser">
        <div className="install-faux-heading">
          <strong>{t(locale, 'install.mockExtensions')}</strong>
          <span>
            {t(locale, 'install.mockDevMode')}{' '}
            <i className="install-faux-toggle" />
          </span>
        </div>
        <span
          className={`install-faux-load ${step === 1 ? 'is-highlighted' : ''}`}
        >
          ＋ {t(locale, 'install.mockLoadUnpacked')}
        </span>
        <div
          className={`install-faux-extension ${step === 2 ? 'is-highlighted' : ''}`}
        >
          <span className="install-faux-icon">▣</span>
          <span>
            <strong>Avru</strong>
            <small>{t(locale, 'install.mockSample')}</small>
          </span>
          <i className="install-faux-toggle" />
        </div>
      </div>
    </div>
  );
}

function InstallGuideBody({
  locale,
  step,
  browserChoice,
  files,
  browsers,
  expected,
  next,
  onStep,
}: {
  locale: Language;
  step: number;
  browserChoice: BrowserChoice;
  files: ExtensionFiles | null;
  browsers: BrowserProfile[];
  expected: string | undefined;
  next: () => void;
  onStep: (step: number) => void;
}) {
  return (
    <div className="install-guide-body">
      <InstallStepContent
        locale={locale}
        step={step}
        browserChoice={browserChoice}
        files={files}
        browsers={browsers}
        expected={expected}
      />
      <InstallIllustration
        locale={locale}
        browser={browserChoice}
        step={step}
      />
      <div className="install-step-actions">
        {step > 0 ? (
          <button
            type="button"
            onClick={() => {
              onStep(step - 1);
            }}
          >
            {t(locale, 'install.previous')}
          </button>
        ) : (
          <span />
        )}
        {step === 2 ? (
          <button type="button" className="primary" onClick={next}>
            {t(locale, 'install.overview')} →
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            onClick={() => {
              onStep(step + 1);
            }}
          >
            {t(locale, 'install.next')} →
          </button>
        )}
      </div>
      <p className="install-guide-note">{t(locale, 'install.noAutoInstall')}</p>
    </div>
  );
}

export function Install({
  locale,
  files = null,
  browsers = [],
  expectedExtensionVersion,
  anchor = null,
  next,
}: {
  locale: Language;
  files?: ExtensionFiles | null;
  browsers?: BrowserProfile[];
  expectedExtensionVersion?: string | undefined;
  anchor?: string | null;
  next: () => void;
}) {
  const [step, setStep] = useState(anchor === INSTALL_VERSION_ANCHOR ? 2 : 0);
  const [browserChoice, setBrowserChoice] = useState<BrowserChoice>('Chrome');
  useEffect(() => {
    if (anchor === INSTALL_VERSION_ANCHOR) setStep(2);
    return () => {};
  }, [anchor]);
  useEffect(() => {
    if (step === 2 && anchor === INSTALL_VERSION_ANCHOR)
      scrollToSection(INSTALL_VERSION_ANCHOR);
    return () => {};
  }, [step, anchor]);
  return (
    <section className="install install-guide">
      <div className="install-breadcrumb">
        <span>
          AVRU <i>/</i> {t(locale, 'install.navTitle')}
        </span>
        <span className="install-guide-badge">
          {t(locale, 'install.localGuide')}
        </span>
      </div>
      <div className="install-introduction">
        <div>
          <p className="install-eyebrow">
            {t(locale, 'install.heroEyebrow', {
              browser: browserChoice.toUpperCase(),
            })}
          </p>
          <h1>{t(locale, 'install.heroTitle')}</h1>
          <p>
            {t(locale, 'install.heroDescription', { browser: browserChoice })}
          </p>
        </div>
        <div
          className="install-browser-choice"
          role="group"
          aria-label={t(locale, 'install.browserChoice')}
        >
          {(['Chrome', 'Edge'] as const).map((choice) => (
            <button
              type="button"
              key={choice}
              aria-pressed={browserChoice === choice}
              onClick={() => {
                setBrowserChoice(choice);
              }}
            >
              {choice === 'Edge' ? 'Microsoft Edge' : choice}
            </button>
          ))}
        </div>
      </div>
      <div className="install-guide-grid">
        <InstallStepRail locale={locale} step={step} onSelect={setStep} />
        <InstallGuideBody
          locale={locale}
          step={step}
          browserChoice={browserChoice}
          files={files}
          browsers={browsers}
          expected={expectedExtensionVersion}
          next={next}
          onStep={setStep}
        />
      </div>
    </section>
  );
}
