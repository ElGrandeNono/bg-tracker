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
    // L'utilisateur a mesuré « taverne niveau 2 » ; dans le log, seul le lobby atteint 2,
    // le héros local (#101) reste à PLAYER_TECH_LEVEL=1.
    const levels = Object.values(p.bg.players).map((pl) => pl.techLevel ?? 0);
    expect(Math.max(...levels)).toBe(2);
    expect(p.bg.players[1]?.techLevel).toBe(1);
  });

  it('marque la partie « abandonnée ou interrompue », sans place finale', () => {
    expect(p.bg.truncated).toBe(false);
    expect(p.bg.outcome).toBe('interrupted');
    expect(p.bg.finalPlace).toBeUndefined();
    expect(p.bg.timeline.at(-1)?.kind).toBe('interrupted');
    expect(p.bg.timeline.some((e) => e.kind === 'eliminated' || e.kind === 'gameOver')).toBe(false);
  });

  it('recolle les noms d’entité coupés par un saut de ligne', () => {
    expect(p.parser.diagnostics.samples).toEqual([]);
  });
});
