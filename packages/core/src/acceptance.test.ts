import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { estimateLobbyTribes } from './bg/tribes.js';
import { Pipeline } from './pipeline.js';
import { readLogLines } from './replay/readLogLines.js';

/**
 * Tests d'acceptation M1 sur les deux vrais logs anonymisés (fixtures/README.md).
 * Vérité terrain de la partie complète donnée par l'utilisateur, qui l'a jouée.
 */

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));

async function replay(name: string): Promise<Pipeline> {
  const p = new Pipeline();
  for await (const line of readLogLines(fixture(name))) p.feedLine(line);
  p.end();
  return p;
}

describe('partie complète du 18/10/2026 (build 254477)', () => {
  let p: Pipeline;
  beforeAll(async () => {
    p = await replay('bg-solo-2026-10-18-complete.Power.log.gz');
  }, 120_000);

  it('reconnaît une partie BG solo du bon build', () => {
    expect(p.bg.isBattlegrounds).toBe(true);
    expect(p.bg.build).toBe('254477');
    expect(p.bg.mode).toBe('solo');
    expect(p.bg.truncated).toBe(false);
  });

  it('retrouve le héros joué : Fongimancien Flurgl', () => {
    const local = p.bg.players[p.bg.localPlayerId ?? -1];
    expect(local?.heroCardId).toBe('TB_BaconShop_HERO_55');
  });

  it('retrouve la place finale 3', () => {
    expect(p.bg.finalPlace).toBe(3);
    expect(p.bg.phase).toBe('over');
    expect(p.bg.outcome).toBe('finished');
  });

  it('a 8 joueurs avec des places finales distinctes de 1 à 8', () => {
    const places = Object.values(p.bg.players).map((pl) => pl.place);
    expect(places).toHaveLength(8);
    expect([...places].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('identifie les 5 tribus réelles du lobby', () => {
    const lobby = estimateLobbyTribes(p.bg.tribes);
    expect([...lobby.identified].sort()).toEqual([
      'DEMON',
      'DRAGON',
      'ELEMENTALS',
      'MECH',
      'MURLOC',
    ]);
  });

  it('niveau de taverne 6 et 5 triples pour le joueur local', () => {
    const local = p.bg.players[p.bg.localPlayerId ?? -1];
    expect(local?.techLevel).toBe(6);
    expect(local?.triples).toBe(5);
  });

  it('chaque combat a un adversaire nommé, différent du joueur local', () => {
    expect(p.bg.combats.length).toBeGreaterThan(10);
    for (const c of p.bg.combats) {
      expect(c.opponentPlayerId).not.toBe(p.bg.localPlayerId);
      expect(c.opponentPlayerId).toBeDefined();
    }
  });

  it('ne laisse aucune ligne Power non reconnue', () => {
    expect(p.parser.diagnostics.samples).toEqual([]);
  });
});

describe('partie tronquée du 21/09/2026 (build 251952)', () => {
  let p: Pipeline;
  beforeAll(async () => {
    p = await replay('bg-solo-2026-09-21-tronque.Power.log.gz');
  }, 120_000);

  it('signale la troncature sans perdre l’état', () => {
    expect(p.bg.truncated).toBe(true);
    expect(p.bg.timeline.map((e) => e.kind).slice(-2)).toEqual(['truncated', 'interrupted']);
    expect(p.bg.round).toBeGreaterThanOrEqual(6);
    expect(Object.keys(p.bg.players)).toHaveLength(8);
  });

  it('ne présente pas de place finale', () => {
    expect(p.bg.finalPlace).toBeUndefined();
    expect(p.bg.outcome).toBe('interrupted');
  });

  it('retrouve les adversaires 4, 7, 3, 2, 5, 6 des six combats', () => {
    expect(p.bg.combats.map((c) => c.opponentPlayerId)).toEqual([4, 7, 3, 2, 5, 6]);
  });
});

describe('partie abandonnée du 18/10/2026 (build 254477)', () => {
  let p: Pipeline;
  beforeAll(async () => {
    p = await replay('bg-solo-2026-10-18-abandon.Power.log.gz');
  }, 120_000);

  it('reconnaît la partie et le héros Yeux-de-Serpent', () => {
    expect(p.bg.isBattlegrounds).toBe(true);
    expect(p.bg.build).toBe('254477');
    expect(p.bg.localPlayerId).toBe(1);
    expect(p.bg.players[1]?.heroCardId).toBe('BG28_HERO_400');
  });

  it('TURN 1 à 5 : 3 tours de recrutement, 2 combats', () => {
    expect(p.bg.gameTurn).toBe(5);
    expect(p.bg.round).toBe(3);
    expect(p.bg.combats).toHaveLength(2);
  });

  it('niveau de taverne : 2 au plus dans le lobby, 1 pour le joueur local d’après le log', () => {
    // L'utilisateur était au niveau 2 au moment d'abandonner, mais le log s'arrête avant :
    // aucun achat d'amélioration du joueur local n'y figure, son héros (#101) reste à 1.
    const levels = Object.values(p.bg.players).map((pl) => pl.techLevel ?? 0);
    expect(Math.max(...levels)).toBe(2);
    expect(p.bg.players[1]?.techLevel).toBe(1);
  });

  it('marque la partie « abandonnée » : place 8 finale non retenue', () => {
    expect(p.bg.truncated).toBe(false);
    expect(p.bg.outcome).toBe('abandoned');
    expect(p.bg.finalPlace).toBeUndefined();
    expect(p.bg.players[1]?.place).toBeUndefined();
    expect(p.bg.placeBeforeAbandon).toBe(7); // passait de 7 à 8
    expect(p.bg.timeline.at(-1)?.kind).toBe('abandoned');
    expect(p.bg.timeline.some((e) => e.kind === 'eliminated' || e.kind === 'gameOver')).toBe(false);
  });

  it('tribes vues : DEMON, DRAGON, ELEMENTALS, NAGA, PIRATE, QUILLBOAR', () => {
    expect(Object.keys(p.bg.tribes.cards).sort()).toEqual([
      'DEMON',
      'DRAGON',
      'ELEMENTALS',
      'NAGA',
      'PIRATE',
      'QUILLBOAR',
    ]);
  });

  it('recolle les noms d’entité coupés par un saut de ligne', () => {
    expect(p.parser.diagnostics.samples).toEqual([]);
  });
});

describe('partie abandonnée aux Aberrations du 18/10/2026 (build 254477)', () => {
  let p: Pipeline;
  beforeAll(async () => {
    p = await replay('bg-solo-2026-10-18-aberrations.Power.log.gz');
  }, 120_000);

  it('reconnaît une partie solo, joueur local 7 (Onyxia, entité 90)', () => {
    expect(p.bg.mode).toBe('solo');
    expect(p.bg.build).toBe('254477');
    expect(p.bg.localPlayerId).toBe(7);
    expect(p.bg.players[7]?.heroCardId).toBe('BG22_HERO_305');
    expect(p.bg.players[7]?.heroEntityId).toBe(90);
  });

  it('TURN 1 à 9 : 5 tours de recrutement, 4 combats, taverne 3 au plus dans le lobby', () => {
    expect(p.bg.gameTurn).toBe(9);
    expect(p.bg.round).toBe(5);
    expect(p.bg.combats).toHaveLength(4);
    const levels = Object.values(p.bg.players).map((pl) => pl.techLevel ?? 0);
    expect(Math.max(...levels)).toBe(3);
    expect(p.bg.players[7]?.techLevel).toBe(2); // amélioration achetée à 19:59:07
  });

  it('abandon : 3e juste avant, le 8 final n’est pas un classement', () => {
    expect(p.bg.outcome).toBe('abandoned');
    expect(p.bg.finalPlace).toBeUndefined();
    expect(p.bg.placeBeforeAbandon).toBe(3);
    expect(p.bg.players[7]?.place).toBeUndefined();
  });

  it('détecte la tribu ABERRATION via CARDRACE et BACON_SUBSET_ABERRATION', () => {
    const aberrations = [...p.state.entities.values()].filter(
      (e) => e.tags.CARDRACE === 'ABERRATION',
    );
    // 45 lignes CARDRACE=ABERRATION, une entité décrite deux fois : 44 entités (l'utilisateur
    // en a compté 43 de son côté).
    expect(aberrations).toHaveLength(44);
    expect(new Set(aberrations.map((e) => e.cardId))).toEqual(
      new Set(['BG36_098', 'BG36_099', 'BG36_100', 'BG36_113', 'BGFYM_000']),
    );
  });

  it('compte les Aberrations vues : les 4 jouées et C’Thun invoqué en combat', () => {
    // C'Thun (BGFYM_000) naît en SETASIDE puis entre en PLAY au combat 4 : le client l'affiche
    // de 20:02:38 à 20:02:49 (PowerTaskList). Visible, donc compté ; ce n'est pas une carte du
    // pool (à exclure du pool tracker, M3).
    expect([...(p.bg.tribes.cards.ABERRATION ?? [])].sort()).toEqual([
      'BG36_098',
      'BG36_099',
      'BG36_100',
      'BG36_113',
      'BGFYM_000',
    ]);
  });

  it('normalise QUILBOAR (CARDRACE) et QUILLBOAR (BACON_SUBSET)', () => {
    expect(p.bg.tribes.cards.QUILBOAR).toBeUndefined();
    expect(p.bg.tribes.cards.QUILLBOAR?.length).toBeGreaterThan(0);
  });

  it('ne laisse aucune ligne Power non reconnue', () => {
    expect(p.parser.diagnostics.samples).toEqual([]);
  });
});
