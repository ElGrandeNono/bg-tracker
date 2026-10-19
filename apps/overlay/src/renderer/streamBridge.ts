import type { BgtBridge, OverlayPayload } from '../shared/payload.js';

/**
 * Pont du mode streamer : la page est servie par le serveur local de l'overlay (127.0.0.1) et
 * reçoit la vue — déjà filtrée et expurgée selon les réglages streamer — par Server-Sent Events.
 * Lecture seule : aucune action n'est renvoyée à l'application.
 */
export function streamBridge(): BgtBridge {
  const listeners = new Set<(p: OverlayPayload) => void>();
  let last: OverlayPayload | undefined;
  const source = new EventSource('./events');
  source.onmessage = (e: MessageEvent<string>) => {
    try {
      last = JSON.parse(e.data) as OverlayPayload;
    } catch {
      return;
    }
    for (const l of listeners) l(last);
  };
  const none = (): void => undefined;
  return {
    onUpdate(l) {
      listeners.add(l);
      if (last !== undefined) l(last);
      return () => listeners.delete(l);
    },
    ready: none,
    saveLayout: none,
    rendered: none,
    onCatalog: () => none,
    openBrowser: none,
    openDashboard: none,
    openSettings: none,
    updateSettings: none,
    setInteractive: none,
    onTribeArt: () => none,
    history: {
      list: () => Promise.resolve({ games: [], names: {} }),
      get: () => Promise.resolve(undefined),
      update: () => Promise.resolve(),
      exportGames: () => Promise.resolve(undefined),
      importLogs: () => Promise.resolve(0),
      onChanged: () => none,
      onImportProgress: () => none,
    },
  };
}
