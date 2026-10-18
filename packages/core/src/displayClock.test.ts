import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { remainingHealth } from './bg/bgGame.js';
import { Pipeline } from './pipeline.js';
import { readLogLines } from './replay/readLogLines.js';

/**
 * Fair-play temporel : l'UI ne lit que `pipeline.displayed`, qui ne doit jamais devancer ce que
 * le client a affiché. Oracle indépendant du pipeline : le dernier `TURN` de GameEntity vu dans
 * les lignes BRUTES `PowerTaskList` (rythme d'animation du client).
 */

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));

const PTL_TURN =
  /PowerTaskList\.DebugPrintPower\(\) - +TAG_CHANGE Entity=GameEntity tag=TURN value=(\d+)/;

describe('horloge d’affichage sur les fixtures réelles', () => {
  it.each([
    ['bg-solo-2026-10-18-complete.Power.log.gz', true],
    ['bg-solo-2026-09-21-tronque.Power.log.gz', true],
    ['bg-solo-2026-10-18-abandon.Power.log.gz', false],
    ['bg-solo-2026-10-18-aberrations.Power.log.gz', true],
  ])(
    '%s : l’état affiché ne devance jamais le client',
    async (name, expectsHold) => {
      const p = new Pipeline();
      let ptlTurn = 0;
      let heldLines = 0;
      let maxHeldTurns = 0;
      for await (const line of readLogLines(fixture(name))) {
        const m = PTL_TURN.exec(line);
        if (m?.[1] !== undefined) ptlTurn = Number(m[1]);
        p.feedLine(line);
        const shown = p.displayed.bg.gameTurn;
        if (shown > ptlTurn) {
          throw new Error(`ligne : TURN affiché ${shown} alors que le client est à ${ptlTurn}`);
        }
        if (p.bg.gameTurn > shown) {
          heldLines++;
          maxHeldTurns = Math.max(maxHeldTurns, p.bg.gameTurn - shown);
        }
      }
      p.end();
      expect(p.displayClock.active).toBe(true);
      expect(p.displayClock.mismatches).toBe(0);
      // Après la fin du flux, plus rien n'est retenu.
      expect(p.displayed.bg).toBe(p.bg);
      if (expectsHold) {
        expect(heldLines).toBeGreaterThan(100); // l'horloge retient réellement des mises à jour
        expect(maxHeldTurns).toBeLessThanOrEqual(2);
      }
    },
    120_000,
  );

  it('partie complète : les PV perdus au combat 7 ne sont montrés qu’après l’animation', async () => {
    const p = new Pipeline();
    let ptlTurn = 0;
    let knownEarly = false; // GameState connaît la perte de PV alors que le client anime encore
    for await (const line of readLogLines(fixture('bg-solo-2026-10-18-complete.Power.log.gz'))) {
      const m = PTL_TURN.exec(line);
      if (m?.[1] !== undefined) ptlTurn = Number(m[1]);
      p.feedLine(line);
      const local = p.bg.localPlayerId;
      if (local === undefined) continue;
      const truth = remainingHealth(p.bg.players[local]);
      const shown = remainingHealth(p.displayed.bg.players[local]);
      // Combat 7 = TURN 14 ; le joueur passe de 25 à 15 PV (chronologie M1). Au moment où
      // GameState l'apprend, le client commence à peine l'animation : l'overlay montre encore 25.
      if (truth === 15 && !knownEarly) {
        knownEarly = true;
        expect(ptlTurn).toBeLessThanOrEqual(14);
        expect(shown).toBe(25);
      }
    }
    expect(knownEarly).toBe(true);
  }, 120_000);
});

describe('horloge d’affichage (synthetic)', () => {
  const GS = 'D 06:13:21.0000000 GameState.DebugPrintPower() - ';
  const PTL = 'D 06:13:30.0000000 PowerTaskList.DebugPrintPower() - ';
  const header = [
    `${GS}CREATE_GAME`,
    `${GS}    GameEntity EntityID=4`,
    'D 06:13:21.0000000 GameState.DebugPrintGame() - GameType=GT_BATTLEGROUNDS',
  ];

  it('retient le combat jusqu’à ce que le client le montre', () => {
    const p = new Pipeline();
    for (const l of header) p.feedLine(l);
    p.feedLine(`${GS}TAG_CHANGE Entity=GameEntity tag=TURN value=2 `);
    p.feedLine(`${GS}TAG_CHANGE Entity=GameEntity tag=TURN value=3 `);
    expect(p.bg.gameTurn).toBe(3);
    expect(p.displayed.bg.gameTurn).toBe(0);
    p.feedLine(`${PTL}TAG_CHANGE Entity=GameEntity tag=TURN value=2 `);
    expect(p.displayed.bg.gameTurn).toBe(2);
    p.feedLine(`${PTL}TAG_CHANGE Entity=GameEntity tag=TURN value=3 `);
    expect(p.displayed.bg.gameTurn).toBe(3);
    expect(p.displayClock.behind).toBe(0);
  });

  it('libère tout en fin de flux, même si le client n’a jamais rattrapé', () => {
    const p = new Pipeline();
    for (const l of header) p.feedLine(l);
    p.feedLine(`${GS}TAG_CHANGE Entity=GameEntity tag=TURN value=2 `);
    expect(p.displayed.bg.gameTurn).toBe(0);
    p.end();
    expect(p.displayed.bg.gameTurn).toBe(2);
  });

  it('se désactive si l’alignement est perdu, sans jamais bloquer', () => {
    const p = new Pipeline();
    for (const l of header) p.feedLine(l);
    p.feedLine(`${GS}TAG_CHANGE Entity=GameEntity tag=TURN value=2 `);
    for (let i = 0; i < 6; i++) p.feedLine(`${PTL}BLOCK_START BlockType=DEATHS Entity=GameEntity `);
    expect(p.displayClock.active).toBe(false);
    expect(p.displayed.bg.gameTurn).toBe(2);
  });

  it('libère un instantané retenu plus de 2 minutes (temps du log)', () => {
    const p = new Pipeline();
    for (const l of header) p.feedLine(l);
    p.feedLine(`${GS}TAG_CHANGE Entity=GameEntity tag=TURN value=2 `);
    p.feedLine(
      'D 06:16:00.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=MAIN_ACTION ',
    );
    expect(p.displayed.bg.gameTurn).toBe(2);
  });
});
