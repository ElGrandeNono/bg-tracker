import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { estimateLobbyTribes } from './bg/tribes.js';
import { Pipeline } from './pipeline.js';
import { readLogLines } from './replay/readLogLines.js';
import type { BgGame } from './bg/bgGame.js';

/**
 * Acceptation « slow » sur les 9 parties solo complètes du 21/10/2026 (fixtures `bg-solo-*`,
 * ~300 Mo décompressés) : lancées seulement avec `BGT_SLOW=1` (`pnpm test:slow`).
 * Vérité terrain : récapitulatif fourni avec les fixtures (fixtures/README.md).
 */

const slow = process.env.BGT_SLOW === '1';
const fixture = (name: string): string =>
  fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));

interface Expected {
  readonly hero: string;
  readonly place: number;
  readonly rounds: number;
  readonly tribes: readonly string[];
}

const EXPECTED: Readonly<Record<string, readonly Expected[]>> = {
  'bg-solo-3-parties.Power.log.gz': [
    {
      hero: 'TB_BaconShop_HERO_702',
      place: 5,
      rounds: 12,
      tribes: ['UNDEAD', 'ELEMENTALS', 'PIRATE', 'DEMON', 'MURLOC'],
    },
    // Reclassée après l'élimination : 6 au `LOST`, 4 une seconde plus tard.
    {
      hero: 'BG24_HERO_204',
      place: 4,
      rounds: 12,
      tribes: ['DRAGON', 'DEMON', 'ELEMENTALS', 'PIRATE', 'MURLOC'],
    },
    // 2e : `LOSING`→`LOST` du joueur local malgré tout ; le `WON` n'est que côté PowerTaskList.
    {
      hero: 'BG34_HERO_004',
      place: 2,
      rounds: 14,
      tribes: ['PIRATE', 'MURLOC', 'DEMON', 'DRAGON', 'BEAST'],
    },
  ],
  'bg-solo-4-parties.Power.log.gz': [
    {
      hero: 'BG24_HERO_204',
      place: 6,
      rounds: 11,
      tribes: ['ABERRATION', 'QUILLBOAR', 'PIRATE', 'MURLOC', 'ELEMENTALS'],
    },
    {
      hero: 'TB_BaconShop_HERO_94',
      place: 7,
      rounds: 9,
      tribes: ['BEAST', 'QUILLBOAR', 'DRAGON', 'ELEMENTALS', 'UNDEAD'],
    },
    {
      hero: 'BG28_HERO_800',
      place: 5,
      rounds: 11,
      tribes: ['ABERRATION', 'DEMON', 'BEAST', 'ELEMENTALS', 'MURLOC'],
    },
    {
      hero: 'TB_BaconShop_HERO_70',
      place: 6,
      rounds: 12,
      tribes: ['QUILLBOAR', 'BEAST', 'DEMON', 'UNDEAD', 'PIRATE'],
    },
  ],
  'bg-solo-30-tours.Power.log.gz': [
    {
      hero: 'BG32_HERO_001',
      place: 3,
      rounds: 15,
      tribes: ['PIRATE', 'ABERRATION', 'UNDEAD', 'DRAGON', 'ELEMENTALS'],
    },
  ],
  'bg-solo-18-tours.Power.log.gz': [
    {
      hero: 'BG20_HERO_282_SKIN_C4',
      place: 7,
      rounds: 9,
      tribes: ['PIRATE', 'ABERRATION', 'DEMON', 'QUILLBOAR', 'UNDEAD'],
    },
  ],
};

async function games(file: string): Promise<BgGame[]> {
  const p = new Pipeline();
  const byIndex = new Map<number, BgGame>();
  p.subscribe(() => {
    if (p.bg.isBattlegrounds) byIndex.set(p.bg.gameIndex, p.bg);
  });
  for await (const line of readLogLines(fixture(file))) p.feedLine(line);
  p.end();
  return [...byIndex.values()];
}

describe.runIf(slow)('9 parties solo complètes du 21/10/2026 (slow)', () => {
  for (const [file, expected] of Object.entries(EXPECTED)) {
    it(
      file,
      async () => {
        const found = await games(file);
        expect(found).toHaveLength(expected.length);
        found.forEach((bg, i) => {
          const e = expected[i];
          if (e === undefined) return;
          const local = bg.localPlayerId === undefined ? undefined : bg.players[bg.localPlayerId];
          expect(bg.mode).toBe('solo');
          expect(bg.outcome).toBe('finished');
          expect(local?.heroCardId).toBe(e.hero);
          expect(bg.finalPlace).toBe(e.place);
          expect(bg.round).toBe(e.rounds);
          // Le 2e Player (PlayerID local + 8) n'est pas un adversaire : 8 joueurs exactement.
          expect(Object.keys(bg.players)).toHaveLength(8);
          expect([...estimateLobbyTribes(bg.tribes).identified].sort()).toEqual(
            [...e.tribes].sort(),
          );
        });
      },
      600_000,
    );
  }
});
