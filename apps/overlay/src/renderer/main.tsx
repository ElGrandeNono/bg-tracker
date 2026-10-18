import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { demoBridge } from './demoBridge.js';
import './styles.css';

// Dans Electron, le preload expose `window.bgt`. Dans un navigateur (`pnpm demo`), on rejoue
// des instantanés pré-calculés depuis une fixture, sans aucun accès au jeu.
const bridge = window.bgt ?? demoBridge();

const root = document.getElementById('root');
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App bridge={bridge} />
    </StrictMode>,
  );
}
