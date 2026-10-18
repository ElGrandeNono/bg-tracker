import type {
  BgtBridge,
  CatalogCard,
  HistoryGame,
  HistoryListing,
  OverlayPayload,
} from '../shared/payload.js';

interface DemoHistory extends HistoryListing {
  readonly details: Readonly<Record<number, HistoryGame>>;
}

/**
 * Pont de démonstration pour le navigateur : charge `demo.json` (instantanés générés par
 * `node build.mjs --demo-only` à partir d'une fixture anonymisée) et permet de les parcourir
 * avec ← / →. Uniquement pour le développement de l'UI.
 */
export function demoBridge(): BgtBridge {
  const listeners = new Set<(p: OverlayPayload) => void>();
  const demoHistory: Promise<DemoHistory> = fetch('./demo-history.json')
    .then((r) => r.json() as Promise<DemoHistory>)
    .catch(() => ({ games: [], names: {}, details: {} }));
  let frames: OverlayPayload[] = [];
  let index = 0;
  const emit = (): void => {
    const frame = frames[index];
    if (frame !== undefined) for (const l of listeners) l(frame);
  };
  void fetch('./demo.json')
    .then((r) => r.json() as Promise<OverlayPayload[]>)
    .then((f) => {
      frames = f;
      fromQuery();
    });
  // Instantané choisi par ?f=N (le hash sert à la route : #browser).
  const fromQuery = (): void => {
    const raw = new URLSearchParams(location.search).get('f');
    const n = raw === null ? NaN : Number(raw);
    index = Number.isInteger(n) && n >= 0 && n < frames.length ? n : frames.length - 1;
    emit();
  };
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return; // la recherche du navigateur garde ses flèches
    if (e.key === 'ArrowRight') index = Math.min(frames.length - 1, index + 1);
    else if (e.key === 'ArrowLeft') index = Math.max(0, index - 1);
    else return;
    const url = new URL(location.href);
    url.searchParams.set('f', String(index));
    history.replaceState(null, '', url);
    emit();
  });
  return {
    onUpdate(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    ready() {},
    saveLayout() {},
    rendered() {},
    onCatalog(l) {
      void fetch('./demo-catalog.json')
        .then((r) => r.json() as Promise<CatalogCard[]>)
        .then(l)
        .catch(() => undefined);
      return () => undefined;
    },
    openBrowser() {
      window.open('./#browser', '_blank');
    },
    openDashboard() {
      window.open('./#dashboard', '_blank');
    },
    history: {
      list: () => demoHistory.then((h) => ({ games: h.games, names: h.names })),
      get: (id) => demoHistory.then((h) => h.details[id]),
      update: () => Promise.resolve(),
      exportGames: () => Promise.resolve(undefined),
      importLogs: () => Promise.resolve(0),
      onChanged: () => () => undefined,
      onImportProgress: () => () => undefined,
    },
  };
}
