import { useState } from 'react';
import type { DiagnosticReport } from './controller.js';
import { translate as t } from './i18n.js';
import type { Language } from './presentation.js';
export function diagnosticConclusion(
  report: DiagnosticReport,
  locale: Language,
): string {
  const broken = report.steps.find((step) => step.status === 'failed');
  if (broken)
    return t(locale, 'diagnostics.brokenAt', {
      step: t(locale, `diagnostics.step.${broken.id}`),
    });
  if (report.steps.some((step) => step.status === 'unknown'))
    return t(locale, 'diagnostics.partialUnknown');
  return t(locale, 'diagnostics.allPassed');
}
function statusClass(status: 'passed' | 'failed' | 'unknown'): string {
  if (status === 'passed') return 'match';
  if (status === 'failed') return 'mismatch';
  return 'unknown';
}
export function DiagnosticsReport({
  report,
  locale,
}: {
  report: DiagnosticReport;
  locale: Language;
}) {
  return (
    <>
      <ol className="diagnostics-steps">
        {report.steps.map((step) => (
          <li key={step.id}>
            <strong>{t(locale, `diagnostics.step.${step.id}`)}</strong>
            <span className={statusClass(step.status)}>
              {step.status === 'unknown'
                ? t(locale, 'common.unknown')
                : t(locale, `diagnostics.${step.status}`)}
            </span>
          </li>
        ))}
      </ol>
      <p role="status">{diagnosticConclusion(report, locale)}</p>
    </>
  );
}
export function Diagnostics({
  locale,
  runDiagnostics,
}: {
  locale: Language;
  runDiagnostics: () => Promise<DiagnosticReport>;
}) {
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [running, setRunning] = useState(false);
  return (
    <section className="diagnostics">
      <div className="section-heading">
        <h2>{t(locale, 'diagnostics.title')}</h2>
        <button
          type="button"
          disabled={running}
          onClick={() => {
            setRunning(true);
            void runDiagnostics().then(
              (next) => {
                setReport(next);
                setRunning(false);
              },
              () => {
                setRunning(false);
              },
            );
          }}
        >
          {running
            ? t(locale, 'diagnostics.running')
            : t(locale, 'diagnostics.run')}
        </button>
      </div>
      <p>{t(locale, 'diagnostics.description')}</p>
      {report && <DiagnosticsReport report={report} locale={locale} />}
    </section>
  );
}
