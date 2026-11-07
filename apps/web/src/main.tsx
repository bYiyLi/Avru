import { createController } from './controller.js';
import { managementSession, reloadManagementLink } from './session.js';
import { App } from './App.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(
  <StrictMode>
    <App controller={createController(managementSession(window))} />
  </StrictMode>,
);

window.addEventListener('hashchange', () => {
  reloadManagementLink(window.location.hash, () => {
    window.location.reload();
  });
});
