import type { DiagnosticReport, ViewState } from './controller.js';
import { OverviewInsights } from './OverviewInsights.js';
import type { Language } from './presentation.js';
import { MaintenancePage } from './WorkspacePages.js';

export { deriveNextSteps } from './WorkspacePages.js';
export type { NextStep, NextStepId } from './WorkspacePages.js';

export function shortBrowserId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

export function Overview({
  state,
  locale,
  onOpenBrowsers,
  onOpenActivity,
  onOpenConnection,
  onOpenInstall,
  runDiagnostics,
}: {
  state: ViewState;
  locale: Language;
  onOpenBrowsers: () => void;
  onOpenActivity: () => void;
  onOpenConnection: () => void;
  onOpenInstall: (anchor?: string) => void;
  runDiagnostics: () => Promise<DiagnosticReport>;
}) {
  return (
    <section className="overview console-overview">
      <OverviewInsights
        state={state}
        locale={locale}
        onBrowsers={onOpenBrowsers}
        onCalls={onOpenActivity}
        onConnection={onOpenConnection}
      />
      <MaintenancePage
        state={state}
        locale={locale}
        onOpenInstall={onOpenInstall}
        onOpenConnection={onOpenConnection}
        runDiagnostics={runDiagnostics}
      />
    </section>
  );
}
