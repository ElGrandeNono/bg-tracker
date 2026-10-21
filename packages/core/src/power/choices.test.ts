import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Pipeline } from '../pipeline.js';
import { readLogLines } from '../replay/readLogLines.js';
import { PowerParser } from './parser.js';
import type { LocalChoice } from '../bg/bgGame.js';

const FIXTURE = join(import.meta.dirname, '../../../../fixtures/bg-solo-18-tours.Power.log.gz');

describe('choix proposés au joueur (DebugPrintEntityChoices / EntitiesChosen)', () => {
  it('lignes réelles : proposition puis choix, même id (synthetic minimal, copié du log)', () => {
    const p = new PowerParser();
    const lines = [
      'D 02:43:38.0000000 GameState.DebugPrintEntityChoices() - id=4 Player=Joueur#0001 TaskList=1132 ChoiceType=GENERAL CountMin=1 CountMax=1',
      'D 02:43:38.0000000 GameState.DebugPrintEntityChoices() -   Entities[0]=[entityName=Alimentation audacieuse id=2545 zone=SETASIDE zonePos=0 cardId=BG30_123 player=8]',
      'D 02:43:38.0000000 GameState.DebugPrintEntityChoices() -   Entities[1]=[entityName=Chronocapitaine Harpagone id=2548 zone=SETASIDE zonePos=0 cardId=BG27_005 player=8]',
      'D 02:43:42.0000000 GameState.DebugPrintEntitiesChosen() - id=4 Player=Joueur#0001 EntitiesCount=1',
      'D 02:43:42.0000000 GameState.DebugPrintEntitiesChosen() -   Entities[0]=[entityName=Alimentation audacieuse id=2545 zone=SETASIDE zonePos=0 cardId=BG30_123 player=8]',
      'D 02:43:42.0000000 GameState.DebugPrintPower() - BLOCK_END',
    ];
    const events = lines.flatMap((l) => p.feed(l));
    expect(events.filter((e) => e.type === 'choices' || e.type === 'chosen')).toMatchObject([
      {
        type: 'choices',
        id: 4,
        choiceType: 'GENERAL',
        cards: [
          { cardId: 'BG30_123', playerId: 8 },
          { cardId: 'BG27_005', playerId: 8 },
        ],
      },
      { type: 'chosen', id: 4, cards: [{ cardId: 'BG30_123', playerId: 8 }] },
    ]);
  });

  it('partie 18 tours : héros proposés, puis bibelots proposés au joueur local', async () => {
    const p = new Pipeline();
    const seen: LocalChoice[] = [];
    p.subscribe(() => {
      const c = p.bg.choice;
      if (c !== undefined && seen.at(-1)?.id !== c.id) seen.push(c);
    });
    for await (const line of readLogLines(FIXTURE)) p.feedLine(line);
    expect(seen[0]).toEqual({
      id: 1,
      kind: 'hero',
      cardIds: [
        'BG20_HERO_202',
        'TB_BaconShop_HERO_08',
        'BG20_HERO_282_SKIN_C4',
        'TB_BaconShop_HERO_38',
      ],
    });
    expect(seen.find((c) => c.id === 5)).toEqual({
      id: 5,
      kind: 'trinket',
      cardIds: [
        'BG36_MagicItem_411',
        'BG36_MagicItem_800',
        'BG36_MagicItem_211',
        'BG32_MagicItem_951',
      ],
    });
    expect(seen.find((c) => c.id === 4)?.kind).toBe('other'); // Découverte de serviteurs
    expect(p.bg.choice).toBeUndefined(); // tous les choix ont été faits
  }, 120_000);
});
