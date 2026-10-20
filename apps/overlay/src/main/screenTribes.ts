import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { app, BrowserWindow, desktopCapturer, nativeImage, type NativeImage } from 'electron';
import { matchTribes } from './tribeNames.js';

/**
 * Lecture des tribus de la partie à l'écran (règle n°1 assouplie le 20/10/2026, voir CLAUDE.md).
 *
 * - Opt-in (`screenReading`, désactivé par défaut).
 * - Capture de la SEULE fenêtre Hearthstone (desktopCapturer), recadrée sur une zone qui liste
 *   les tribus : le bandeau « Choisissez un héros », puis pendant la partie l'infobulle
 *   « Dans cette partie » (affichée quand le JOUEUR survole la gemme ; rien n'est simulé).
 * - OCR local (tesseract.js, données fra + eng embarquées). Aucune image conservée ni envoyée
 *   (sauf `BGT_DEBUG=1` : dernière zone lue écrite dans le dossier de l'application).
 * - Résultat retenu seulement si exactement `expected` tribus distinctes sont reconnues.
 */

/**
 * Zone de l'interface du jeu. L'interface s'adapte à la HAUTEUR de la fenêtre et reste centrée :
 * `dx` (depuis le centre) et `width` en fraction de la hauteur, `y` et `height` aussi.
 * Mesurées sur les captures de l'utilisateur du 20/10/2026 (1541×878, 1864×1000, 1488×1005),
 * avec une marge pour la barre de titre d'une fenêtre.
 */
export interface Zone {
  readonly dx: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Bandeau « Choisissez un héros » (liste des tribus sous le titre). */
export const BANNER: Zone = { dx: -0.15, y: 0.11, width: 0.34, height: 0.13 };
/** Infobulle « Dans cette partie » (sans la bulle « Pas dans cette partie » en dessous). */
export const TOOLTIP: Zone = { dx: 0.38, y: 0.3, width: 0.27, height: 0.115 };

const INTERVAL_MS = 2000;

const require = createRequire(import.meta.url);

type Worker = Awaited<ReturnType<typeof import('tesseract.js').createWorker>>;

export class ScreenTribeReader {
  private worker: Promise<Worker> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private gameIndex: number | undefined;
  private busy = false;

  constructor(
    private readonly expected: () => number,
    /** Choix du héros (bandeau) ou partie en cours (infobulle). */
    private readonly heroSelection: () => boolean,
    private readonly onTribes: (gameIndex: number, tribes: readonly string[]) => void,
  ) {}

  /** Démarre la lecture pour une partie (sans effet si déjà en cours pour celle-ci). */
  start(gameIndex: number): void {
    if (this.gameIndex === gameIndex) return;
    this.stop();
    this.gameIndex = gameIndex;
    this.timer = setInterval(() => {
      void this.tick();
    }, INTERVAL_MS);
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.gameIndex = undefined;
    const w = this.worker;
    this.worker = undefined;
    void w?.then((x) => x.terminate()).catch(() => undefined);
  }

  private async tick(): Promise<void> {
    const gameIndex = this.gameIndex;
    if (gameIndex === undefined || this.busy) return;
    this.busy = true;
    try {
      const shot = await captureWindow();
      if (shot === undefined) return;
      const tribes = await this.read(shot, this.heroSelection() ? BANNER : TOOLTIP);
      if (tribes.length === this.expected() && this.gameIndex === gameIndex) {
        this.onTribes(gameIndex, tribes);
        this.stop();
      }
    } catch {
      // capture ou OCR impossible : nouvel essai au prochain intervalle
    } finally {
      this.busy = false;
    }
  }

  /** Tribus lues dans une zone d'une image de la fenêtre du jeu. */
  async read(image: NativeImage, zone: Zone): Promise<string[]> {
    const png = zonePng(image, zone);
    if (process.env.BGT_DEBUG === '1') {
      await writeFile(join(app.getPath('userData'), 'ocr-last.png'), png);
    }
    const worker = await this.ensureWorker();
    const { data } = await worker.recognize(png);
    if (process.env.BGT_DEBUG === '1') console.log(`[bgt] OCR brut : ${JSON.stringify(data.text)}`);
    return matchTribes(data.text);
  }

  /**
   * Autotest sans image du jeu (option --ocr-selftest, utilisé par la CI sur l'appli empaquetée) :
   * dessine un bandeau factice avec les noms de 5 tribus, le capture et le lit.
   */
  async selfTest(): Promise<string[]> {
    const w = new BrowserWindow({
      show: false,
      width: 1600,
      height: 900,
      useContentSize: true,
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true },
    });
    try {
      // Unités relatives : la fenêtre factice peut être réduite à la taille de l'écran (CI).
      const left = `calc(50vw + ${((BANNER.dx + 0.03) * 100).toFixed(1)}vh)`;
      const top = `${((BANNER.y + 0.02) * 100).toFixed(1)}vh`;
      const html =
        `<body style="margin:0;background:#140c1c;font:bold 2.45vh Arial,sans-serif">` +
        `<div style="position:absolute;left:${left};top:${top};color:#f3e6ff;white-space:nowrap;` +
        `text-align:center;line-height:1.4">Aberrations, Dragons,<br>Morts-vivants, Pirates,<br>` +
        `Élémentaires</div></body>`;
      await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await new Promise((r) => setTimeout(r, 500));
      return await this.read(await w.webContents.capturePage(), BANNER);
    } finally {
      w.destroy();
      this.stop();
    }
  }

  /** Vérification sur une capture PNG/JPEG (option --ocr-test) : bandeau puis infobulle. */
  async readFile(path: string): Promise<{ banner: string[]; tooltip: string[] }> {
    try {
      const image = nativeImage.createFromPath(path);
      return { banner: await this.read(image, BANNER), tooltip: await this.read(image, TOOLTIP) };
    } finally {
      this.stop();
    }
  }

  private ensureWorker(): Promise<Worker> {
    this.worker ??= (async () => {
      const { createWorker } = (await import('tesseract.js')) as typeof import('tesseract.js');
      // tesseract.js lit toutes les langues dans UN dossier : on y copie fra et eng (embarqués).
      const langDir = join(app.getPath('userData'), 'ocr');
      await mkdir(langDir, { recursive: true });
      for (const lang of ['fra', 'eng']) {
        const file = `${lang}.traineddata.gz`;
        const pkg = dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
        await copyFile(join(pkg, '4.0.0_best_int', file), join(langDir, file));
      }
      const tesseractDir = dirname(require.resolve('tesseract.js/package.json'));
      return createWorker(['fra', 'eng'], 1, {
        langPath: langDir,
        workerPath: join(tesseractDir, 'src', 'worker-script', 'node', 'index.js'),
        cacheMethod: 'none',
        // Une erreur du worker rejette la reconnaissance en cours au lieu de faire planter l'app.
        errorHandler: () => undefined,
        gzip: true,
      });
    })();
    return this.worker;
  }
}

/** Capture de la fenêtre Hearthstone, si elle est trouvée. */
async function captureWindow(): Promise<NativeImage | undefined> {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 2560, height: 1440 },
    fetchWindowIcons: false,
  });
  const hs = sources.find((s) => s.name === 'Hearthstone');
  return hs === undefined || hs.thumbnail.isEmpty() ? undefined : hs.thumbnail;
}

/** Rectangle d'une zone dans une image de largeur × hauteur données (borné à l'image). */
export function zoneRect(
  zone: Zone,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const x = Math.max(0, Math.round(width / 2 + zone.dx * height));
  const y = Math.max(0, Math.round(zone.y * height));
  return {
    x,
    y,
    width: Math.min(width - x, Math.round(zone.width * height)),
    height: Math.min(height - y, Math.round(zone.height * height)),
  };
}

function zonePng(image: NativeImage, zone: Zone): Buffer {
  const { width, height } = image.getSize();
  return image.crop(zoneRect(zone, width, height)).toPNG();
}
