import { describe, expect, it } from 'vitest';
import {
  computePool,
  membership,
  refreshProbability,
  type PoolCard,
  type PoolRules,
} from './pool.js';

// Catalogue et règles synthétiques (forme réelle, valeurs choisies pour le calcul à la main).
const rules: PoolRules = {
  copiesPerTier: {
    1: { value: 15, verified: false },
    2: { value: 15, verified: true },
    3: { value: 13, verified: true },
  },
  shopSlotsPerTier: { 1: 3, 2: 4, 3: 4 },
  tribesPerLobby: 2,
  excludedTribes: ['NAGA'],
  copiesPerGolden: 3,
  eliminatedPlayersReturnMinions: { value: true, verified: false },
};

const card = (
  id: string,
  tier: number,
  tribes: string[],
  extra: Partial<PoolCard> = {},
): PoolCard => ({
  id,
  tier,
  tribes,
  allTribes: false,
  associatedTribes: [],
  goldenId: `${id}_G`,
  ...extra,
});

const catalog: PoolCard[] = [
  card('MURLOC_1', 1, ['MURLOC']),
  card('DEMON_1', 1, ['DEMON']),
  card('NEUTRE_1', 1, []),
  card('NAGA_1', 1, ['NAGA']),
  card('NAGA_DEMON_2', 2, ['NAGA', 'DEMON']),
  card('PIRATE_2', 2, ['PIRATE']),
  card('ALL_3', 3, [], { allTribes: true }),
  card('ASSOC_MURLOC_2', 2, [], { associatedTribes: ['MURLOC'] }),
];

describe('appartenance au pool', () => {
  it('lobby complet : tribus du lobby, neutres, « toutes tribus » ; Nagas exclus sauf double type', () => {
    const lobby = ['MURLOC', 'DEMON'];
    const m = (id: string): string => {
      const c = catalog.find((x) => x.id === id);
      if (c === undefined) throw new Error(id);
      return membership(c, lobby, rules, true);
    };
    expect(m('MURLOC_1')).toBe('in');
    expect(m('NEUTRE_1')).toBe('in');
    expect(m('ALL_3')).toBe('in');
    expect(m('ASSOC_MURLOC_2')).toBe('in');
    expect(m('NAGA_1')).toBe('out');
    expect(m('NAGA_DEMON_2')).toBe('in');
    expect(m('PIRATE_2')).toBe('out');
  });

  it('lobby incomplet : une tribu non identifiée reste « possible »', () => {
    const c = catalog.find((x) => x.id === 'PIRATE_2');
    if (c === undefined) throw new Error();
    expect(membership(c, ['MURLOC'], rules, false)).toBe('possible');
  });
});

describe('computePool', () => {
  it('retire les exemplaires vus, 3 pour un doré, sans descendre sous zéro', () => {
    const pool = computePool(
      catalog,
      rules,
      ['MURLOC', 'DEMON'],
      [
        { cardId: 'MURLOC_1', golden: false, source: 'shop' },
        { cardId: 'MURLOC_1_G', golden: true, source: 'opponent' },
        ...Array.from({ length: 20 }, () => ({
          cardId: 'DEMON_1',
          golden: false,
          source: 'local' as const,
        })),
      ],
    );
    const get = (id: string) => pool.cards.find((c) => c.card.id === id);
    expect(get('MURLOC_1')).toMatchObject({ copies: 15, taken: 4, remaining: 11 });
    expect(get('DEMON_1')?.remaining).toBe(0);
    expect(pool.lobbyComplete).toBe(true);
    const t1 = pool.tiers.find((t) => t.tier === 1);
    // Niveau 1 « in » : MURLOC_1, DEMON_1, NEUTRE_1 → 45 au total, 11 + 0 + 15 restants.
    expect(t1).toMatchObject({ cards: 3, total: 45, remaining: 26, verified: false });
    // ASSOC_MURLOC_2 n'a pas de tribu propre : seul MURLOC_1 compte pour MURLOC.
    expect(pool.byTribe.MURLOC).toBe(11);
  });

  it('probabilité hypergéométrique à la prochaine actualisation', () => {
    const pool = computePool(catalog, rules, ['MURLOC', 'DEMON'], []);
    // Niveau 1 : 3 cartes × 15 = 45 exemplaires, 15 de MURLOC_1, 3 emplacements.
    const expected = 1 - (30 / 45) * (29 / 44) * (28 / 43);
    expect(refreshProbability(pool, 'MURLOC_1', 1, rules)).toBeCloseTo(expected, 10);
    expect(refreshProbability(pool, 'PIRATE_2', 2, rules)).toBe(0); // hors lobby
    expect(refreshProbability(pool, 'NAGA_DEMON_2', 1, rules)).toBe(0); // niveau trop haut
  });
});
