import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { numTag, Pipeline, readLogLines, type BoardMinion } from '@bgt/core';
import { simulate } from './monteCarlo.js';
import type { SimInput, SimMinionInput, SimSummary } from './types.js';

/**
 * Le simulateur confronté aux combats réels de la partie complète du 18/10/2026 (plateaux figés à la
 * première attaque, niveaux lus dans `TECH_LEVEL`, plafond lu dans le log).
 *
 * Issues réelles du joueur local (héros Fongimancien Flurgl, 12 d'armure au départ) :
 * combats 1-2 sans dégâts ; défaites 3 (−4, sur l'armure), 4 (−4, armure), 5 (−9 : 4 d'armure +
 * 5 PV), 7 (−10), 8 (−12) ; aucun dégât aux combats 6 et 9 à 13 ; mort au combat 14.
 * Le combat 4 est une défaite que le simulateur ne voit pas (effets de 3 cartes non simulés) :
 * il est exclu des assertions et documenté dans docs/simulator-coverage.md.
 */

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));

const toSim = (b: BoardMinion): SimMinionInput => ({
  cardId: b.cardId,
  attack: b.attack ?? 0,
  health: b.health ?? 1,
  tier: numTag({ id: 0, cardId: b.cardId, tags: b.tags }, 'TECH_LEVEL') ?? 1,
  golden: b.golden,
  taunt: b.tags.TAUNT === 1,
  divineShield: b.tags.DIVINE_SHIELD === 1,
  reborn: b.tags.REBORN === 1,
  venomous: b.tags.VENOMOUS === 1,
  windfury: b.tags.WINDFURY === 1,
  stealth: b.tags.STEALTH === 1,
});

const results = new Map<number, SimSummary>();

beforeAll(async () => {
  const p = new Pipeline();
  p.subscribe(() => {
    const { bg, state } = p.displayed;
    const c = bg.combats.at(-1);
    if (c === undefined || c.endMs !== undefined || !c.boardsLocked || results.has(c.round)) return;
    const g = state.gameEntityId === undefined ? undefined : state.entities.get(state.gameEntityId);
    const cap =
      numTag(g, 'BACON_COMBAT_DAMAGE_CAP_ENABLED') === 1
        ? numTag(g, 'BACON_COMBAT_DAMAGE_CAP')
        : undefined;
    const local = bg.localPlayerId === undefined ? undefined : bg.players[bg.localPlayerId];
    const opp = c.opponentPlayerId === undefined ? undefined : bg.players[c.opponentPlayerId];
    const input: SimInput = {
      a: { minions: c.localBoard.map(toSim), tavernTier: local?.techLevel ?? 1 },
      b: { minions: c.opponentBoard.map(toSim), tavernTier: opp?.techLevel ?? 1 },
      ...(cap === undefined ? {} : { damageCap: cap }),
    };
    results.set(c.round, simulate(input, { iterations: 5000, seed: 2026 }));
  });
  for await (const line of readLogLines(fixture('bg-solo-2026-10-18-complete.Power.log.gz')))
    p.feedLine(line);
}, 120_000);

const r = (round: number): SimSummary => {
  const s = results.get(round);
  if (s === undefined) throw new Error(`combat ${round} non simulé`);
  return s;
};

describe('simulateur contre les combats réels (partie complète)', () => {
  it('14 combats simulés', () => {
    expect(results.size).toBe(14);
  });

  it('combats 1 et 2 : égalités', () => {
    expect(r(1).tie).toBeGreaterThan(0.99);
    expect(r(2).tie).toBeGreaterThan(0.99);
  });

  it.each([
    [3, 4],
    [5, 9],
    [7, 10],
    [8, 12],
  ])(
    'combat %i : défaite prévue et dégâts réels (%i) dans la fourchette simulée',
    (round, damage) => {
      const s = r(round);
      expect(s.loss).toBeGreaterThan(0.95);
      expect(s.damageToA?.min).toBeLessThanOrEqual(damage);
      expect(s.damageToA?.max).toBeGreaterThanOrEqual(damage);
    },
  );

  it.each([6, 9, 10, 11, 12, 13])(
    'combat %i : aucun dégât subi, défaite jugée minoritaire',
    (round) => {
      expect(r(round).loss).toBeLessThan(0.5);
    },
  );

  it('combat 14 : la défaite fatale est l’issue la plus probable', () => {
    expect(r(14).loss).toBeGreaterThan(0.5);
  });
});
