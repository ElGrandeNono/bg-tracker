import { describe, expect, it } from 'vitest';
import type { VisibleMinion } from '@bgt/core';
import { tavernBuffs, type BaseCard } from './tavernBuffs.js';

// Boutiques synthétiques (synthetic) : cas ciblés du calcul, cartes fictives.
const BASE: Readonly<Record<string, BaseCard>> = {
  E1: { attack: 2, health: 2, tribes: ['ELEMENTALS'] },
  E2: { attack: 3, health: 1, tribes: ['ELEMENTALS'] },
  M1: { attack: 1, health: 3, tribes: ['MURLOC'] },
  N1: { attack: 2, health: 3, tribes: [] },
};
const m = (cardId: string, attack: number, health: number, golden = false): VisibleMinion => ({
  cardId,
  attack,
  health,
  golden,
  keywords: [],
});
const base = (id: string): BaseCard | undefined => BASE[id];

describe('bonus des serviteurs de la taverne (synthetic)', () => {
  it('aucun bonus : rien', () => {
    expect(tavernBuffs([m('E1', 2, 2), m('M1', 1, 3)], base)).toEqual([]);
  });

  it('bonus commun puis supplément de tribu', () => {
    const shop = [m('E1', 5, 5), m('E2', 6, 4), m('M1', 2, 4), m('N1', 3, 4)];
    expect(tavernBuffs(shop, base)).toEqual([
      { tribe: 'ALL', attack: 1, health: 1 },
      { tribe: 'ELEMENTALS', attack: 2, health: 2 },
    ]);
  });

  it('ignore les dorés et les cartes inconnues', () => {
    expect(tavernBuffs([m('E1', 9, 9, true), m('X', 9, 9)], base)).toEqual([]);
  });
});
