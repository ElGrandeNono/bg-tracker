import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { emptyTally, mergeTallies, summarize, type Tally } from './monteCarlo.js';
import type { SimInput, SimSummary } from './types.js';
import type { WorkerReply, WorkerTask } from './worker.js';

/**
 * Pool de worker threads : répartit les itérations, fusionne les tranches et publie un résultat
 * qui s'affine au fil des tranches (`onProgress`). Une nouvelle simulation annule la précédente.
 */
export class SimulationPool {
  private readonly workers: Worker[];
  private taskId = 0;
  private current:
    | {
        id: number;
        tally: Tally;
        pending: number;
        resolve: (s: SimSummary) => void;
        input: SimInput;
        onProgress: ((s: SimSummary) => void) | undefined;
      }
    | undefined;

  constructor(
    workerUrl: URL | string,
    size = Math.max(1, Math.min(4, availableParallelism() - 1)),
  ) {
    this.workers = Array.from({ length: size }, () => {
      const w = new Worker(workerUrl);
      w.on('message', (r: WorkerReply) => {
        this.onReply(r);
      });
      w.unref();
      return w;
    });
  }

  get size(): number {
    return this.workers.length;
  }

  run(
    input: SimInput,
    options: {
      iterations?: number;
      seed?: number;
      chunk?: number;
      onProgress?: (s: SimSummary) => void;
    } = {},
  ): Promise<SimSummary> {
    const iterations = options.iterations ?? 10_000;
    const id = ++this.taskId;
    const per = Math.ceil(iterations / this.workers.length);
    return new Promise((resolve) => {
      this.current = {
        id,
        tally: emptyTally(),
        pending: this.workers.length,
        resolve,
        input,
        onProgress: options.onProgress,
      };
      this.workers.forEach((w, i) => {
        const task: WorkerTask = {
          id,
          input,
          iterations:
            Math.min(per, iterations - per * i) > 0 ? Math.min(per, iterations - per * i) : 0,
          seed: ((options.seed ?? Date.now()) + i * 7919) >>> 0,
          chunk: options.chunk ?? 1000,
        };
        if (task.iterations === 0) this.onReply({ id, tally: emptyTally(), done: true });
        else w.postMessage(task);
      });
    });
  }

  private onReply(r: WorkerReply): void {
    const c = this.current;
    if (c === undefined || r.id !== c.id) return; // réponse d'une simulation annulée
    c.tally = mergeTallies(c.tally, r.tally);
    if (r.done) c.pending--;
    const summary = summarize(c.tally, c.input);
    if (c.pending === 0) {
      this.current = undefined;
      c.resolve(summary);
    } else {
      c.onProgress?.(summary);
    }
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}
