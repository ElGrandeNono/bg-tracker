import { EventEmitter } from 'node:events';
import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

/**
 * Suivi en continu (tail) du `Power.log` de la session de jeu la plus récente.
 *
 * - Le jeu écrit un dossier par lancement : `Logs/Hearthstone_AAAA_MM_JJ_hh_mm_ss/Power.log`.
 *   Le nom encode la date, donc l'ordre lexicographique est l'ordre chronologique.
 * - Polling plutôt que `fs.watch` : `fs.watch` est peu fiable sous Windows pour un fichier
 *   ouvert en écriture par un autre processus.
 * - Fichier qui raccourcit (troncature/rotation) : on relit depuis le début du nouveau contenu
 *   et on émet `shrunk`. L'état de la partie n'est JAMAIS remis à zéro ici ; c'est au pipeline
 *   de signaler « log tronqué ». Ce que le jeu écrit après une troncature n'est pas présumé.
 * - Nouveau dossier de session (jeu relancé) : on bascule dessus et on émet `fileChanged`.
 */

export interface LogWatcherOptions {
  /** Dossier `Logs` du jeu (contient les `Hearthstone_*`). */
  readonly logsRoot: string;
  readonly fileName?: string;
  readonly pollMs?: number;
  /**
   * true (défaut) : lit le fichier courant depuis le début, pour reconstruire une partie déjà
   * commencée quand le tracker démarre en cours de partie.
   */
  readonly fromStart?: boolean;
}

export interface LogWatcherEvents {
  line: [text: string];
  fileChanged: [path: string];
  shrunk: [path: string, previousSize: number, newSize: number];
  error: [error: Error];
}

const SESSION_DIR = /^Hearthstone_\d{4}_\d\d_\d\d_\d\d_\d\d_\d\d$/;

export async function latestSessionDir(logsRoot: string): Promise<string | undefined> {
  let names: string[];
  try {
    names = await readdir(logsRoot);
  } catch {
    return undefined;
  }
  const latest = names
    .filter((n) => SESSION_DIR.test(n))
    .sort()
    .at(-1);
  return latest === undefined ? undefined : join(logsRoot, latest);
}

/** Date de la session déduite du nom de dossier (les lignes du log n'ont que l'heure). */
export function sessionDate(dirName: string): Date | undefined {
  const m = /Hearthstone_(\d{4})_(\d\d)_(\d\d)_(\d\d)_(\d\d)_(\d\d)$/.exec(dirName);
  if (m === null) return undefined;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return new Date(y, mo - 1, d, h, mi, s);
}

export class LogWatcher extends EventEmitter<LogWatcherEvents> {
  private readonly fileName: string;
  private readonly pollMs: number;
  private path: string | undefined;
  private offset = 0;
  private decoder = new StringDecoder('utf8');
  private partial = '';
  private timer: NodeJS.Timeout | undefined;
  private polling = false;
  private first = true;

  constructor(private readonly options: LogWatcherOptions) {
    super();
    this.fileName = options.fileName ?? 'Power.log';
    this.pollMs = options.pollMs ?? 100;
  }

  get currentPath(): string | undefined {
    return this.path;
  }

  start(): void {
    if (this.timer !== undefined) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.pollMs);
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Un cycle de lecture ; exposé pour les tests. */
  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      await this.pollOnce();
    } catch (e) {
      this.emit('error', e instanceof Error ? e : new Error(String(e)));
    } finally {
      this.polling = false;
    }
  }

  private async pollOnce(): Promise<void> {
    const dir = await latestSessionDir(this.options.logsRoot);
    if (dir === undefined) return;
    const path = join(dir, this.fileName);
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      return; // le jeu n'a pas encore créé le fichier
    }

    if (path !== this.path) {
      const isInitial = this.path === undefined;
      this.path = path;
      this.resetReader(isInitial && this.first && this.options.fromStart === false ? size : 0);
      this.first = false;
      this.emit('fileChanged', path);
    }

    if (size < this.offset) {
      const previous = this.offset;
      this.flushPartial();
      this.resetReader(0);
      this.emit('shrunk', path, previous, size);
    }
    if (size > this.offset) await this.readRange(path, this.offset, size);
  }

  private resetReader(offset: number): void {
    this.offset = offset;
    this.decoder = new StringDecoder('utf8');
    this.partial = '';
  }

  private async readRange(path: string, start: number, end: number): Promise<void> {
    const handle = await open(path, 'r');
    try {
      const chunk = Buffer.alloc(Math.min(end - start, 4 * 1024 * 1024));
      let pos = start;
      while (pos < end) {
        const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, end - pos), pos);
        if (bytesRead === 0) break;
        pos += bytesRead;
        this.consume(this.decoder.write(chunk.subarray(0, bytesRead)));
      }
      this.offset = pos;
    } finally {
      await handle.close();
    }
  }

  private consume(text: string): void {
    const parts = (this.partial + text).split('\n');
    this.partial = parts.pop() ?? '';
    for (const part of parts) this.emit('line', part.endsWith('\r') ? part.slice(0, -1) : part);
  }

  /** Une ligne sans fin de ligne au moment d'une troncature est émise telle quelle. */
  private flushPartial(): void {
    const rest = this.partial + this.decoder.end();
    this.partial = '';
    if (rest.length > 0) this.emit('line', rest.endsWith('\r') ? rest.slice(0, -1) : rest);
  }
}
