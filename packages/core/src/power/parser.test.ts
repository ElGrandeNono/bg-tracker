import { describe, expect, it } from 'vitest';
import { parseLine } from '../log/line.js';
import { Pipeline } from '../pipeline.js';
import { parseEntityRef, PowerParser } from './parser.js';

// Lignes synthétiques (synthetic-*) recopiées du format des fixtures réelles, pour cibler un cas.

const GS = 'D 06:11:54.5321202 GameState.DebugPrintPower() - ';
const PTL = 'D 06:11:54.5321202 PowerTaskList.DebugPrintPower() - ';

describe('parseLine', () => {
  it('découpe une ligne structurée', () => {
    const l = parseLine(`${GS}    TAG_CHANGE Entity=4 tag=STATE value=RUNNING `);
    expect(l).toMatchObject({
      kind: 'log',
      level: 'D',
      source: 'GameState',
      method: 'DebugPrintPower',
      indent: 4,
      body: 'TAG_CHANGE Entity=4 tag=STATE value=RUNNING',
    });
    expect(l.kind === 'log' && Math.round(l.timeMs)).toBe(22_314_532);
  });

  it('renvoie une ligne brute pour un format inconnu', () => {
    expect(parseLine('Truncating log, which has reached the size limit of 10000KB').kind).toBe(
      'raw',
    );
  });
});

describe('parseEntityRef', () => {
  it('gère les trois formes observées', () => {
    expect(parseEntityRef('27')).toEqual({ kind: 'id', id: 27 });
    expect(parseEntityRef('GameEntity')).toEqual({ kind: 'name', name: 'GameEntity' });
    expect(
      parseEntityRef(
        '[entityName=Tchak Coupebeurre id=120 zone=HAND zonePos=4 cardId=BG21_HERO_010 player=2]',
      ),
    ).toEqual({ kind: 'id', id: 120 });
    expect(
      parseEntityRef(
        '[entityName=UNKNOWN ENTITY [cardType=INVALID] id=248 zone=SETASIDE zonePos=0 cardId= player=2]',
      ),
    ).toEqual({ kind: 'id', id: 248 });
  });
});

describe('PowerParser (synthetic)', () => {
  it('regroupe les tags d’un FULL_ENTITY et garde les tags numériques', () => {
    const p = new PowerParser();
    const events = [
      ...p.feed(`${GS}FULL_ENTITY - Creating ID=27 CardID=TB_BaconShop_HERO_PH`),
      ...p.feed(`${GS}    tag=CARDTYPE value=HERO`),
      ...p.feed(`${GS}    tag=3085 value=30`),
      ...p.feed(`${GS}TAG_CHANGE Entity=27 tag=HEALTH value=30 `),
    ];
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: 'fullEntity',
      id: 27,
      cardId: 'TB_BaconShop_HERO_PH',
      tags: { CARDTYPE: 'HERO', '3085': 30 },
    });
    expect(events[1]).toMatchObject({ type: 'tagChange', tag: 'HEALTH', value: 30 });
  });

  it('ignore PowerTaskList pour ne jamais compter deux fois', () => {
    const p = new PowerParser();
    expect(p.feed(`${PTL}TAG_CHANGE Entity=27 tag=HEALTH value=30 `)).toEqual([]);
  });

  it('ne lève jamais d’exception sur une ligne malformée', () => {
    const p = new PowerParser();
    const junk = [
      `${GS}TAG_CHANGE Entity= tag=`,
      `${GS}tag=ORPHAN value=1`,
      `${GS}???`,
      '',
      '\u0000ÿ',
    ];
    for (const j of junk) expect(() => p.feed(j)).not.toThrow();
    expect(p.diagnostics.unrecognized).toBeGreaterThan(0);
  });
});

describe('Pipeline (synthetic)', () => {
  it('ne remet pas l’état à zéro sur une troncature', () => {
    const pipe = new Pipeline();
    pipe.feedLine(`${GS}CREATE_GAME`);
    pipe.feedLine(`${GS}    GameEntity EntityID=4`);
    pipe.feedLine(`${GS}        tag=CARDTYPE value=GAME`);
    pipe.feedLine(`${GS}TAG_CHANGE Entity=GameEntity tag=TURN value=5 `);
    pipe.feedLine('Truncating log, which has reached the size limit of 10000KB');
    expect(pipe.state.truncated).toBe(true);
    expect(pipe.state.entities.get(4)?.tags.TURN).toBe(5);
    expect(pipe.bg.round).toBe(3);
  });
});
