/**
 * Découpage d'une ligne brute de log Hearthstone.
 *
 * Format observé (fixtures 21/09 et 18/10/2026) :
 *   `D 06:11:54.5321202 GameState.DebugPrintPower() -     TAG_CHANGE Entity=4 tag=STATE value=RUNNING `
 * - 1re lettre : niveau (`D` debug, `W` warning, `E` erreur supposée),
 * - heure locale `hh:mm:ss.fffffff` (7 décimales, pas de date),
 * - `<Source>.<Méthode>()`, puis ` - `, puis le message dont l'indentation reflète l'imbrication.
 * Certaines lignes ne suivent pas ce format (ex. `Truncating log, which has reached the size
 * limit of 10000KB` ou une ligne de `=`) : elles sont renvoyées avec `kind: 'raw'`.
 */

export interface StructuredLine {
  readonly kind: 'log';
  readonly level: string;
  /** Heure telle qu'écrite, `hh:mm:ss.fffffff`. */
  readonly time: string;
  /** Millisecondes depuis minuit (précision 0,1 µs conservée en décimales). */
  readonly timeMs: number;
  readonly source: string;
  readonly method: string;
  /** Message sans son indentation. */
  readonly body: string;
  /** Nombre d'espaces d'indentation devant le message. */
  readonly indent: number;
}

export interface RawLine {
  readonly kind: 'raw';
  readonly text: string;
}

export type LogLine = StructuredLine | RawLine;

const LINE_RE =
  /^([A-Z]) (\d\d):(\d\d):(\d\d)\.(\d+) ([A-Za-z0-9_]+)\.([A-Za-z0-9_<>]+)\(\) - ( *)(.*)$/;

export function parseLine(text: string): LogLine {
  const m = LINE_RE.exec(text);
  if (m === null) return { kind: 'raw', text };
  // Tous les groupes de LINE_RE sont obligatoires : `?? ''` ne sert qu'au typage.
  const g = (i: number): string => m[i] ?? '';
  const [hh, mm, ss, frac] = [g(2), g(3), g(4), g(5)] as const;
  const timeMs =
    (Number(hh) * 3600 + Number(mm) * 60 + Number(ss)) * 1000 + Number(`0.${frac}`) * 1000;
  return {
    kind: 'log',
    level: g(1),
    time: `${hh}:${mm}:${ss}.${frac}`,
    timeMs,
    source: g(6),
    method: g(7),
    body: g(9).trimEnd(),
    indent: g(8).length,
  };
}

/** Message écrit par le jeu quand `Power.log` atteint la limite de taille. */
export const TRUNCATION_MARKER = 'Truncating log';

export function isTruncationLine(line: LogLine): boolean {
  return line.kind === 'raw' && line.text.startsWith(TRUNCATION_MARKER);
}
