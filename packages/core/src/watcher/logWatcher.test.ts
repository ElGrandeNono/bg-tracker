import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LogWatcher, latestSessionDir, sessionDate } from './logWatcher.js';

// Lignes synthétiques : seul le découpage du flux est testé ici, pas le format du jeu.

let root: string;
let watcher: LogWatcher;
let lines: string[];
let events: string[];

async function session(name: string, content: string): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'Power.log');
  await writeFile(file, content);
  return file;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'bgt-watch-'));
  lines = [];
  events = [];
  watcher = new LogWatcher({ logsRoot: root, pollMs: 10_000 });
  watcher.on('line', (l) => lines.push(l));
  watcher.on('fileChanged', (p) => events.push(`file:${p.split(/[\\/]/).at(-2) ?? ''}`));
  watcher.on('shrunk', () => events.push('shrunk'));
});

afterEach(async () => {
  watcher.stop();
  await rm(root, { recursive: true, force: true });
});

describe('LogWatcher', () => {
  it('lit le fichier existant puis les ajouts, CRLF et UTF-8 compris', async () => {
    const file = await session('Hearthstone_2026_10_18_06_10_24', 'a\r\nб');
    await watcher.poll();
    expect(lines).toEqual(['a']); // « б » sans fin de ligne reste en attente
    await appendFile(file, Buffer.from('в\r\nc\r\n'));
    await watcher.poll();
    expect(lines).toEqual(['a', 'бв', 'c']);
  });

  it('recolle un caractère multi-octets coupé entre deux lectures', async () => {
    const file = await session('Hearthstone_2026_10_18_06_10_24', '');
    await watcher.poll();
    const bytes = Buffer.from('Игрок1\r\n');
    await appendFile(file, bytes.subarray(0, 3));
    await watcher.poll();
    await appendFile(file, bytes.subarray(3));
    await watcher.poll();
    expect(lines).toEqual(['Игрок1']);
  });

  it('détecte un fichier qui raccourcit sans perdre la ligne en cours', async () => {
    const file = await session('Hearthstone_2026_10_18_06_10_24', 'l1\r\nl2\r\npartiel');
    await watcher.poll();
    await writeFile(file, 'n1\r\n');
    await watcher.poll();
    expect(events).toEqual(['file:Hearthstone_2026_10_18_06_10_24', 'shrunk']);
    expect(lines).toEqual(['l1', 'l2', 'partiel', 'n1']);
  });

  it('bascule sur la session la plus récente quand le jeu est relancé', async () => {
    await session('Hearthstone_2026_10_18_05_47_45', 'ancien\r\n');
    await watcher.poll();
    await session('Hearthstone_2026_10_18_06_10_24', 'nouveau\r\n');
    await watcher.poll();
    expect(lines).toEqual(['ancien', 'nouveau']);
    expect(events).toEqual([
      'file:Hearthstone_2026_10_18_05_47_45',
      'file:Hearthstone_2026_10_18_06_10_24',
    ]);
  });

  it('ignore le contenu existant avec fromStart=false', async () => {
    watcher = new LogWatcher({ logsRoot: root, pollMs: 10_000, fromStart: false });
    watcher.on('line', (l) => lines.push(l));
    const file = await session('Hearthstone_2026_10_18_06_10_24', 'avant\r\n');
    await watcher.poll();
    await appendFile(file, 'après\r\n');
    await watcher.poll();
    expect(lines).toEqual(['après']);
  });
});

describe('dossiers de session', () => {
  it('choisit le plus récent et en déduit la date', async () => {
    await session('Hearthstone_2026_10_16_15_29_34', '');
    await session('Hearthstone_2026_10_18_06_10_24', '');
    await mkdir(join(root, 'autre'));
    expect(await latestSessionDir(root)).toBe(join(root, 'Hearthstone_2026_10_18_06_10_24'));
    expect(sessionDate('Hearthstone_2026_10_18_06_10_24')).toEqual(
      new Date(2026, 9, 18, 6, 10, 24),
    );
  });

  it('renvoie undefined si le dossier Logs est absent', async () => {
    expect(await latestSessionDir(join(root, 'absent'))).toBeUndefined();
  });
});
