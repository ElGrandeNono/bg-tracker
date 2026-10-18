import {
  isTruncationLine,
  parseLine,
  TRUNCATION_MARKER,
  type LogLine,
  type StructuredLine,
} from '../log/line.js';
import type { EntityRef, EventPosition, PowerEvent, TagValue } from './types.js';

/**
 * Parseur tolérant de Power.log.
 *
 * Source retenue : `GameState.DebugPrintPower()`. Le jeu journalise chaque événement deux fois ;
 * `PowerTaskList.DebugPrintPower()` rejoue les mêmes données au rythme des animations, avec du
 * retard. Lire les deux doublerait tout ; on ignore donc `PowerTaskList` (voir docs/log-format.md).
 *
 * Une ligne inconnue ou malformée n'est jamais fatale : elle est comptée dans `diagnostics`
 * (avec quelques exemples) puis ignorée.
 */

const RE = {
  tag: /^tag=(\S+) value=(\S*)$/,
  tagChange: /^TAG_CHANGE Entity=(.+?) tag=(\S+) value=(\S*)/,
  fullEntity: /^FULL_ENTITY - (?:Creating|Updating) ID=(\d+) CardID=(\S*)/,
  showEntity: /^SHOW_ENTITY - Updating Entity=(.+?) CardID=(\S*)$/,
  changeEntity: /^CHANGE_ENTITY - Updating Entity=(.+?) CardID=(\S*)$/,
  hideEntity: /^HIDE_ENTITY - Entity=(.+?) tag=(\S+) value=(\S*)/,
  blockStart: /^BLOCK_START BlockType=(\S+) Entity=(.+?) EffectCardId=/,
  gameEntity: /^GameEntity EntityID=(\d+)/,
  player: /^Player EntityID=(\d+) PlayerID=(\d+) GameAccountId=\[hi=(\d+) lo=(\d+)\]/,
  gameInfo: /^(BuildNumber|GameType|FormatType|ScenarioID)=(.*)$/,
  playerName: /^PlayerID=(\d+), PlayerName=(.*)$/,
  bracketId: / id=(\d+) /,
  // Lignes connues sans intérêt pour l'état : métadonnées d'historique et effets visuels.
  ignored:
    /^(?:META_DATA|Info\[|SUB_SPELL_START|SUB_SPELL_END|Source ?=|Targets|CACHED_TAG_FOR_DORMANT_CHANGE|VO_SPELL|SHUFFLE_DECK)/,
};

export function parseEntityRef(text: string): EntityRef | undefined {
  if (/^\d+$/.test(text)) return { kind: 'id', id: Number(text) };
  if (text.startsWith('[')) {
    const m = RE.bracketId.exec(text);
    return m?.[1] === undefined ? undefined : { kind: 'id', id: Number(m[1]) };
  }
  return text.length > 0 ? { kind: 'name', name: text } : undefined;
}

export function parseTagValue(text: string): TagValue {
  return /^-?\d+$/.test(text) ? Number(text) : text;
}

type Pending =
  | { readonly type: 'gameEntity'; readonly id: number }
  | {
      readonly type: 'player';
      readonly id: number;
      readonly playerId: number;
      readonly accountHi: string;
      readonly accountLo: string;
    }
  | { readonly type: 'fullEntity'; readonly id: number; readonly cardId: string }
  | {
      readonly type: 'showEntity' | 'changeEntity';
      readonly ref: EntityRef;
      readonly cardId: string;
    };

export interface ParserDiagnostics {
  /** Lignes de GameState.DebugPrintPower non reconnues. */
  unrecognized: number;
  /** Premiers exemples de lignes non reconnues (au plus `maxSamples`). */
  samples: string[];
}

export class PowerParser {
  private lineNo = 0;
  private pending: { head: Pending; at: EventPosition; tags: Record<string, TagValue> } | null =
    null;
  private lastTimeMs = 0;
  readonly diagnostics: ParserDiagnostics = { unrecognized: 0, samples: [] };

  /** Ligne GameState coupée en cours de recollage (voir `feed`). */
  private split: { text: string; parts: number } | null = null;

  constructor(private readonly maxSamples = 50) {}

  /**
   * Traite une ligne brute ; renvoie les événements terminés par cette ligne.
   *
   * Un nom d'entité peut contenir un saut de ligne (fixture du 18/10, partie abandonnée :
   * `[entityName=Jeunemort` puis, sur la ligne suivante sans préfixe, `le Brise-monde id=156 …]`).
   * Une ligne GameState dont un crochet reste ouvert est donc recollée aux lignes brutes qui
   * suivent, jusqu'à fermeture (au plus MAX_SPLIT_PARTS lignes).
   */
  feed(text: string): PowerEvent[] {
    this.lineNo++;
    if (this.split !== null) {
      const split = this.split;
      this.split = null;
      const continuation = parseLine(text).kind === 'raw' && !text.startsWith(TRUNCATION_MARKER);
      if (continuation && split.parts < MAX_SPLIT_PARTS) {
        const joined = `${split.text} ${text}`;
        if (!hasOpenBracket(joined)) return this.process(joined);
        this.split = { text: joined, parts: split.parts + 1 };
        return [];
      }
      // Jamais refermée : la ligne cassée part en diagnostic, la ligne courante est traitée.
      return [...this.process(split.text), ...this.process(text)];
    }
    if (text.includes('GameState.') && hasOpenBracket(text)) {
      this.split = { text, parts: 1 };
      return [];
    }
    return this.process(text);
  }

  private process(text: string): PowerEvent[] {
    const line = parseLine(text);
    const out: PowerEvent[] = [];
    if (line.kind === 'log') this.lastTimeMs = line.timeMs;
    const at: EventPosition = { line: this.lineNo, timeMs: this.lastTimeMs };

    if (isTruncationLine(line)) {
      this.flushInto(out);
      out.push({ type: 'truncated', at });
      return out;
    }
    if (!isGameStateLine(line)) return out;

    if (line.method === 'DebugPrintGame') {
      this.flushInto(out);
      this.parseGameInfo(line, at, out);
      return out;
    }

    const body = line.body;
    // Lignes de tags d'une entité en cours de description.
    if (body.startsWith('tag=')) {
      const m = RE.tag.exec(body);
      if (this.pending !== null && m?.[1] !== undefined) {
        this.pending.tags[m[1]] = parseTagValue(m[2] ?? '');
      } else {
        this.unrecognized(text);
      }
      return out;
    }
    this.flushInto(out);
    this.parseCommand(body, at, out, text);
    return out;
  }

  /**
   * Fin du flux (fichier rejoué jusqu'au bout, ou session de jeu abandonnée par le LogWatcher) :
   * termine l'entité en cours et émet `endOfStream`.
   */
  flush(): PowerEvent[] {
    const out: PowerEvent[] = [];
    if (this.split !== null) {
      out.push(...this.process(this.split.text));
      this.split = null;
    }
    this.flushInto(out);
    out.push({ type: 'endOfStream', at: { line: this.lineNo, timeMs: this.lastTimeMs } });
    return out;
  }

  private parseCommand(body: string, at: EventPosition, out: PowerEvent[], text: string): void {
    let m: RegExpExecArray | null;
    if ((m = RE.tagChange.exec(body))) {
      const ref = parseEntityRef(m[1] ?? '');
      if (ref === undefined) {
        this.unrecognized(text);
        return;
      }
      out.push({ type: 'tagChange', at, ref, tag: m[2] ?? '', value: parseTagValue(m[3] ?? '') });
    } else if ((m = RE.blockStart.exec(body))) {
      const ref = parseEntityRef(m[2] ?? '');
      if (ref === undefined) {
        this.unrecognized(text);
        return;
      }
      out.push({ type: 'blockStart', at, blockType: m[1] ?? '', ref });
    } else if (body === 'BLOCK_END') {
      out.push({ type: 'blockEnd', at });
    } else if ((m = RE.fullEntity.exec(body))) {
      this.begin({ type: 'fullEntity', id: Number(m[1]), cardId: m[2] ?? '' }, at);
    } else if ((m = RE.showEntity.exec(body)) ?? (m = RE.changeEntity.exec(body))) {
      const ref = parseEntityRef(m[1] ?? '');
      if (ref === undefined) {
        this.unrecognized(text);
        return;
      }
      const type = body.startsWith('SHOW') ? 'showEntity' : 'changeEntity';
      this.begin({ type, ref, cardId: m[2] ?? '' }, at);
    } else if ((m = RE.hideEntity.exec(body))) {
      const ref = parseEntityRef(m[1] ?? '');
      if (ref === undefined) {
        this.unrecognized(text);
        return;
      }
      out.push({ type: 'hideEntity', at, ref, tag: m[2] ?? '', value: parseTagValue(m[3] ?? '') });
    } else if (body === 'CREATE_GAME') {
      out.push({ type: 'createGame', at });
    } else if ((m = RE.gameEntity.exec(body))) {
      this.begin({ type: 'gameEntity', id: Number(m[1]) }, at);
    } else if ((m = RE.player.exec(body))) {
      this.begin(
        {
          type: 'player',
          id: Number(m[1]),
          playerId: Number(m[2]),
          accountHi: m[3] ?? '0',
          accountLo: m[4] ?? '0',
        },
        at,
      );
    } else if (!RE.ignored.test(body)) {
      this.unrecognized(text);
    }
  }

  private parseGameInfo(line: StructuredLine, at: EventPosition, out: PowerEvent[]): void {
    let m: RegExpExecArray | null;
    if ((m = RE.gameInfo.exec(line.body))) {
      out.push({ type: 'gameInfo', at, key: m[1] ?? '', value: m[2] ?? '' });
    } else if ((m = RE.playerName.exec(line.body))) {
      out.push({ type: 'playerName', at, playerId: Number(m[1]), name: m[2] ?? '' });
    }
  }

  private begin(head: Pending, at: EventPosition): void {
    this.pending = { head, at, tags: {} };
  }

  private flushInto(out: PowerEvent[]): void {
    const p = this.pending;
    if (p === null) return;
    this.pending = null;
    out.push({ ...p.head, at: p.at, tags: p.tags });
  }

  private unrecognized(text: string): void {
    this.diagnostics.unrecognized++;
    if (this.diagnostics.samples.length < this.maxSamples) this.diagnostics.samples.push(text);
  }
}

const MAX_SPLIT_PARTS = 4;

function hasOpenBracket(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === '[') depth++;
    else if (ch === ']' && depth > 0) depth--;
  }
  return depth > 0;
}

function isGameStateLine(line: LogLine): line is StructuredLine {
  return (
    line.kind === 'log' &&
    line.source === 'GameState' &&
    (line.method === 'DebugPrintPower' || line.method === 'DebugPrintGame')
  );
}
