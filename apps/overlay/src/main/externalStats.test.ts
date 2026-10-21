import { describe, expect, it } from 'vitest';
import type { CardDb, CardInfo } from '@bgt/data';
import { matchRows, parseStatsCopy, statsFor } from './externalStats.js';

// Copies SYNTHÉTIQUES (synthetic) au format observé sur HSReplay le 21/10/2026 : noms réels de
// cartes, chiffres inventés. Aucune donnée HSReplay n'est versionnée (propriété du site).

const HEROES = [
  'Battlegrounds Heroes',
  'Tier',
  'Hero',
  'Pick Rate',
  '',
  'Marin the Manager, 12 Armor',
  '',
  '12',
  'Marin the Manager',
  'On Turn 5, choose a Lesser Trinket to buy.',
  '50.0%',
  '—',
  '—',
  'Unlock with Tier7',
  '—',
  '',
  "Tras'tath, Soul Parasite, 15 Armor",
  '',
  '15',
  "Tras'tath, Soul Parasite",
  'At the start of the game, Discover a Tier 5 minion.',
  '40.5%',
  '4.12',
].join('\r\n');

const TRINKETS = [
  'Battlegrounds Trinkets',
  'Trinket',
  '',
  '6',
  'Eternal Portrait',
  'Get an Eternal Knight.',
  '20.0%',
  '3.50',
  '1st Place: 10%',
  '2nd Place: 20%',
  '3rd Place: 20%',
  '4th Place: 10%',
  '5th Place: 10%',
  '6th Place: 10%',
  '7th Place: 10%',
  '8th Place: 10%',
  '',
  '2',
  'Colorful CompassDemon',
  'Get a random 92.',
  '40.0%',
  '3.00',
  '',
  '2',
  'Colorful CompassMurloc',
  'Get a random 92.',
  '60.0%',
  '5.00',
].join('\n');

const card = (id: string, name: string, extra: Partial<CardInfo>): CardInfo =>
  ({
    id,
    name,
    battlegroundsHero: false,
    battlegroundsSkinParentId: undefined,
    ...extra,
  }) as CardInfo;

const db = {
  toJSON: () => [
    card('BG30_HERO_304', 'Marin the Manager', { battlegroundsHero: true }),
    card('BG30_HERO_304_SKIN_A', 'Marin the Manager', {
      battlegroundsHero: true,
      battlegroundsSkinParentId: 1,
    }),
    card('BG31_HERO_811', "Tras'tath, Soul Parasite", { battlegroundsHero: true }),
    card('BG30_MagicItem_301', 'Eternal Portrait', { type: 'BATTLEGROUND_TRINKET' }),
    card('BG30_MagicItem_426', 'Colorful Compass', { type: 'BATTLEGROUND_TRINKET' }),
  ],
} as unknown as CardDb;

describe('stats externes copiées depuis HSReplay (synthetic)', () => {
  it('héros : taux de choix, place moyenne seulement si fournie (Tier7)', () => {
    const page = parseStatsCopy(HEROES);
    expect(page?.page).toBe('heroes-solo');
    const { cards, unmatched } = matchRows(page ?? { page: 'heroes-solo', rows: [] }, db);
    expect(unmatched).toEqual([]);
    expect(cards.BG30_HERO_304).toMatchObject({ pickRate: 0.5, avgPlacement: undefined });
    expect(cards.BG31_HERO_811).toMatchObject({ pickRate: 0.405, avgPlacement: 4.12 });
    expect(cards.BG30_HERO_304_SKIN_A).toBeUndefined(); // héros de base seulement
  });

  it('bibelots : place moyenne, répartition, variantes de tribu', () => {
    const page = parseStatsCopy(TRINKETS);
    expect(page?.page).toBe('trinkets');
    const { cards } = matchRows(page ?? { page: 'trinkets', rows: [] }, db);
    expect(cards.BG30_MagicItem_301?.avgPlacement).toBe(3.5);
    expect(cards.BG30_MagicItem_301?.distribution).toHaveLength(8);
    expect(Object.keys(cards)).toContain('BG30_MagicItem_426#DEMON');
    // Variantes : celles des tribus du lobby, sinon toutes.
    expect(statsFor(cards, 'BG30_MagicItem_426', ['DEMON'])).toMatchObject({
      avgPlacement: 3,
      variants: 1,
    });
    expect(statsFor(cards, 'BG30_MagicItem_426', [])).toMatchObject({
      avgPlacement: 4,
      pickRate: 0.5,
      variants: 2,
    });
  });

  it('page inconnue : rien', () => {
    expect(parseStatsCopy('Bonjour')).toBeUndefined();
  });
});
