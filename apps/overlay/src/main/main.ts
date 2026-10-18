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
import { loadCardDb, type CardDb } from '@bgt/data';
import {
  CHANNELS,
  type HsWindowState,
  type OverlayPayload,
  type OverlaySettings,
  type OverlayStatus,
} from '../shared/payload.js';
import { checkGameConfig, offerConfigFixes } from './gameSetup.js';
import { HsWindowTracker, type HsWindowSample } from './hsWindow.js';
import { loadSettings, saveSettings } from './settings.js';

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
    standalone: { type: 'boolean' },
    locale: { type: 'string' },
  },
});
const replayPath = typeof args.replay === 'string' ? args.replay : undefined;
const smokeOut = typeof args.smoke === 'string' ? args.smoke : undefined;
const speed = Number(typeof args.speed === 'string' ? args.speed : smokeOut ? '0' : '1');
const standalone = replayPath !== undefined || args.standalone === true;
const locale = args.locale === 'enUS' ? 'enUS' : 'frFR';

const settingsFile = join(app.getPath('userData'), 'overlay-settings.json');
let settings: OverlaySettings = { ...loadSettings(settingsFile), backdrop: standalone };
const pipeline = new Pipeline();
const paths = defaultGamePaths();

let win: BrowserWindow | undefined;
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
let cardDbBuild: string | undefined;
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
  if (build === undefined || build === cardDbBuild) return;
  cardDbBuild = build;
  status = { ...status, cardData: 'loading' };
  try {
    const result = await loadCardDb({
      build,
      locale,
      cacheDir: join(app.getPath('userData'), 'cards'),
    });
    cardDb = result.db;
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
  if (win === undefined || !rendererReady) return;
  // Uniquement ce que le client a déjà affiché (horloge PowerTaskList, voir core/pipeline.ts).
  const shown = pipeline.displayed;
  const view = buildVisibleView(shown.bg, shown.state);
  void ensureCardDb(view.build);
  const payload: OverlayPayload = {
    view,
    names: namesFor(view),
    status,
    settings,
    timerEndsAt: view.phase === 'recruit' ? timerEndsAt : undefined,
  };
  win.webContents.send(CHANNELS.update, payload);
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
    const timeout = buildVisibleView(bg, state).local.turnTimeoutSec;
    timerEndsAt =
      timeout === undefined || speed <= 0 ? undefined : Date.now() + (timeout * 1000) / speed;
  }
  schedulePush();
});

// ---------------------------------------------------------------- fenêtre

function applySettings(next: OverlaySettings, persist = true): void {
  settings = next;
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

const SHORTCUTS: readonly [string, string, () => void][] = [
  [
    'CommandOrControl+Shift+H',
    'Afficher / masquer',
    () => {
      applySettings({ ...settings, hidden: !settings.hidden });
    },
  ],
  [
    'CommandOrControl+Shift+U',
    'Déverrouiller / verrouiller (déplacer)',
    () => {
      applySettings({ ...settings, locked: !settings.locked });
    },
  ],
  ['CommandOrControl+Shift+O', 'Opacité', cycleOpacity],
  [
    'CommandOrControl+Shift+C',
    'Mode compact',
    () => {
      applySettings({ ...settings, compact: !settings.compact });
    },
  ],
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
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'BG Tracker — non affilié à Blizzard Entertainment', enabled: false },
      { type: 'separator' },
      ...SHORTCUTS.map(([accel, label, action]) => ({ label, accelerator: accel, click: action })),
      { type: 'separator' },
      {
        label: 'Quitter',
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
  watcher.on('fileChanged', () => {
    // Nouvelle session de jeu : la partie de la session précédente est close.
    if (!first) pipeline.end();
    first = false;
  });
  watcher.start();
  app.on('will-quit', () => {
    watcher.stop();
    tracker.stop();
  });
}

// ---------------------------------------------------------------- démarrage

ipcMain.on(CHANNELS.ready, () => {
  rendererReady = true;
  push();
});
ipcMain.on(CHANNELS.saveLayout, (_e, panels: OverlaySettings['panels']) => {
  applySettings({ ...settings, panels });
});
ipcMain.on(CHANNELS.rendered, () => {
  if (process.env.BGT_DEBUG === '1') console.log('[bgt] rendered', status.replayDone);
  if (smokeOut === undefined || win === undefined || smokeScheduled) return;
  // Replay : capture une fois le fichier rejoué ; direct : 5 s après le premier rendu.
  if (replayPath !== undefined && !status.replayDone) return;
  smokeScheduled = true;
  const target = win;
  setTimeout(
    () => {
      void target.webContents.capturePage().then(async (img) => {
        await writeFile(smokeOut, img.toPNG());
        app.quit();
      });
    },
    replayPath === undefined ? 12_000 : 300,
  );
});

app.disableHardwareAcceleration(); // overlay léger : évite le coût GPU d'une fenêtre transparente
void app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => {
    cb(false);
  });
  win = createWindow();
  if (smokeOut === undefined) {
    tray = new Tray(trayIcon());
    tray.setToolTip('BG Tracker');
    refreshTrayMenu();
    for (const [accel, , action] of SHORTCUTS) globalShortcut.register(accel, action);
  }
  await startSource();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
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
