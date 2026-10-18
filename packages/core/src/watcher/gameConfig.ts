import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Lecture et correction des fichiers de configuration du jeu. Fonctions PURES : elles calculent
 * le nouveau contenu, elles n'écrivent rien. L'écriture se fait dans l'application, uniquement
 * avec l'accord explicite de l'utilisateur (et peut demander les droits administrateur pour
 * `client.config` sous `Program Files (x86)`).
 *
 * Sources : forum Lutris et FAQ de dépannage de Firestone (concordants) ; effet de
 * `FileSizeLimit.Int=-1` vérifié sur la machine de l'utilisateur (log de 61 Mo non tronqué).
 */

export interface IniSection {
  readonly name: string;
  readonly values: Readonly<Record<string, string>>;
}

/** Parse un fichier INI simple ; tolère l'indentation (vue dans un vrai client.config). */
export function parseIni(text: string): IniSection[] {
  const sections: { name: string; values: Record<string, string> }[] = [];
  let current: { name: string; values: Record<string, string> } | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith(';') || line.startsWith('#')) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header?.[1] !== undefined) {
      current = { name: header[1].trim(), values: {} };
      sections.push(current);
      continue;
    }
    const eq = line.indexOf('=');
    if (current !== undefined && eq > 0) {
      current.values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  }
  return sections;
}

function section(sections: IniSection[], name: string): IniSection | undefined {
  return sections.find((s) => s.name.toLowerCase() === name.toLowerCase());
}

/** Réglages requis dans `log.config`, section `[Power]`. */
export const REQUIRED_POWER_SETTINGS: Readonly<Record<string, string>> = {
  LogLevel: '1',
  FilePrinting: 'true',
  ConsolePrinting: 'false',
  ScreenPrinting: 'false',
  Verbose: 'true',
};

export interface ConfigCheck {
  readonly ok: boolean;
  /** Clés manquantes ou de mauvaise valeur. */
  readonly problems: readonly string[];
}

export function checkLogConfig(text: string | undefined): ConfigCheck {
  const power = text === undefined ? undefined : section(parseIni(text), 'Power');
  const problems = Object.entries(REQUIRED_POWER_SETTINGS)
    .filter(([k, v]) => power?.values[k]?.toLowerCase() !== v)
    .map(([k, v]) => `[Power] ${k}=${v}`);
  return { ok: problems.length === 0, problems };
}

export function checkClientConfig(text: string | undefined): ConfigCheck {
  const log = text === undefined ? undefined : section(parseIni(text), 'Log');
  const ok = log?.values['FileSizeLimit.Int'] === '-1';
  return { ok, problems: ok ? [] : ['[Log] FileSizeLimit.Int=-1'] };
}

/**
 * Renvoie le contenu corrigé d'un fichier INI : la section demandée est réécrite avec les
 * valeurs requises (les autres clés et sections sont conservées). Fins de ligne CRLF.
 */
export function patchIniSection(
  text: string | undefined,
  name: string,
  required: Readonly<Record<string, string>>,
): string {
  const sections = text === undefined ? [] : parseIni(text);
  const existing = section(sections, name);
  const merged: IniSection = {
    name: existing?.name ?? name,
    values: { ...existing?.values, ...required },
  };
  const out =
    existing === undefined
      ? [...sections, merged]
      : sections.map((s) => (s === existing ? merged : s));
  return (
    out
      .map((s) =>
        [`[${s.name}]`, ...Object.entries(s.values).map(([k, v]) => `${k}=${v}`)].join('\r\n'),
      )
      .join('\r\n') + '\r\n'
  );
}

export const patchLogConfig = (text: string | undefined): string =>
  patchIniSection(text, 'Power', REQUIRED_POWER_SETTINGS);

export const patchClientConfig = (text: string | undefined): string =>
  patchIniSection(text, 'Log', { 'FileSizeLimit.Int': '-1' });

/** Emplacements par défaut (à confirmer par l'utilisateur ; l'installation peut être ailleurs). */
export function defaultGamePaths(platform: NodeJS.Platform = process.platform): {
  installDir: string;
  logsRoot: string;
  logConfig: string;
  clientConfig: string;
} {
  if (platform === 'darwin') {
    const installDir = '/Applications/Hearthstone';
    return {
      installDir,
      logsRoot: join(installDir, 'Logs'),
      logConfig: join(homedir(), 'Library', 'Preferences', 'Blizzard', 'Hearthstone', 'log.config'),
      clientConfig: join(installDir, 'client.config'),
    };
  }
  const installDir = 'C:\\Program Files (x86)\\Hearthstone';
  const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
  return {
    installDir,
    logsRoot: join(installDir, 'Logs'),
    logConfig: join(localAppData, 'Blizzard', 'Hearthstone', 'log.config'),
    clientConfig: join(installDir, 'client.config'),
  };
}
