import { setTimeout as sleep } from 'node:timers/promises';
import { parseLine } from '../log/line.js';
import type { Pipeline } from '../pipeline.js';
import { readLogLines } from './readLogLines.js';

export interface ReplayOptions {
  /**
   * Multiplicateur de vitesse : 1 = temps réel, 10 = dix fois plus vite. 0 (défaut) = aussi vite
   * que possible, sans attente.
   */
  readonly speed?: number;
  readonly signal?: AbortSignal;
}

const DAY_MS = 24 * 3600 * 1000;

/**
 * Alimente un pipeline avec un log enregistré, en respectant (optionnellement) le rythme réel
 * des horodatages. C'est exactement le même chemin que le suivi en direct.
 */
export async function replayFile(
  path: string,
  pipeline: Pipeline,
  options: ReplayOptions = {},
): Promise<void> {
  const speed = options.speed ?? 0;
  let lastMs: number | undefined;
  for await (const text of readLogLines(path)) {
    if (options.signal?.aborted === true) break;
    if (speed > 0) {
      const line = parseLine(text);
      if (line.kind === 'log') {
        // Les horodatages n'ont pas de date : un retour en arrière de plus de 12 h = minuit passé.
        let dt = lastMs === undefined ? 0 : line.timeMs - lastMs;
        if (dt < -DAY_MS / 2) dt += DAY_MS;
        if (dt > 0) await sleep(dt / speed);
        lastMs = line.timeMs;
      }
    }
    pipeline.feedLine(text);
  }
  pipeline.end();
}
