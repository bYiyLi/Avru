import { Calls } from './Calls.js';
import { Connection } from './Connection.js';
import type { ConnectionActions } from './Connection.js';
import { Diagnostics } from './Diagnostics.js';
import type { DiagnosticReport, ViewState } from './controller.js';
import { translate as t } from './i18n.js';
import type { Language } from './presentation.js';
import { INSTALL_VERSION_ANCHOR } from './scroll.js';

export type NextStepId = 'browser' | 'version' | 'mcp' | 'remote';
export interface NextStep {
  id: NextStepId;
  actual?: string;
  expected?: string;
}
export function deriveNextSteps(state: ViewState): NextStep[] {
  if (!state.system) return [];
  const steps: NextStep[] = [];
  if (!state.browsers.some((browser) => browser.connected))
    steps.push({ id: 'browser' });
  const expected = state.system.expectedExtensionVersion;
  const actual = state.browsers
    .filter((browser) => browser.connected)
    .map((browser) => browser.metadata?.extensionVersion)
    .find((version) => version);
  if (actual && actual !== expected)
    steps.push({ id: 'version', actual, expected });
  if (state.system.mcp === 'notImplemented') steps.push({ id: 'mcp' });
  if (
    state.system.frpc === 'managed' &&
    state.connection &&
    !state.connection.configured
  )
    steps.push({ id: 'remote' });
  return steps;
}

function NextStepDetail({
  step,
  locale,
}: {
  step: NextStep;
  locale: Language;
}) {
  if (step.id === 'version')
    return (
      <p>
        {t(locale, 'todo.version.detail', {
          actual: step.actual ?? t(locale, 'common.unknown'),
          expected: step.expected ?? t(locale, 'common.unknown'),
        })}
      </p>
    );
  return <p>{t(locale, `todo.${step.id}.detail`)}</p>;
}

export function NextSteps({
  state,
  locale,
  onOpenInstall,
  onOpenConnection,
}: {
  state: ViewState;
  locale: Language;
  onOpenInstall: (anchor?: string) => void;
  onOpenConnection: () => void;
}) {
  const steps = deriveNextSteps(state);
  return (
    <section className="next-steps">
      <div className="section-heading">
        <h2>{t(locale, 'todo.title')}</h2>
      </div>
      {!state.system ? (
        <p className="empty">{t(locale, 'todo.unknown')}</p>
      ) : steps.length === 0 ? (
        <p className="empty">{t(locale, 'todo.empty')}</p>
      ) : (
        <ul>
          {steps.map((step) => (
            <li key={step.id}>
              <strong>{t(locale, `todo.${step.id}.title`)}</strong>
              <NextStepDetail step={step} locale={locale} />
              <button
                type="button"
                onClick={() => {
                  if (step.id === 'browser') onOpenInstall();
                  else if (step.id === 'version')
                    onOpenInstall(INSTALL_VERSION_ANCHOR);
                  else onOpenConnection();
                }}
              >
                {t(locale, `todo.${step.id}.action`)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ActivityPage({
  state,
  locale,
  onOpenLogs,
}: {
  state: ViewState;
  locale: Language;
  onOpenLogs: () => void;
}) {
  return (
    <section className="console-content-page console-activity">
      <div className="console-activity-heading">
        <p className="console-section-intro">
          {t(locale, 'console.activityDescription')}
        </p>
        <button type="button" onClick={onOpenLogs}>
          {t(locale, 'logs.viewAll')}
        </button>
      </div>
      <Calls
        locale={locale}
        history={state.system ? (state.history ?? null) : null}
      />
    </section>
  );
}

export function ConnectionsPage({
  state,
  locale,
  actions,
}: {
  state: ViewState;
  locale: Language;
  actions?: ConnectionActions | undefined;
}) {
  return (
    <section className="console-content-page console-connections">
      <p className="console-section-intro">
        {t(locale, 'console.connectionDescription')}
      </p>
      <div className="console-connection-overview">
        <div>
          <h2>MCP / ChatGPT</h2>
          <p>
            {t(
              locale,
              state.system?.mcp === 'oauthReadOnly'
                ? 'overview.readOnly'
                : state.system
                  ? 'channels.unimplemented'
                  : 'common.unknown',
            )}
          </p>
          <small>{t(locale, 'overview.remoteNotice')}</small>
        </div>
        <div>
          <h2>FRPC</h2>
          <p>
            {t(
              locale,
              state.system?.frpc === 'managed'
                ? 'connection.title'
                : state.system
                  ? 'channels.unimplemented'
                  : 'common.unknown',
            )}
          </p>
          <small>{t(locale, 'connection.notVerified')}</small>
        </div>
      </div>
      {state.system?.frpc === 'managed' ? (
        <Connection
          status={state.connection}
          locale={locale}
          busy={state.busy}
          actions={actions}
        />
      ) : (
        <div className="console-connection-unavailable">
          <h2>{t(locale, 'channels.title')}</h2>
          <p>
            {state.system
              ? t(locale, 'channels.notice')
              : t(locale, 'overview.unconfirmed')}
          </p>
        </div>
      )}
    </section>
  );
}

export function MaintenancePage({
  state,
  locale,
  onOpenInstall,
  onOpenConnection,
  runDiagnostics,
}: {
  state: ViewState;
  locale: Language;
  onOpenInstall: (anchor?: string) => void;
  onOpenConnection: () => void;
  runDiagnostics: () => Promise<DiagnosticReport>;
}) {
  return (
    <section className="console-content-page console-maintenance">
      <div className="console-utility-grid">
        <NextSteps
          state={state}
          locale={locale}
          onOpenInstall={onOpenInstall}
          onOpenConnection={onOpenConnection}
        />
        <Diagnostics locale={locale} runDiagnostics={runDiagnostics} />
      </div>
    </section>
  );
}
