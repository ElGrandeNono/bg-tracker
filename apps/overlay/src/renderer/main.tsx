import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { Browser } from './Browser.js';
import { Dashboard } from './Dashboard.js';
import { Settings } from './Settings.js';
import { demoBridge } from './demoBridge.js';
import { streamBridge } from './streamBridge.js';
import { I18nContext, MESSAGES } from './i18n.js';
import type { BgtBridge, OverlaySettings } from '../shared/payload.js';
import './styles.css';

// Dans Electron, le preload expose `window.bgt`. Servi par le mode streamer (`?obs`), la page lit
// le flux local du serveur ; dans un navigateur (`pnpm demo`), on rejoue des instantanés
// pré-calculés depuis une fixture, sans aucun accès au jeu.
const obs = new URLSearchParams(location.search).has('obs');
const bridge = window.bgt ?? (obs ? streamBridge() : demoBridge());
// Source navigateur OBS : fond réellement transparent (pas de canevas sombre implicite).
if (obs) document.documentElement.classList.add('obs');

/** Langue et thème suivent les réglages reçus du processus principal (toutes les fenêtres). */
function Ui({ children }: { children: ReactNode }): React.JSX.Element {
  const [settings, setSettings] = useState<OverlaySettings | undefined>();
  useEffect(() => {
    const off = bridge.onUpdate((p) => {
      setSettings(p.settings);
    });
    bridge.ready();
    return off;
  }, []);
  const language = settings?.language ?? 'fr';
  const theme = settings?.theme ?? 'dark';
  useEffect(() => {
    document.documentElement.lang = language;
    document.body.className = `theme-${theme}`;
  }, [language, theme]);
  return <I18nContext.Provider value={MESSAGES[language]}>{children}</I18nContext.Provider>;
}

function route(b: BgtBridge): React.JSX.Element {
  switch (location.hash) {
    case '#browser':
      return <Browser bridge={b} />;
    case '#dashboard':
      return <Dashboard bridge={b} />;
    case '#settings':
      return <Settings bridge={b} />;
    default:
      return <App bridge={b} />;
  }
}

const root = document.getElementById('root');
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <Ui>{route(bridge)}</Ui>
    </StrictMode>,
  );
}
