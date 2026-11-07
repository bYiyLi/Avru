import { App } from './App.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
