import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { buildVisibleView, Pipeline, readLogLines, sessionDate } from '@bgt/core';
import { GameRecorder } from './recorder.js';
import type { GameRecord } from './types.js';

/**
 * Import des anciennes parties : rejoue chaque `Logs/Hearthstone_…/Power.log` comme en direct
 * (horloge d'affichage comprise) et en tire les `GameRecord`. Les doublons sont gérés par le
 * stockage (clé build + date + héros).
 */

export interface ImportOptions {
  /** Power.log suivi en direct, à ne pas importer (partie en cours). */
  readonly exclude?: string | undefined;
  /** Héros de base (skins) via les données de cartes. */
  readonly heroBase?: (cardId: string) => string;
  readonly onFile?: (index: number, total: number, sessionDir: string) => void;
}

const SESSION_DIR = /^Hearthstone_\d{4}(_\d\d){5}$/;

export async function findSessionLogs(logsRoot: string): Promise<string[]> {
  let dirs: string[];
  try {
    dirs = (await readdir(logsRoot)).filter((d) => SESSION_DIR.test(d)).sort();
  } catch {
    return [];
  }
  return dirs.map((d) => join(logsRoot, d, 'Power.log')).filter((f) => existsSync(f));
}

/** Parties BG d'un fichier Power.log (le dossier parent donne la date de la session). */
export async function recordLogFile(
  file: string,
  heroBase: (cardId: string) => string = (id) => id,
): Promise<GameRecord[]> {
  const recorder = new GameRecorder(heroBase, sessionDate(basename(dirname(file))));
  const pipeline = new Pipeline();
  const out: GameRecord[] = [];
  const observe = (): void => {
    const r = recorder.observe(buildVisibleView(pipeline.displayed.bg, pipeline.displayed.state));
    if (r !== undefined) out.push(r);
  };
  pipeline.subscribe(observe);
  for await (const line of readLogLines(file)) pipeline.feedLine(line);
  pipeline.end();
  observe();
  const last = recorder.flush();
  if (last !== undefined) out.push(last);
  return out;
}

export async function importLogFolder(
  logsRoot: string,
  options: ImportOptions = {},
): Promise<GameRecord[]> {
  const exclude = options.exclude === undefined ? undefined : resolve(options.exclude);
  const files = (await findSessionLogs(logsRoot)).filter((f) => resolve(f) !== exclude);
  const records: GameRecord[] = [];
  for (const [i, file] of files.entries()) {
    options.onFile?.(i, files.length, basename(dirname(file)));
    try {
      records.push(...(await recordLogFile(file, options.heroBase)));
    } catch {
      // fichier illisible ou verrouillé : on passe au suivant
    }
  }
  return records;
}
