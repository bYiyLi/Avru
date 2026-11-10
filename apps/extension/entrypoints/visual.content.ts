import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { createVisualOverlay, isVisualMessage } from '../utils/visual-overlay';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main() {
    const render = createVisualOverlay(
      document,
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
    browser.runtime.onMessage.addListener((message, _sender, respond) => {
      if (!isVisualMessage(message)) return false;
      void render(message).then(
        () => {
          respond({ ok: true });
        },
        () => {
          respond({ ok: false });
        },
      );
      return true;
    });
    // Restore a task's persisted completion badge after page navigation.
    void browser.runtime
      .sendMessage({ type: 'avru.overlay.ready' })
      .then((status: unknown) => {
        if (isVisualMessage(status)) return render(status);
        return undefined;
      })
      .catch(() => {
        // An extension reload or disconnected page must not block navigation.
      });
  },
});
