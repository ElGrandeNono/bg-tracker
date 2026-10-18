import { parentPort } from 'node:worker_threads';
import { runTally, type Tally } from './monteCarlo.js';
import type { SimInput } from './types.js';

/**
 * Corps d'un worker de simulation : reçoit une tâche, répond par tranches (résultats
 * progressifs). Utilisable tel quel (`dist/worker.js`) ou importé par un point d'entrée empaqueté
 * (voir apps/overlay/src/main/simWorker.ts).
 */

export interface WorkerTask {
  readonly id: number;
  readonly input: SimInput;
  readonly iterations: number;
  readonly seed: number;
  readonly chunk: number;
}

export interface WorkerReply {
  readonly id: number;
  readonly tally: Tally;
  readonly done: boolean;
}

export function startWorker(): void {
  const port = parentPort;
  if (port === null) return;
  port.on('message', (task: WorkerTask) => {
    let left = task.iterations;
    let seed = task.seed;
    while (left > 0) {
      const n = Math.min(task.chunk, left);
      const tally = runTally(task.input, n, seed);
      left -= n;
      seed = (seed * 1_103_515_245 + 12_345) >>> 0;
      const reply: WorkerReply = { id: task.id, tally, done: left === 0 };
      port.postMessage(reply);
    }
  });
}

startWorker();
