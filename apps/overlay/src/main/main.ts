import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  Tray,
  type Rectangle,
} from 'electron';
import {
  buildVisibleView,
  defaultGamePaths,
  LogWatcher,
  Pipeline,
  replayFile,
  type VisibleView,
} from '@bgt/core';
import { buildPoolCatalog, loadCardDb, type CardDb } from '@bgt/data';
import type { PoolCard } from '@bgt/core';
import {
  CHANNELS,
  type SettingsPatch,
  type HsWindowState,
  type OverlayPayload,
  type OverlaySettings,
  type CatalogCard,
  type CombatSimPayload,
  type OverlayStatus,
} from '../shared/payload.js';
import { checkGameConfig, offerConfigFixes } from './gameSetup.js';
import { catalogCards, poolPayload } from './poolPayload.js';
import { currentPoolRules, currentSeason, overlayView } from './season.js';
import { buildSimRequest, type SimRequest } from './combatSim.js';
import { HistoryService } from './history.js';
import { SimulationPool } from '@bgt/sim';
import { HsWindowTracker, type HsWindowSample } from './hsWindow.js';
import { applyPatch, loadSettings, saveSettings } from './settings.js';
import { StreamServer, streamPayload } from './streamServer.js';
import { menuStrings } from './menuStrings.js';
import { checkForUpdates } from './updater.js';

/**
 * Processus principal de l'overlay.
 *
 * LogWatcher (ou replay) → Pipeline → buildVisibleView (filtre fair-play) → IPC → renderer.
 * Le renderer ne reçoit QUE la vue filtrée et les noms des cartes qu'elle contient.
 *
 *   electron .                                  suivi en direct du jeu
 *   electron . --replay <log> [--speed 10]      rejoue un log (fenêtre autonome)
 *   electron . --replay <log> --smoke out.png   capture d'écran puis sortie (vérification)
 */

const here = dirname(fileURLToPath(import.meta.url));

const { values: args } = parseArgs({
  args: process.argv.slice(app.isPackaged ? 1 : 2),
  allowPositionals: true,
  strict: false,
  options: {
    replay: { type: 'string' },
    speed: { type: 'string' },
    smoke: { type: 'string' },
    // Capture de contrôle d'une fenêtre secondaire : `browser` ou `dashboard`.
    'smoke-route': { type: 'string' },
    standalone: { type: 'boolean' },
    locale: { type: 'string' },
  },
});
const replayPath = typeof args.replay === 'string' ? args.replay : undefined;
const smokeOut = typeof args.smoke === 'string' ? args.smoke : undefined;
const speed = Number(typeof args.speed === 'string' ? args.speed : smokeOut ? '0' : '1');
const standalone = replayPath !== undefined || args.standalone === true;
/** Langue des données de cartes : `--locale` si fourni, sinon celle des réglages. */
const cardLocale = (): 'frFR' | 'enUS' =>
  args.locale === 'enUS' || args.locale === 'frFR'
    ? args.locale
    : settings.language === 'en'
      ? 'enUS'
      : 'frFR';

// Développement et tests : dossier de données séparé (réglages, historique, cache de cartes).
if (process.env.BGT_USER_DATA !== undefined) app.setPath('userData', process.env.BGT_USER_DATA);
const settingsFile = join(app.getPath('userData'), 'overlay-settings.json');
let settings: OverlaySettings = { ...loadSettings(settingsFile), backdrop: standalone };
const pipeline = new Pipeline(currentSeason);
const paths = defaultGamePaths();

let win: BrowserWindow | undefined;
/** Navigateur de serviteurs (fenêtre normale, ouverte à la demande). */
let browserWin: BrowserWindow | undefined;
/** Tableau de bord : historique, statistiques, replay de partie. */
let dashboardWin: BrowserWindow | undefined;
/** Réglages : apparence, sections, alertes, mode streamer, mises à jour. */
let settingsWin: BrowserWindow | undefined;
/** Mode streamer (désactivé par défaut) : serveur local pour OBS, 127.0.0.1 uniquement. */
const streamServer = new StreamServer(join(here, '../renderer'));
/** Historique local (créé au démarrage de l'application). */
let history: HistoryService | undefined;
/** Power.log suivi en direct (exclu de l'import des anciens logs). */
let currentLogPath: string | undefined;
/** Fenêtres dont le renderer a signalé être prêt. */
const readyContents = new Set<number>();
/** Règles du pool de la saison en cours (seasons/s14). */
const poolRules = currentPoolRules;
let poolCatalog: readonly PoolCard[] = [];
/** Simulateur de combat : worker threads, créés à la première simulation. */
let simPool: SimulationPool | undefined;
let simKey = '';
let simResult: { key: string; payload: CombatSimPayload } | undefined;

/** Lance (ou relance) la simulation quand les plateaux affichés changent ; l'ancienne est annulée. */
function updateSimulation(req: SimRequest | undefined): CombatSimPayload | undefined {
  const key = req === undefined ? '' : JSON.stringify(req);
  if (key !== simKey) {
    simKey = key;
    simResult = undefined;
    if (req !== undefined) {
      simPool ??= new SimulationPool(new URL('./simWorker.js', import.meta.url));
      const publish = (summary: CombatSimPayload['summary'], final: boolean): void => {
        if (simKey !== key) return;
        if (process.env.BGT_DEBUG === '1' && final) {
          console.log(
            `[bgt] simulation ${req.context} : ${summary.iterations} combats, V ${Math.round(summary.win * 100)} %`,
          );
        }
        simResult = {
          key,
          payload: {
            context: req.context,
            opponentPlayerId: req.opponentPlayerId,
            boardRound: req.boardRound,
            summary,
            final,
          },
        };
        schedulePush();
      };
      void simPool
        .run(req.input, {
          iterations: 10_000,
          onProgress: (s) => {
            publish(s, false);
          },
        })
        .then((s) => {
          publish(s, true);
        });
    }
  }
  return simResult?.key === key ? simResult.payload : undefined;
}
let uiCatalog: readonly CatalogCard[] = [];
let tray: Tray | undefined;
let rendererReady = false;
let status: OverlayStatus = {
  source: replayPath === undefined ? 'live' : 'replay',
  configProblems: [],
  hsWindow: standalone ? 'ok' : 'notFound',
  cardData: 'loading',
  replayDone: false,
};
let cardDb: CardDb | undefined;
/** Build + locale des données chargées (un changement de langue recharge les noms). */
let cardDbKey: string | undefined;
let timerEndsAt: number | undefined;
let lastRecruitCount = 0;
let smokeScheduled = false;

// ---------------------------------------------------------------- sécurité

app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (e) => {
    e.preventDefault();
  });
  contents.on('will-attach-webview', (e) => {
    e.preventDefault();
  });
});

// ---------------------------------------------------------------- données de cartes

async function ensureCardDb(build: string | undefined): Promise<void> {
  const locale = cardLocale();
  const key = `${build}/${locale}`;
  if (build === undefined || key === cardDbKey) return;
  cardDbKey = key;
  status = { ...status, cardData: 'loading' };
  try {
    const result = await loadCardDb({
      build,
      locale,
      cacheDir: join(app.getPath('userData'), 'cards'),
    });
    if (cardDbKey !== key) return; // langue changée entre-temps
    cardDb = result.db;
    poolCatalog = buildPoolCatalog(result.db);
    uiCatalog = catalogCards(result.db, poolCatalog, poolRules);
    for (const w of [win, browserWin]) {
      if (w !== undefined && !w.isDestroyed() && readyContents.has(w.webContents.id)) {
        w.webContents.send(CHANNELS.catalog, uiCatalog);
      }
    }
    status = { ...status, cardData: result.stale ? 'stale' : 'ok' };
  } catch {
    status = { ...status, cardData: 'error' };
  }
  schedulePush();
}

function namesFor(view: VisibleView): Record<string, string> {
  const names: Record<string, string> = {};
  if (cardDb === undefined) return names;
  const add = (id: string | undefined): void => {
    if (id !== undefined && id !== '') names[id] = cardDb?.name(id) ?? id;
  };
  add(view.local.heroCardId);
  for (const p of view.players) {
    add(p.heroCardId);
    for (const m of p.lastBoard?.minions ?? []) add(m.cardId);
  }
  for (const id of view.season?.shownCardIds ?? []) add(id);
  return names;
}

// ---------------------------------------------------------------- envoi au renderer

let pushTimer: NodeJS.Timeout | undefined;

/** Regroupe les mises à jour (≤ 1 envoi / 100 ms) : latence log → overlay < 300 ms. */
function schedulePush(): void {
  if (pushTimer !== undefined) return;
  pushTimer = setTimeout(() => {
    pushTimer = undefined;
    push();
  }, 100);
}

function push(): void {
  // Uniquement ce que le client a déjà affiché (horloge PowerTaskList, voir core/pipeline.ts).
  const shown = pipeline.displayed;
  const view = overlayView(shown);
  // L'historique n'enregistre que le suivi en direct (un replay de test ne le pollue pas).
  if (status.source === 'live') history?.observe(view);
  if (win === undefined || !rendererReady) return;
  void ensureCardDb(view.build);
  const payload: OverlayPayload = {
    view,
    names: namesFor(view),
    status,
    settings,
    timerEndsAt: view.phase === 'recruit' ? timerEndsAt : undefined,
    pool: poolCatalog.length === 0 ? undefined : poolPayload(view, poolCatalog, poolRules),
    combatSim: updateSimulation(buildSimRequest(view, cardDb)),
  };
  // Toutes les fenêtres reçoivent la vue : langue et thème suivent les réglages partout.
  for (const w of [win, browserWin, dashboardWin, settingsWin]) {
    if (w !== undefined && !w.isDestroyed() && readyContents.has(w.webContents.id)) {
      w.webContents.send(CHANNELS.update, payload);
    }
  }
  streamServer.publish(streamPayload(payload, settings.streamer));
  if (process.env.BGT_DEBUG === '1') {
    console.log(
      `[bgt] vue : BG=${view.isBattlegrounds} tour=${view.round} phase=${view.phase} issue=${view.outcome} joueurs=${view.players.length} fenêtre=${status.hsWindow}`,
    );
  }
}

pipeline.subscribe(() => {
  // Minuteur : le recrutement démarre quand le CLIENT affiche l'entrée `recruit` ; sa durée est
  // le `TIMEOUT` du joueur local. En replay accéléré, la durée est divisée par la vitesse.
  const { bg, state } = pipeline.displayed;
  const recruits = bg.timeline.filter((e) => e.kind === 'recruit').length;
  if (recruits !== lastRecruitCount) {
    lastRecruitCount = recruits;
    const timeout = buildVisibleView(bg, state).local.turnTimeoutSec; // champ du cœur seul
    timerEndsAt =
      timeout === undefined || speed <= 0 ? undefined : Date.now() + (timeout * 1000) / speed;
  }
  schedulePush();
});

// ---------------------------------------------------------------- fenêtre

function applySettings(next: OverlaySettings, persist = true): void {
  const previous = settings;
  settings = next;
  if (next.language !== previous.language) {
    for (const [w, title] of [
      [browserWin, menuStrings(next.language).titleBrowser],
      [dashboardWin, menuStrings(next.language).titleDashboard],
      [settingsWin, menuStrings(next.language).titleSettings],
    ] as const) {
      if (w !== undefined && !w.isDestroyed()) w.setTitle(title);
    }
    // Les noms de cartes sont rechargés dans la nouvelle langue au prochain envoi (push).
  }
  void syncStreamServer();
  if (next.autoUpdate && !previous.autoUpdate && app.isPackaged) {
    void checkForUpdates(() => menuStrings(settings.language));
  }
  if (win !== undefined) {
    win.setIgnoreMouseEvents(settings.locked, { forward: true });
    win.setFocusable(!settings.locked);
    updateVisibility();
  }
  if (persist) void saveSettings(settingsFile, settings);
  refreshTrayMenu();
  schedulePush();
}

function hsState(sample: HsWindowSample, bounds: Rectangle): HsWindowState {
  if (!sample.found) return 'notFound';
  if (sample.minimized) return 'minimized';
  const display = screen.getDisplayMatching(bounds).bounds;
  const coversScreen =
    bounds.x <= display.x &&
    bounds.y <= display.y &&
    bounds.width >= display.width &&
    bounds.height >= display.height;
  // Plein écran : impossible de distinguer exclusif et fenêtré sans bordure depuis l'extérieur.
  // On prévient seulement, avec `graphicsfullscreen=True` dans options.txt comme indice.
  if (coversScreen && readFullscreenOption()) return 'fullscreen';
  return sample.foreground ? 'ok' : 'background';
}

function readFullscreenOption(): boolean {
  try {
    const text = readFileSync(join(dirname(paths.logConfig), 'options.txt'), 'utf8');
    return /^graphicsfullscreen=True$/im.test(text);
  } catch {
    return false;
  }
}

function updateVisibility(): void {
  if (win === undefined) return;
  const visible =
    smokeOut !== undefined ||
    (!settings.hidden &&
      (standalone ||
        status.hsWindow === 'ok' ||
        status.hsWindow === 'fullscreen' ||
        // déverrouillé (mode déplacement) : l'overlay a le focus, le jeu passe en arrière-plan
        (!settings.locked && status.hsWindow === 'background')));
  if (visible && !win.isVisible()) win.showInactive();
  if (!visible && win.isVisible()) win.hide();
}

function onHsSample(sample: HsWindowSample): void {
  if (win === undefined) return;
  if (sample.found && !sample.minimized && sample.width > 0) {
    const dip = screen.screenToDipRect(null, {
      x: sample.x,
      y: sample.y,
      width: sample.width,
      height: sample.height,
    });
    win.setBounds(dip);
    status = { ...status, hsWindow: hsState(sample, dip) };
  } else {
    status = { ...status, hsWindow: hsState(sample, win.getBounds()) };
  }
  updateVisibility();
  schedulePush();
}

/**
 * Fenêtres classiques (cadre, focus), même renderer et même preload que l'overlay :
 * navigateur de serviteurs (route #browser) et tableau de bord (route #dashboard).
 */
function openBrowser(): void {
  browserWin = openAuxWindow(
    browserWin,
    'browser',
    menuStrings(settings.language).titleBrowser,
    () => {
      browserWin = undefined;
    },
  );
}

function openDashboard(): void {
  dashboardWin = openAuxWindow(
    dashboardWin,
    'dashboard',
    menuStrings(settings.language).titleDashboard,
    () => {
      dashboardWin = undefined;
    },
  );
}

function openSettings(): void {
  settingsWin = openAuxWindow(
    settingsWin,
    'settings',
    menuStrings(settings.language).titleSettings,
    () => {
      settingsWin = undefined;
    },
  );
}

/** Démarre, déplace ou arrête le serveur OBS selon les réglages (jamais sans opt-in). */
let streamWanted = '';
async function syncStreamServer(): Promise<void> {
  const s = settings.streamer;
  const wanted = s.enabled && smokeOut === undefined ? String(s.port) : '';
  if (wanted === streamWanted) return;
  streamWanted = wanted;
  try {
    if (wanted === '') await streamServer.stop();
    else await streamServer.start(s.port);
  } catch {
    streamWanted = '';
    await streamServer.stop();
    tray?.displayBalloon({
      title: 'BG Tracker',
      content: menuStrings(settings.language).streamError(s.port),
    });
  }
  schedulePush();
}

function openAuxWindow(
  existing: BrowserWindow | undefined,
  route: string,
  title: string,
  onClosed: () => void,
): BrowserWindow {
  if (existing !== undefined && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return existing;
  }
  const w = new BrowserWindow({
    width: route === 'dashboard' ? 1180 : route === 'settings' ? 640 : 1040,
    height: route === 'settings' ? 820 : 780,
    title,
    autoHideMenuBar: true,
    backgroundColor: '#12141c',
    webPreferences: {
      preload: join(here, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  const id = w.webContents.id;
  w.on('closed', () => {
    readyContents.delete(id);
    onClosed();
  });
  void w.loadFile(join(here, '../renderer/index.html'), { hash: route });
  return w;
}

function createWindow(): BrowserWindow {
  const area = screen.getPrimaryDisplay().workArea;
  const w = new BrowserWindow({
    x: area.x,
    y: area.y,
    width: standalone ? Math.min(1440, area.width) : area.width,
    height: standalone ? Math.min(810, area.height) : area.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    alwaysOnTop: !standalone,
    show: false,
    webPreferences: {
      preload: join(here, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  if (!standalone) w.setAlwaysOnTop(true, 'screen-saver');
  w.setIgnoreMouseEvents(settings.locked, { forward: true });
  void w.loadFile(join(here, '../renderer/index.html'));
  w.once('ready-to-show', () => {
    if (standalone || smokeOut !== undefined) w.showInactive();
  });
  return w;
}

// ---------------------------------------------------------------- raccourcis et tray

function cycleOpacity(): void {
  const steps = [1, 0.85, 0.7, 0.5];
  const i = steps.findIndex((s) => s <= settings.opacity + 0.001);
  applySettings({ ...settings, opacity: steps[(i + 1) % steps.length] ?? 1 });
}

type MenuKey = 'toggle' | 'unlock' | 'opacity' | 'compact' | 'browser' | 'dashboard' | 'settings';

const SHORTCUTS: readonly [string, MenuKey, () => void][] = [
  [
    'CommandOrControl+Shift+H',
    'toggle',
    () => {
      applySettings({ ...settings, hidden: !settings.hidden });
    },
  ],
  [
    'CommandOrControl+Shift+U',
    'unlock',
    () => {
      applySettings({ ...settings, locked: !settings.locked });
    },
  ],
  ['CommandOrControl+Shift+O', 'opacity', cycleOpacity],
  [
    'CommandOrControl+Shift+C',
    'compact',
    () => {
      applySettings({ ...settings, compact: !settings.compact });
    },
  ],
  ['CommandOrControl+Shift+B', 'browser', openBrowser],
  ['CommandOrControl+Shift+D', 'dashboard', openDashboard],
  ['CommandOrControl+Shift+P', 'settings', openSettings],
];

function trayIcon(): Electron.NativeImage {
  // Icône générée (carré ambre 16×16) : aucun asset externe.
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) buf.set([0x2a, 0xb4, 0xf5, 0xff], i * 4); // BGRA
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function refreshTrayMenu(): void {
  if (tray === undefined) return;
  const m = menuStrings(settings.language);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: m.disclaimer, enabled: false },
      { type: 'separator' },
      ...SHORTCUTS.map(([accel, key, action]) => ({
        label: m[key],
        accelerator: accel,
        click: action,
      })),
      { type: 'separator' },
      {
        label: m.quit,
        click: () => {
          app.quit();
        },
      },
    ]),
  );
}

// ---------------------------------------------------------------- sources

async function startSource(): Promise<void> {
  if (replayPath !== undefined) {
    await replayFile(replayPath, pipeline, { speed });
    status = { ...status, replayDone: true };
    schedulePush();
    return;
  }
  const tracker = new HsWindowTracker(); // démarré tôt : PowerShell compile son Add-Type
  tracker.on('sample', onHsSample);
  tracker.start();
  status = { ...status, configProblems: await checkGameConfig(paths) };
  if (status.configProblems.length > 0) {
    await offerConfigFixes(paths);
    status = { ...status, configProblems: await checkGameConfig(paths) };
  }
  const watcher = new LogWatcher({ logsRoot: paths.logsRoot });
  let first = true;
  watcher.on('line', (l) => {
    pipeline.feedLine(l);
  });
  watcher.on('fileChanged', (path) => {
    // Nouvelle session de jeu : la partie de la session précédente est close.
    if (!first) {
      pipeline.end();
      push(); // la partie close est enregistrée avant de changer de session
    }
    first = false;
    currentLogPath = path;
    history?.setSession(path);
  });
  watcher.start();
  app.on('will-quit', () => {
    watcher.stop();
    tracker.stop();
  });
}

// ---------------------------------------------------------------- démarrage

ipcMain.on(CHANNELS.ready, (e) => {
  rendererReady = true;
  readyContents.add(e.sender.id);
  if (uiCatalog.length > 0) e.sender.send(CHANNELS.catalog, uiCatalog);
  push();
});
ipcMain.on(CHANNELS.openBrowser, () => {
  openBrowser();
});
ipcMain.on(CHANNELS.openDashboard, () => {
  openDashboard();
});
ipcMain.on(CHANNELS.openSettings, () => {
  openSettings();
});
ipcMain.on(CHANNELS.saveLayout, (_e, panels: OverlaySettings['panels']) => {
  applySettings({ ...settings, panels });
});
ipcMain.on(CHANNELS.updateSettings, (_e, patch: unknown) => {
  // Le patch vient du renderer : applyPatch le repasse par la validation complète.
  const p = typeof patch === 'object' && patch !== null ? (patch as SettingsPatch) : {};
  applySettings(applyPatch(settings, p));
});
ipcMain.on(CHANNELS.rendered, () => {
  if (process.env.BGT_DEBUG === '1') console.log('[bgt] rendered', status.replayDone);
  if (smokeOut === undefined || win === undefined || smokeScheduled) return;
  // Replay : capture une fois le fichier rejoué ; direct : 5 s après le premier rendu.
  if (replayPath !== undefined && !status.replayDone) return;
  smokeScheduled = true;
  let target = win;
  const route = args['smoke-route'];
  if (route === 'dashboard') {
    openDashboard();
    target = dashboardWin ?? win;
  } else if (route === 'browser') {
    openBrowser();
    target = browserWin ?? win;
  } else if (route === 'settings') {
    openSettings();
    target = settingsWin ?? win;
  }
  setTimeout(
    () => {
      void target.webContents.capturePage().then(async (img) => {
        await writeFile(smokeOut, img.toPNG());
        app.quit();
      });
    },
    replayPath === undefined ? 12_000 : route === undefined ? 300 : 3000,
  );
});

app.disableHardwareAcceleration(); // overlay léger : évite le coût GPU d'une fenêtre transparente
void app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => {
    cb(false);
  });
  history = new HistoryService(
    app.getPath('userData'),
    () => cardDb,
    () => [win, browserWin, dashboardWin, settingsWin],
  );
  history.registerIpc(
    () => paths.logsRoot,
    () => currentLogPath,
  );
  app.on('will-quit', () => {
    history?.close();
  });
  win = createWindow();
  if (smokeOut === undefined) {
    tray = new Tray(trayIcon());
    tray.setToolTip('BG Tracker');
    refreshTrayMenu();
    for (const [accel, , action] of SHORTCUTS) globalShortcut.register(accel, action);
  }
  void syncStreamServer();
  // Mises à jour : uniquement si l'utilisateur l'a activé (accès réseau à GitHub).
  if (settings.autoUpdate && app.isPackaged && smokeOut === undefined) {
    void checkForUpdates(() => menuStrings(settings.language));
  }
  await startSource();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  void streamServer.stop();
});
app.on('window-all-closed', () => {
  app.quit();
});

// Journal de diagnostic (BGT_DEBUG=1) : exceptions non gérées du processus principal.
if (process.env.BGT_DEBUG === '1') {
  process.on('uncaughtException', (e) => {
    console.error('[bgt] exception', e);
  });
  process.on('unhandledRejection', (e) => {
    console.error('[bgt] rejet', e);
  });
}
