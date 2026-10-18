import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { initialBgGame, reduceBgGame } from '../bg/bgGame.js';
import { PowerParser } from '../power/parser.js';
import type { PowerEvent } from '../power/types.js';
import { readLogLines } from '../replay/readLogLines.js';
import {
  initialGameState,
  localPlayer,
  numTag,
  reduceGameState,
  resolveRef,
  tagOf,
  type GameState,
} from '../state/gameState.js';
import { buildVisibleView, type VisibleView } from './view.js';

/**
 * Test fair-play : aucune information cachée n'atteint la vue destinée à l'UI.
 *
 * Oracle indépendant du filtre : pendant le replay, on note chaque carte réellement MONTRÉE au
 * joueur — serviteur ou héros en zone PLAY, héros du classement (`PLAYER_ID`), carte du joueur
 * local en main. Toute carte présente dans la vue doit avoir été montrée AVANT ou au moment où
 * la vue est construite. On vérifie aussi qu'aucune entité cachée (`CardID=` vide) ni aucun
 * identifiant d'entité ne fuit.
 */

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../../../../fixtures/${name}`, import.meta.url));

function touched(state: GameState, e: PowerEvent): number | undefined {
  if (e.type === 'fullEntity') return e.id;
  if ('ref' in e) return resolveRef(state, e.ref);
  return undefined;
}

function shown(state: GameState, id: number): string | undefined {
  const e = state.entities.get(id);
  if (e === undefined || e.cardId === '') return undefined;
  const zone = tagOf(e, 'ZONE');
  const type = tagOf(e, 'CARDTYPE');
  if (zone === 'PLAY' && (type === 'MINION' || type === 'HERO')) return e.cardId;
  if (type === 'HERO' && numTag(e, 'PLAYER_ID') !== undefined) return e.cardId;
  const local = localPlayer(state);
  if (local !== undefined && numTag(e, 'CONTROLLER') === local.playerId && zone === 'HAND') {
    return e.cardId;
  }
  return undefined;
}

function cardIdsIn(view: VisibleView): string[] {
  const ids: string[] = [];
  if (view.local.heroCardId !== undefined) ids.push(view.local.heroCardId);
  for (const p of view.players) {
    ids.push(p.heroCardId);
    for (const m of p.lastBoard?.minions ?? []) ids.push(m.cardId);
  }
  for (const s of view.poolSightings) ids.push(s.cardId);
  return ids;
}

async function checkFixture(name: string): Promise<{ views: number; boardMinions: number }> {
  const parser = new PowerParser();
  let state = initialGameState;
  let bg = initialBgGame;
  const shownCards = new Set<string>();
  let views = 0;
  let boardMinions = 0;
  let changes = 0;

  const apply = (e: PowerEvent): void => {
    const next = reduceGameState(state, e);
    const id = touched(next, e);
    if (id !== undefined) {
      const c = shown(next, id);
      if (c !== undefined) shownCards.add(c);
    }
    const nextBg = reduceBgGame(bg, e, state, next);
    state = next;
    const combatEnded = nextBg.combats.at(-1)?.endMs !== bg.combats.at(-1)?.endMs;
    if (nextBg !== bg && (++changes % 25 === 0 || combatEnded)) {
      const view = buildVisibleView(nextBg, state);
      views++;
      for (const c of cardIdsIn(view)) {
        expect(c, 'carte vide dans la vue').not.toBe('');
        if (!shownCards.has(c)) throw new Error(`carte jamais montrée dans la vue : ${c}`);
      }
      boardMinions += view.players.reduce((n, p) => n + (p.lastBoard?.minions.length ?? 0), 0);
      expect(JSON.stringify(view)).not.toMatch(/entityId|heroEntityId|"tags"/);
    }
    bg = nextBg;
  };

  for await (const line of readLogLines(fixture(name))) for (const e of parser.feed(line)) apply(e);
  for (const e of parser.flush()) apply(e);
  return { views, boardMinions };
}

describe('filtre fair-play sur les fixtures réelles', () => {
  it.each([
    'bg-solo-2026-10-18-complete.Power.log.gz',
    'bg-solo-2026-09-21-tronque.Power.log.gz',
    'bg-solo-2026-10-18-abandon.Power.log.gz',
    'bg-solo-2026-10-18-aberrations.Power.log.gz',
  ])(
    '%s : aucune carte non montrée n’atteint la vue',
    async (name) => {
      const { views, boardMinions } = await checkFixture(name);
      expect(views).toBeGreaterThan(10);
      expect(boardMinions).toBeGreaterThan(0); // le test a bien vu des plateaux adverses
    },
    120_000,
  );
});

describe('filtre fair-play (synthetic)', () => {
  const GS = 'D 06:11:54.5321202 GameState.DebugPrintPower() - ';

  it('ne montre ni la main ni la boutique d’un adversaire même révélées dans le log', () => {
    const parser = new PowerParser();
    let state = initialGameState;
    let bg = initialBgGame;
    const lines = [
      `${GS}CREATE_GAME`,
      `${GS}    GameEntity EntityID=4`,
      `${GS}    Player EntityID=5 PlayerID=2 GameAccountId=[hi=1 lo=1]`,
      `${GS}    Player EntityID=6 PlayerID=10 GameAccountId=[hi=0 lo=0]`,
      `${GS}        tag=BACON_DUMMY_PLAYER value=1`,
      'D 06:11:54.5321202 GameState.DebugPrintGame() - GameType=GT_BATTLEGROUNDS',
      // Carte en main adverse, révélée dans le log : ne doit jamais être affichée.
      `${GS}FULL_ENTITY - Creating ID=900 CardID=SECRET_HAND_CARD`,
      `${GS}    tag=CARDTYPE value=MINION`,
      `${GS}    tag=CONTROLLER value=10`,
      `${GS}    tag=ZONE value=HAND`,
      `${GS}FULL_ENTITY - Creating ID=901 CardID=SECRET_SETASIDE_CARD`,
      `${GS}    tag=CARDTYPE value=MINION`,
      `${GS}    tag=CONTROLLER value=10`,
      `${GS}    tag=ZONE value=SETASIDE`,
    ];
    for (const l of lines) {
      for (const e of [...parser.feed(l), ...parser.flush()]) {
        const next = reduceGameState(state, e);
        bg = reduceBgGame(bg, e, state, next);
        state = next;
      }
    }
    const json = JSON.stringify(buildVisibleView(bg, state));
    expect(json).not.toContain('SECRET_HAND_CARD');
    expect(json).not.toContain('SECRET_SETASIDE_CARD');
  });
});
