import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Pipeline, readLogLines, type BoardMinion } from '@bgt/core';
import { simulate } from './monteCarlo.js';
import { SimulationPool } from './pool.js';
import type { SimInput, SimMinionInput } from './types.js';

const workerJs = fileURLToPath(new URL('../dist/worker.js', import.meta.url));

const m = (attack: number, health: number): SimMinionInput => ({
  cardId: 'T',
  attack,
  health,
  tier: 1,
});
const input: SimInput = {
  a: { minions: Array.from({ length: 7 }, (_, i) => m(3 + (i % 3), 4)), tavernTier: 4 },
  b: { minions: Array.from({ length: 7 }, (_, i) => m(4, 3 + (i % 2))), tavernTier: 4 },
};

// Le worker est le JavaScript compilé (`pnpm build` précède `pnpm test` en CI).
describe.skipIf(!existsSync(workerJs))('SimulationPool (worker threads)', () => {
  it('répartit les itérations, publie des résultats progressifs et termine au total demandé', async () => {
    const pool = new SimulationPool(workerJs, 2);
    const progress: number[] = [];
    try {
      const s = await pool.run(input, {
        iterations: 10_000,
        seed: 3,
        chunk: 1000,
        onProgress: (p) => progress.push(p.iterations),
      });
      expect(s.iterations).toBe(10_000);
      expect(s.win + s.tie + s.loss).toBeCloseTo(1, 10);
      expect(progress.length).toBeGreaterThan(0);
      expect(progress.every((n, i) => i === 0 || n >= (progress[i - 1] ?? 0))).toBe(true);
      // Même ordre de grandeur que le calcul mono-thread.
      expect(Math.abs(s.win - simulate(input, { iterations: 10_000, seed: 3 }).win)).toBeLessThan(
        0.05,
      );
    } finally {
      await pool.close();
    }
  }, 30_000);
});

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));

const toSim = (b: BoardMinion): SimMinionInput => ({
  cardId: b.cardId,
  attack: b.attack ?? 0,
  health: b.health ?? 1,
  tier: 1,
  golden: b.golden,
  taunt: b.tags.TAUNT === 1,
  divineShield: b.tags.DIVINE_SHIELD === 1,
  reborn: b.tags.REBORN === 1,
  venomous: b.tags.VENOMOUS === 1,
  windfury: b.tags.WINDFURY === 1,
  stealth: b.tags.STEALTH === 1,
});

describe('vrais plateaux des fixtures', () => {
  it('simule chaque combat observé sans erreur', async () => {
    let combats = 0;
    for (const name of [
      'bg-solo-2026-10-18-complete.Power.log.gz',
      'bg-solo-2026-10-18-aberrations.Power.log.gz',
    ]) {
      const p = new Pipeline();
      for await (const line of readLogLines(fixture(name))) p.feedLine(line);
      for (const c of p.bg.combats) {
        if (!c.boardsLocked) continue;
        const s = simulate(
          {
            a: { minions: c.localBoard.map(toSim), tavernTier: 1 },
            b: { minions: c.opponentBoard.map(toSim), tavernTier: 1 },
          },
          { iterations: 500, seed: 1 },
        );
        expect(s.win + s.tie + s.loss).toBeCloseTo(1, 10);
        combats++;
      }
    }
    expect(combats).toBeGreaterThan(15);
  }, 120_000);
});
