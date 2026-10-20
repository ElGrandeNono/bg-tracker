import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  localPlayer,
  initialGameState,
  numTag,
  Pipeline,
  PowerParser,
  reduceGameState,
  readLogLines,
  resolveRef,
  tagOf,
  type GameState,
  type PowerEvent,
} from '@bgt/core';
import { S14_SEASON, type S14State, type S14View } from './tracker.js';

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));

interface Replay {
  readonly pipeline: Pipeline;
  readonly views: S14View[];
  /** Tour de recrutement affiché au moment de chaque vue. */
  readonly rounds: number[];
  /** Cartes montrées au joueur local (oracle indépendant du module). */
  readonly shown: Set<string>;
  readonly leaks: string[];
}

function touched(state: GameState, e: PowerEvent): number | undefined {
  if (e.type === 'fullEntity') return e.id;
  if ('ref' in e) return resolveRef(state, e.ref);
  return undefined;
}

/**
 * Rejoue une fixture. Oracle indépendant (son propre parseur, chaque événement) : une carte est
 * « montrée » quand une entité du joueur local est en PLAY ou en main, ou qu'un serviteur/héros
 * est en PLAY. À chaque mise à jour, la vue de saison ne doit citer que des cartes montrées.
 */
async function replay(name: string): Promise<Replay> {
  const views: S14View[] = [];
  const rounds: number[] = [];
  const shown = new Set<string>();
  const leaks: string[] = [];
  const oracleParser = new PowerParser();
  let oracle = initialGameState;
  const observe = (e: PowerEvent): void => {
    oracle = reduceGameState(oracle, e);
    const id = touched(oracle, e);
    const ent = id === undefined ? undefined : oracle.entities.get(id);
    if (ent === undefined || ent.cardId === '') return;
    const zone = tagOf(ent, 'ZONE');
    const local = numTag(ent, 'CONTROLLER') === localPlayer(oracle)?.playerId;
    const type = tagOf(ent, 'CARDTYPE');
    if (
      (local && (zone === 'PLAY' || zone === 'HAND')) ||
      (zone === 'PLAY' && (type === 'MINION' || type === 'HERO'))
    ) {
      shown.add(ent.cardId);
    }
  };
  const p = new Pipeline(S14_SEASON);
  p.subscribe(() => {
    const d = p.displayed;
    const v = S14_SEASON.view(d.season as S14State, d.bg, d.state);
    views.push(v);
    rounds.push(d.bg.round);
    for (const c of v.shownCardIds) if (!shown.has(c)) leaks.push(c);
  });
  for await (const line of readLogLines(fixture(name))) {
    for (const e of oracleParser.feed(line)) observe(e);
    p.feedLine(line);
  }
  p.end();
  return { pipeline: p, views, rounds, shown, leaks };
}

const last = (r: Replay): S14View => {
  const v = r.views.at(-1);
  if (v === undefined) throw new Error('aucune vue');
  return v;
};

describe('saison 14 : partie complète du 18/10/2026', () => {
  let r: Replay;
  beforeAll(async () => {
    r = await replay('bg-solo-2026-10-18-complete.Power.log.gz');
  }, 120_000);

  it('deux trinkets choisis : Portrait de conque (mineur) puis Boussole colorée (majeur)', () => {
    expect(last(r).trinkets).toEqual([
      { kind: 'chosen', cardId: 'BG35_MagicItem_305' },
      { kind: 'chosen', cardId: 'BG30_MagicItem_426t' },
    ]);
  });

  it('compte à rebours des trinkets : 5 tours (mineur), 8 tours (majeur)', () => {
    const firstPending = r.views.find((v) => v.trinkets.length === 2);
    expect(firstPending?.trinkets).toEqual([
      { kind: 'pending', slot: 'lesser', turnsLeft: 5 },
      { kind: 'pending', slot: 'greater', turnsLeft: 8 },
    ]);
  });

  it('trois Dark Gifts sur trois, bouton à 3 or', () => {
    const dg = last(r).darkGifts;
    expect(dg?.used).toBe(3);
    expect(dg?.max).toBe(3);
    expect(dg?.cost).toBe(3);
    expect(dg?.gifts.map((g) => g.minionCardId)).toEqual(['BG27_556', 'BG32_336', 'BG36_704']);
    expect(dg?.gifts[0]?.giftCardId).toBe('BG36_MidGameEffect_000t28t'); // Cicatrices de guerre
  });

  it('Dark Gift disponible seulement à partir du tour 3', () => {
    const firstAvailable = r.views.findIndex((v) => v.darkGifts?.available === true);
    expect(firstAvailable).toBeGreaterThan(0);
    expect(r.rounds[firstAvailable]).toBe(3); // notes du patch 36.2 : dès le tour 3
  });

  it('9 Activations (Fugitif des égouts ×6, Garde océanique ×3)', () => {
    expect(last(r).activationsTotal).toBe(9);
    const during = r.views.flatMap((v) => v.activationsThisTurn);
    expect(new Set(during)).toEqual(new Set(['BG36_700', 'BG36_701']));
  });

  it('compteurs : sorts de taverne +8/+8, 53 sorts joués', () => {
    expect(last(r).counters).toMatchObject({
      tavernSpellBuff: { attack: 8, health: 8 },
      spellsPlayed: 53,
    });
  });

  it('pas de divinité (aucun sceau BG_OldGod) malgré BACON_GLOBAL_OLD_GOD_DBID sur la partie', () => {
    expect(r.views.every((v) => v.counters.deityDbfId === undefined)).toBe(true);
  });

  it('fair-play : la vue de saison ne cite que des cartes montrées', () => {
    expect(r.leaks).toEqual([]);
  });
});

describe('saison 14 : partie aux Aberrations du 18/10/2026', () => {
  let r: Replay;
  beforeAll(async () => {
    r = await replay('bg-solo-2026-10-18-aberrations.Power.log.gz');
  }, 120_000);

  it('deux Dark Gifts, C’Thun 5/3, trinkets encore en attente', () => {
    const v = last(r);
    expect(v.darkGifts?.used).toBe(2);
    expect(v.darkGifts?.gifts.map((g) => g.minionCardId)).toEqual(['BG36_099', 'BG36_113']);
    expect(v.counters.oldGod).toEqual({ attack: 5, health: 3 });
    expect(v.counters.deityDbfId).toBe(130610); // C’Thun (BGFYM_000)
    expect(v.trinkets.every((t) => t.kind === 'pending')).toBe(true);
  });

  it('fair-play : la vue de saison ne cite que des cartes montrées', () => {
    expect(r.leaks).toEqual([]);
  });
});
