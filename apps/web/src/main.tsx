import { createController } from './controller.js';
import { bootstrapManagement, reloadManagementLink } from './session.js';
import { App } from './App.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import './browsers.css';
import {
  applyLocalePreference,
  applyThemePreference,
  initialLocale,
  initialTheme,
} from './preferences.js';
applyLocalePreference(initialLocale(navigator.language));
applyThemePreference(initialTheme());
const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
bootstrapManagement(
  window,
  () => {
    window.location.reload();
  },
  (session) => {
    createRoot(root).render(
      <StrictMode>
        <App controller={createController(session)} />
      </StrictMode>,
    );
  },
);

window.addEventListener('hashchange', () => {
  reloadManagementLink(window.location.hash, () => {
    window.location.reload();
  });
});
