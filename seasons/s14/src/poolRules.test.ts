import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { buildVisibleView, Pipeline, readLogLines } from '@bgt/core';
import { S14_POOL_RULES } from './poolRules.js';

/**
 * Les règles de saison confrontées aux vrais logs : la boutique vue (serviteurs du dummy en jeu
 * pendant le recrutement) ne dépasse jamais le nombre d'emplacements du niveau de taverne, et
 * chaque niveau visité l'atteint au moins une fois (elle se vide à mesure qu'on achète).
 */

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));

describe('emplacements de boutique (saison 14) sur les fixtures', () => {
  it.each([
    'bg-solo-2026-10-18-complete.Power.log.gz',
    'bg-solo-2026-10-18-aberrations.Power.log.gz',
  ])(
    '%s',
    async (name) => {
      const p = new Pipeline();
      const rounds = new Map<number, { startTier: number; endTier: number; maxShop: number }>();
      p.subscribe(() => {
        const { bg, state } = p.displayed;
        if (bg.phase !== 'recruit') return;
        const v = buildVisibleView(bg, state);
        const tier = v.local.techLevel ?? 1;
        const shop = v.poolSightings.filter((s) => s.source === 'shop').length;
        const r = rounds.get(v.round) ?? { startTier: tier, endTier: tier, maxShop: 0 };
        rounds.set(v.round, { ...r, endTier: tier, maxShop: Math.max(r.maxShop, shop) });
      });
      for await (const line of readLogLines(fixture(name))) p.feedLine(line);
      p.end();

      const slots = S14_POOL_RULES.shopSlotsPerTier;
      expect(rounds.size).toBeGreaterThan(3);
      for (const [round, r] of rounds) {
        const allowed = [slots[r.startTier], slots[r.endTier]];
        expect(r.maxShop, `tour ${round}`).toBeLessThanOrEqual(
          Math.max(...allowed.map((x) => x ?? 0)),
        );
      }
      // Chaque niveau stable (même niveau en début et fin de tour) atteint au moins une fois
      // son nombre d'emplacements (la boutique se vide quand on achète).
      const stable = [...rounds.values()].filter((r) => r.startTier === r.endTier);
      for (const tier of new Set(stable.map((r) => r.startTier))) {
        const best = Math.max(...stable.filter((r) => r.startTier === tier).map((r) => r.maxShop));
        expect(best, `niveau ${tier}`).toBe(slots[tier]);
      }
    },
    120_000,
  );
});
