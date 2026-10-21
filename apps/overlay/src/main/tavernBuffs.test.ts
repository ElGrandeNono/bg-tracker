import { describe, expect, it } from 'vitest';
import { trackTavernBuffs } from './tavernBuffs.js';

// Enchantements de boutique synthétiques (synthetic), valeurs du log réel du 22/10/2026.
const gem = (attack: number, health: number, minions: number) => ({
  cardId: 'BG20_GEMe',
  attack,
  health,
  minions,
});

describe('bonus de la taverne', () => {
  it('suit la progression d’un enchantement porté par toute la boutique', () => {
    let m = trackTavernBuffs(new Map(), [gem(6, 5, 4)]);
    expect([...m.values()]).toEqual([{ source: 'BG20_GEMe', attack: 6, health: 5 }]);
    m = trackTavernBuffs(m, [gem(18, 17, 5)]);
    expect(m.get('BG20_GEMe')).toEqual({ source: 'BG20_GEMe', attack: 18, health: 17 });
  });

  it('garde la dernière valeur quand la boutique ne le montre plus', () => {
    const m = trackTavernBuffs(trackTavernBuffs(new Map(), [gem(6, 5, 3)]), []);
    expect(m.get('BG20_GEMe')?.attack).toBe(6);
  });

  it('gemmes de sang : une seule ligne pour les deux enchantements de même valeur', () => {
    const m = trackTavernBuffs(new Map(), [
      gem(6, 5, 4),
      { ...gem(6, 5, 4), cardId: 'BG20_GEMe2' },
    ]);
    expect([...m.keys()]).toEqual(['BG20_GEMe2']);
  });

  it('ignore un bonus posé sur un seul serviteur', () => {
    expect(trackTavernBuffs(new Map(), [gem(2, 2, 1)]).size).toBe(0);
  });
});
