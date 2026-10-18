import { describe, expect, it } from 'vitest';
import { CardDb } from './cardDb.js';
import { buildPoolCatalog } from './poolCatalog.js';

// Entrées synthétiques ayant la forme réelle de HearthstoneJSON (champs vérifiés le 18/10/2026).
const db = CardDb.fromRaw([
  {
    id: 'M1',
    dbfId: 1,
    name: 'Méca',
    type: 'MINION',
    techLevel: 1,
    races: ['MECHANICAL'],
    isBattlegroundsPoolMinion: true,
    battlegroundsPremiumDbfId: 2,
  },
  {
    id: 'M1_G',
    dbfId: 2,
    name: 'Méca',
    type: 'MINION',
    techLevel: 1,
    races: ['MECHANICAL'],
    battlegroundsNormalDbfId: 1,
  },
  {
    id: 'Q2',
    dbfId: 3,
    name: 'Hurane',
    type: 'MINION',
    techLevel: 2,
    races: ['QUILBOAR'],
    isBattlegroundsPoolMinion: true,
  },
  {
    id: 'A3',
    dbfId: 4,
    name: 'Amalgame',
    type: 'MINION',
    techLevel: 3,
    races: ['ALL'],
    isBattlegroundsPoolMinion: true,
  },
  {
    id: 'N4',
    dbfId: 5,
    name: 'Neutre lié',
    type: 'MINION',
    techLevel: 4,
    isBattlegroundsPoolMinion: true,
    battlegroundsAssociatedRaces: ['UNDEAD'],
  },
  {
    id: 'D5',
    dbfId: 6,
    name: 'Duos',
    type: 'MINION',
    techLevel: 5,
    races: ['DEMON'],
    isBattlegroundsPoolMinion: true,
    isBattlegroundsDuosExclusive: true,
  },
  { id: 'T6', dbfId: 7, name: 'Jeton', type: 'MINION', techLevel: 1, races: ['BEAST'] },
]);

describe('buildPoolCatalog', () => {
  const catalog = buildPoolCatalog(db);
  const get = (id: string) => catalog.find((c) => c.id === id);

  it('garde le pool solo : ni cartes Duos, ni jetons hors pool, ni versions dorées', () => {
    expect(catalog.map((c) => c.id).sort()).toEqual(['A3', 'M1', 'N4', 'Q2']);
  });

  it('normalise les tribus et relie la version dorée', () => {
    expect(get('M1')).toMatchObject({ tribes: ['MECH'], goldenId: 'M1_G', tier: 1 });
    expect(get('Q2')?.tribes).toEqual(['QUILLBOAR']);
    expect(get('A3')).toMatchObject({ tribes: [], allTribes: true });
    expect(get('N4')).toMatchObject({ tribes: [], associatedTribes: ['UNDEAD'] });
  });
});
