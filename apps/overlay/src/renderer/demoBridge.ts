import type {
  BgtBridge,
  CatalogCard,
  HistoryGame,
  HistoryListing,
  OverlayPayload,
  OverlaySettings,
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
  /** Réglages modifiés dans la fenêtre Réglages de la démo (non persistés). */
  let settings: OverlaySettings | undefined;
  const emit = (): void => {
    const frame = frames[index];
    if (frame === undefined) return;
    let shown = settings === undefined ? frame : { ...frame, settings };
    if (new URLSearchParams(location.search).has('choice')) shown = withDemoChoice(shown);
    for (const l of listeners) l(shown);
  };
  void fetch('./demo.json')
    .then((r) => r.json() as Promise<OverlayPayload[]>)
    .then((f) => {
      frames = f;
      // ?lang=en&theme=contrast : captures et essais de l'i18n / des thèmes sans la fenêtre Réglages.
      const q = new URLSearchParams(location.search);
      const base = f[0]?.settings;
      const lang = q.get('lang');
      const theme = q.get('theme');
      if (base !== undefined && (lang !== null || theme !== null)) {
        settings = {
          ...base,
          language: lang === 'en' ? 'en' : base.language,
          theme: theme === 'light' || theme === 'contrast' ? theme : base.theme,
        };
      }
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
    setInteractive() {},
    setLobbyTribes() {},
    checkUpdates() {},
    importStatsFromClipboard: () =>
      Promise.resolve({ page: undefined, matched: 0, unmatched: [], error: 'unrecognized' }),
    onTribeArt(l) {
      void fetch('./demo-tribe-art.json')
        .then((r) => r.json() as Promise<Record<string, string>>)
        .then(l)
        .catch(() => undefined);
      return () => undefined;
    },
    openSettings() {
      window.open('./#settings', '_blank');
    },
    updateSettings(patch) {
      const cur = settings ?? frames[index]?.settings;
      if (cur === undefined) return;
      const { resetPanels, ...rest } = patch;
      settings = {
        ...cur,
        ...rest,
        sections: { ...cur.sections, ...patch.sections },
        alerts: { ...cur.alerts, ...patch.alerts },
        streamer: { ...cur.streamer, ...patch.streamer },
        panels: resetPanels === true ? (frames[0]?.settings.panels ?? cur.panels) : cur.panels,
      };
      emit();
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

/** `?choice` : choix de bibelots avec des stats INVENTÉES (synthetic), pour l'UI seulement. */
function withDemoChoice(p: OverlayPayload): OverlayPayload {
  const opt = (cardId: string, pickRate: number, avgPlacement: number, variants?: number) => ({
    cardId,
    stats: {
      pickRate,
      avgPlacement,
      distribution: variants === undefined ? [0.2, 0.15, 0.15, 0.1, 0.1, 0.1, 0.1, 0.1] : undefined,
      variants,
    },
  });
  return {
    ...p,
    names: {
      ...p.names,
      DEMO_T1: 'Portrait éternel',
      DEMO_T2: 'Boussole colorée',
      DEMO_T3: 'Médaillon du chasseur',
    },
    choiceStats: {
      kind: 'trinket',
      options: [opt('DEMO_T1', 0.3, 3.8), opt('DEMO_T2', 0.45, 3.4, 2), opt('DEMO_T3', 0.25, 4.1)],
    },
  };
}
