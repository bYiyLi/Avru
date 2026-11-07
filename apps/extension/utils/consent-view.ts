import { localeFor, text } from './i18n';
import { record } from './protocol';
export function mountConsent(
  root: Document,
  language: string,
  send: (message: Record<string, unknown>) => Promise<unknown>,
): void {
  const locale = localeFor(language);
  const heading = root.querySelector('#heading');
  const description = root.querySelector('#description');
  const details = root.querySelector('#details');
  const status = root.querySelector('#status');
  const allow = root.querySelector<HTMLButtonElement>('#allow');
  const deny = root.querySelector<HTMLButtonElement>('#deny');
  if (!heading || !description || !details || !status || !allow || !deny)
    return;
  root.documentElement.lang = locale;
  root.title = text(locale, 'consent.title');
  heading.textContent = text(locale, 'consent.heading');
  description.textContent = text(locale, 'consent.description');
  allow.textContent = text(locale, 'consent.allow');
  deny.textContent = text(locale, 'consent.deny');
  let requestId = '';
  let decided = false;
  const decide = (approved: boolean) => {
    if (!requestId || decided) return;
    decided = true;
    allow.disabled = true;
    deny.disabled = true;
    send({ type: 'oauth-consent-decide', requestId, approved }).then(
      () => {
        status.textContent = text(locale, 'consent.submitted');
      },
      () => {
        status.textContent = text(locale, 'consent.disconnected');
      },
    );
  };
  allow.addEventListener('click', () => {
    decide(true);
  });
  deny.addEventListener('click', () => {
    decide(false);
  });
  send({ type: 'oauth-consent-read' })
    .then((value) => {
      const data = record(value);
      if (!data || typeof data.requestId !== 'string')
        throw new Error('No pending request');
      requestId = data.requestId;
      for (const [key, label] of [
        ['clientName', text(locale, 'consent.application')],
        ['redirectUri', text(locale, 'consent.redirectUri')],
        ['resource', text(locale, 'consent.resource')],
      ] as const) {
        const title = root.createElement('dt');
        title.textContent = label;
        const content = root.createElement('dd');
        content.textContent = typeof data[key] === 'string' ? data[key] : '';
        details.append(title, content);
      }
      allow.disabled = false;
    })
    .catch(() => {
      status.textContent = text(locale, 'consent.invalid');
    });
}
