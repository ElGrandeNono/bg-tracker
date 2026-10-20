import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { app, BrowserWindow, desktopCapturer, nativeImage, type NativeImage } from 'electron';
import { matchTribes } from './tribeNames.js';

/**
 * Lecture des tribus de la partie à l'écran (règle n°1 assouplie le 20/10/2026, voir CLAUDE.md).
 *
 * - Opt-in (`screenReading`, désactivé par défaut), pendant le choix du héros seulement.
 * - Capture de la SEULE fenêtre Hearthstone (desktopCapturer), recadrée sur le bandeau
 *   « Choisissez un héros » qui liste les tribus ; OCR local (tesseract.js, données fra + eng
 *   embarquées). Aucune image n'est conservée ni envoyée.
 * - Résultat retenu seulement si exactement `expected` tribus distinctes sont reconnues.
 */

/** Zone du bandeau, en fraction de la fenêtre (capture du 20/10/2026, marge pour la barre de titre). */
const BANNER = { x: 0.4, y: 0.12, width: 0.24, height: 0.13 } as const;
const INTERVAL_MS = 1500;
const MAX_ATTEMPTS = 40;

const require = createRequire(import.meta.url);

type Worker = Awaited<ReturnType<typeof import('tesseract.js').createWorker>>;

export class ScreenTribeReader {
  private worker: Promise<Worker> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private gameIndex: number | undefined;
  private attempts = 0;
  private busy = false;

  constructor(
    private readonly expected: () => number,
    private readonly onTribes: (gameIndex: number, tribes: readonly string[]) => void,
  ) {}

  /** Démarre la lecture pour une partie (sans effet si déjà en cours pour celle-ci). */
  start(gameIndex: number): void {
    if (this.gameIndex === gameIndex) return;
    this.stop();
    this.gameIndex = gameIndex;
    this.attempts = 0;
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
    if (++this.attempts > MAX_ATTEMPTS) {
      this.stop();
      return;
    }
    this.busy = true;
    try {
      const shot = await captureWindow();
      if (shot === undefined) return;
      const tribes = await this.read(shot);
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

  /** Tribus lues sur une image de la fenêtre du jeu (bandeau recadré). */
  async read(image: NativeImage): Promise<string[]> {
    const worker = await this.ensureWorker();
    const { data } = await worker.recognize(bannerPng(image));
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
      const top = BANNER.y * 100 + 2;
      const left = BANNER.x * 100 + 3;
      const html =
        `<body style="margin:0;background:#140c1c;font:bold 21px Georgia,serif">` +
        `<div style="position:absolute;left:${left}%;top:${top}%;width:20%;color:#f3e6ff;white-space:nowrap;` +
        `text-align:center;line-height:1.15">Aberrations, Dragons,<br>Morts-vivants, Pirates,<br>` +
        `Élémentaires</div></body>`;
      await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await new Promise((r) => setTimeout(r, 500));
      const shot = await w.webContents.capturePage();
      if (process.env.BGT_DEBUG === '1') {
        await writeFile(join(app.getPath('userData'), 'ocr-selftest.png'), bannerPng(shot));
      }
      return await this.read(shot);
    } finally {
      w.destroy();
      this.stop();
    }
  }

  /** Vérification de bout en bout sur une capture PNG/JPEG (option --ocr-test). */
  async readFile(path: string): Promise<string[]> {
    try {
      return await this.read(nativeImage.createFromPath(path));
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
    thumbnailSize: { width: 1920, height: 1080 },
    fetchWindowIcons: false,
  });
  const hs = sources.find((s) => s.name === 'Hearthstone');
  return hs === undefined || hs.thumbnail.isEmpty() ? undefined : hs.thumbnail;
}

/** Bandeau des tribus recadré (PNG). */
function bannerPng(image: NativeImage): Buffer {
  const { width, height } = image.getSize();
  return image
    .crop({
      x: Math.round(BANNER.x * width),
      y: Math.round(BANNER.y * height),
      width: Math.round(BANNER.width * width),
      height: Math.round(BANNER.height * height),
    })
    .toPNG();
}
