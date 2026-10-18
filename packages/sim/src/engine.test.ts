import { describe, expect, it } from 'vitest';
import { simulateCombat } from './engine.js';
import { simulate } from './monteCarlo.js';
import { DEFAULT_REGISTRY, effectStatus } from './registry.js';
import { Rng } from './rng.js';
import type { SimInput, SimMinionInput } from './types.js';

// Scénarios synthétiques construits pour que l'issue soit certaine quel que soit le tirage :
// on vérifie donc 100 % sur plusieurs graines.

const m = (
  attack: number,
  health: number,
  extra: Partial<SimMinionInput> = {},
): SimMinionInput => ({
  cardId: 'TEST',
  attack,
  health,
  tier: 1,
  ...extra,
});

const fight = (
  a: SimMinionInput[],
  b: SimMinionInput[],
  extra: Partial<SimInput> = {},
): SimInput => ({
  a: { minions: a, tavernTier: 1 },
  b: { minions: b, tavernTier: 1 },
  ...extra,
});

const always = (input: SimInput) => simulate(input, { iterations: 300, seed: 42 });

describe('règles de base', () => {
  it('le plus fort gagne et inflige niveau de taverne + niveaux des survivants', () => {
    const input: SimInput = {
      a: { minions: [m(3, 3, { tier: 3 })], tavernTier: 4 },
      b: { minions: [m(1, 1)], tavernTier: 1 },
    };
    const s = always(input);
    expect(s.win).toBe(1);
    expect(s.damageToB).toEqual({ min: 7, avg: 7, max: 7 });
  });

  it('applique le plafond de dégâts lu dans le log', () => {
    const s = always({
      a: { minions: [m(3, 3, { tier: 3 })], tavernTier: 4 },
      b: { minions: [m(1, 1)], tavernTier: 1 },
      damageCap: 5,
    });
    expect(s.damageToB?.max).toBe(5);
  });

  it('égalité quand il ne reste que des serviteurs sans attaque', () => {
    expect(always(fight([m(0, 1)], [m(0, 1)])).tie).toBe(1);
  });

  it('égalité quand les deux plateaux sont détruits', () => {
    expect(always(fight([m(1, 1)], [m(1, 1)])).tie).toBe(1);
  });

  it('commence le camp qui a le plus de serviteurs', () => {
    // b a 2 serviteurs : son 1/1 de gauche frappe d'abord et tue le 1/1 de a avant qu'il n'attaque.
    const rng = new Rng(7);
    const o = simulateCombat(fight([m(1, 1)], [m(1, 2), m(0, 1)]), rng, DEFAULT_REGISTRY);
    expect(o.result).toBe('loss');
    expect(o.attacks).toBe(1);
  });
});

describe('mots-clés', () => {
  it('Provocation : attaquée en priorité', () => {
    // Le 1/1 de a frappe la Provocation 0/9 neuf fois avant de pouvoir toucher le 0/1.
    const rng = new Rng(3);
    for (let i = 0; i < 20; i++) {
      const o = simulateCombat(
        fight([m(1, 1)], [m(0, 1), m(0, 9, { taunt: true })]),
        rng,
        DEFAULT_REGISTRY,
      );
      expect(o.attacks).toBe(10);
    }
  });

  it('Bouclier divin : absorbe le premier coup', () => {
    expect(always(fight([m(2, 2)], [m(2, 2, { divineShield: true })])).loss).toBe(1);
  });

  it('Venimeux : détruit seulement le premier serviteur touché', () => {
    const rng = new Rng(5);
    const o = simulateCombat(
      fight([m(1, 1, { venomous: true })], [m(0, 10), m(0, 10)]),
      rng,
      DEFAULT_REGISTRY,
    );
    expect(o.result).toBe('win');
    expect(o.attacks).toBe(1 + 10);
  });

  it('Venimeux bloqué par un Bouclier divin, puis consommé au coup suivant', () => {
    // Le bouclier absorbe le premier coup (Venimeux conservé), le second détruit le 0/10.
    const rng = new Rng(9);
    const o = simulateCombat(
      fight([m(1, 1, { venomous: true })], [m(0, 10, { divineShield: true })]),
      rng,
      DEFAULT_REGISTRY,
    );
    expect(o.attacks).toBe(2);
  });

  it('Réincarnation : revient avec 1 PV', () => {
    // 2/1 contre 1/4 : sans Réincarnation, défaite ; avec, il frappe une seconde fois → égalité.
    expect(always(fight([m(2, 1)], [m(1, 4)])).loss).toBe(1);
    expect(always(fight([m(2, 1, { reborn: true })], [m(1, 4)])).tie).toBe(1);
  });

  it('Réincarnation : revient comme la carte d’origine (Bouclier divin retrouvé)', () => {
    // 1/1 Bouclier divin + Réincarnation, bouclier déjà perdu, contre un 1/3 :
    // sans les caractéristiques de base il revient sans bouclier (le 1/3 survit : défaite) ;
    // avec, son bouclier absorbe un coup et il achève le 1/3 en mourant (égalité, quel que soit
    // l'ordre des attaques).
    const gardien = (withBase: boolean): SimMinionInput =>
      m(1, 1, {
        reborn: true,
        ...(withBase
          ? {
              base: {
                attack: 1,
                taunt: false,
                divineShield: true,
                venomous: false,
                windfury: false,
              },
            }
          : {}),
      });
    expect(always(fight([gardien(false)], [m(1, 3)])).loss).toBe(1);
    expect(always(fight([gardien(true)], [m(1, 3)])).tie).toBe(1);
  });

  it('Furie des vents : deux attaques par tour', () => {
    const rng = new Rng(11);
    const o = simulateCombat(
      fight([m(1, 10, { windfury: true })], [m(0, 2)]),
      rng,
      DEFAULT_REGISTRY,
    );
    expect(o.result).toBe('win');
    expect(o.attacks).toBe(2);
  });

  it('Camouflage : non ciblé tant qu’une autre cible existe', () => {
    const rng = new Rng(13);
    for (let i = 0; i < 20; i++) {
      // a frappe forcément le 0/3 visible (3 coups) avant le 0/1 camouflé.
      const o = simulateCombat(
        fight([m(1, 5)], [m(0, 3), m(0, 1, { stealth: true })]),
        rng,
        DEFAULT_REGISTRY,
      );
      expect(o.attacks).toBe(4);
    }
  });
});

describe('registre d’effets', () => {
  it('Tireur de câble : invoque un microbot 1/1 (doré : 2/2)', () => {
    const tireur = (golden: boolean): SimMinionInput =>
      m(0, 1, { cardId: golden ? 'BG29_611_G' : 'BG29_611', golden });
    // Sans Râle d'agonie, le 1/1 adverse gagnerait ; le microbot 1/1 l'échange (égalité),
    // le microbot doré 2/2 le tue et survit (victoire).
    expect(always(fight([tireur(false)], [m(1, 1)])).tie).toBe(1);
    expect(always(fight([tireur(true)], [m(1, 1)])).win).toBe(1);
    expect(always(fight([m(0, 1)], [m(1, 1)])).loss).toBe(1);
  });

  it('Gardien de la lueur : Ralliement +2 ATQ avant le coup (doré : +4)', () => {
    const rng = new Rng(21);
    const gardien = (golden: boolean): SimMinionInput =>
      m(golden ? 2 : 1, golden ? 8 : 4, { cardId: 'BG29_888', golden });
    // Contre un 0/6 : normal 3 puis 5 (2 coups) ; doré 2+4 = 6 (1 coup).
    expect(simulateCombat(fight([gardien(false)], [m(0, 6)]), rng, DEFAULT_REGISTRY).attacks).toBe(
      2,
    );
    expect(simulateCombat(fight([gardien(true)], [m(0, 6)]), rng, DEFAULT_REGISTRY).attacks).toBe(
      1,
    );
  });

  it('Crache-bile : Ralliement, confère Venimosité à un autre Murloc', () => {
    const rng = new Rng(23);
    const crache = m(1, 10, { cardId: 'BG33_318', venomous: true, tribes: ['MURLOC'] });
    const allie = m(1, 30, { tribes: ['MURLOC'] });
    // Crache-bile détruit la 1re cible (Venimosité) et rend le Murloc allié venimeux : 2 coups.
    const o = simulateCombat(fight([crache, allie], [m(0, 50), m(0, 50)]), rng, DEFAULT_REGISTRY);
    expect(o.result).toBe('win');
    expect(o.attacks).toBe(2);
    // L'allié non Murloc ne reçoit rien : il lui faut 50 coups pour la seconde cible.
    const autre = m(1, 30, { tribes: ['MECH'] });
    expect(
      simulateCombat(fight([crache, autre], [m(0, 50), m(0, 50)]), rng, DEFAULT_REGISTRY).attacks,
    ).toBe(51);
  });

  it('Élémentaire du feu de brousse : le surplus de dégâts tue un voisin de la cible', () => {
    const rng = new Rng(29);
    // 6 ATQ sur la Provocation 0/1 : 5 de surplus sur un des deux 0/4 adjacents → 2 coups au total.
    const board = [m(0, 4), m(0, 1, { taunt: true }), m(0, 4)];
    for (let i = 0; i < 10; i++) {
      expect(
        simulateCombat(fight([m(6, 30, { cardId: 'BGS_126' })], board), rng, DEFAULT_REGISTRY)
          .attacks,
      ).toBe(2);
    }
    expect(simulateCombat(fight([m(6, 30)], board), rng, DEFAULT_REGISTRY).attacks).toBe(3);
  });

  it('Début du combat : exact sur un plateau figé, approximatif sinon ; doré non vérifié', () => {
    expect(effectStatus('BG27_556', ['TRIGGER_VISUAL'], { startOfCombatApplied: true })).toBe(
      'supported',
    );
    expect(effectStatus('BG27_556', ['TRIGGER_VISUAL'])).toBe('unsupported');
    expect(effectStatus('BGS_126', ['TRIGGER_VISUAL'])).toBe('supported');
    expect(effectStatus('BGS_126', ['TRIGGER_VISUAL'], { golden: true })).toBe('unsupported');
    expect(effectStatus('BG36_703', ['TRIGGER_VISUAL'])).toBe('supported'); // déclencheur de recrutement
  });

  it('statut de simulation selon les mécaniques et le registre', () => {
    expect(effectStatus('BG29_611', ['DEATHRATTLE', 'DIVINE_SHIELD'])).toBe('supported');
    expect(effectStatus('BG32_336_G', ['DEATHRATTLE'])).toBe('supported');
    expect(effectStatus('INCONNU', ['TAUNT', 'BATTLECRY'])).toBe('none');
    expect(effectStatus('INCONNU', ['START_OF_COMBAT'])).toBe('unsupported');
    expect(effectStatus('INCONNU', undefined)).toBe('unsupported');
  });

  it('résultat « approximatif » dès qu’une carte n’est pas simulée', () => {
    const s = always(fight([m(2, 2, { cardId: 'X', unsupportedEffect: true })], [m(1, 1)]));
    expect(s.approximate).toBe(true);
    expect(s.unsupportedCards).toEqual(['X']);
  });
});

describe('Monte Carlo', () => {
  const board = (n: number, atk: number, hp: number): SimMinionInput[] =>
    Array.from({ length: n }, (_, i) =>
      m(atk + (i % 3), hp + (i % 2), { taunt: i === 2, divineShield: i === 4 }),
    );

  it('déterministe à graine égale', () => {
    const input = fight(board(7, 3, 4), board(7, 3, 4));
    expect(simulate(input, { iterations: 2000, seed: 99 })).toEqual(
      simulate(input, { iterations: 2000, seed: 99 }),
    );
  });

  it('probabilités cohérentes et létal calculé avec les PV', () => {
    const s = simulate(
      {
        a: { minions: board(7, 5, 5), tavernTier: 4, heroHealth: 10 },
        b: { minions: board(3, 1, 1), tavernTier: 2, heroHealth: 3 },
      },
      { iterations: 1000, seed: 1 },
    );
    expect(s.win + s.tie + s.loss).toBeCloseTo(1, 10);
    expect(s.win).toBe(1);
    expect(s.lethalForA).toBe(1);
  });

  it('10 000 combats 7 contre 7 en moins d’une seconde (un seul thread)', () => {
    const input = fight(board(7, 4, 6), board(7, 4, 6));
    const t0 = performance.now();
    simulate(input, { iterations: 10_000, seed: 1 });
    const ms = performance.now() - t0;
    console.log(`10 000 combats 7v7 : ${Math.round(ms)} ms`);
    // Marge pour les machines de CI ; l'objectif produit est < 1 s.
    expect(ms).toBeLessThan(3000);
  });
});
