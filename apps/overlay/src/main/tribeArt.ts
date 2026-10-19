import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PoolCard } from '@bgt/core';

/**
 * Icônes de tribu : l'illustration d'un serviteur représentatif de chaque tribu, téléchargée au
 * runtime depuis HearthstoneJSON (https://hearthstonejson.com/docs/images.html, format
 * `art.hearthstonejson.com/v1/256x/<cardId>.jpg`, vérifié le 19/10/2026) et mise en cache locale.
 * Rien n'est embarqué dans l'installeur. Hors ligne, l'interface affiche un insigne de repli.
 */

const ART_URL = (cardId: string): string => `https://art.hearthstonejson.com/v1/256x/${cardId}.jpg`;

/** Serviteur représentatif : mono-tribu, du plus petit niveau, puis par identifiant (stable). */
export function representativeCards(catalog: readonly PoolCard[]): Record<string, string> {
  const out: Record<string, PoolCard> = {};
  for (const c of catalog) {
    const tribe = c.tribes[0];
    if (c.allTribes || c.tribes.length !== 1 || tribe === undefined) continue;
    const cur = out[tribe];
    if (cur === undefined || c.tier < cur.tier || (c.tier === cur.tier && c.id < cur.id)) {
      out[tribe] = c;
    }
  }
  return Object.fromEntries(Object.entries(out).map(([t, c]) => [t, c.id]));
}

async function artDataUrl(cacheDir: string, cardId: string): Promise<string | undefined> {
  if (!/^[A-Za-z0-9_]+$/.test(cardId)) return undefined;
  const file = join(cacheDir, `${cardId}.jpg`);
  try {
    return `data:image/jpeg;base64,${(await readFile(file)).toString('base64')}`;
  } catch {
    // pas encore en cache
  }
  try {
    const res = await fetch(ART_URL(cardId));
    if (!res.ok) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, buf);
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch {
    return undefined;
  }
}

/** Tribu → image (data URL) ; les tribus sans image (hors ligne) sont absentes. */
export async function loadTribeArt(
  catalog: readonly PoolCard[],
  cacheDir: string,
): Promise<Record<string, string>> {
  const reps = representativeCards(catalog);
  const entries = await Promise.all(
    Object.entries(reps).map(
      async ([tribe, id]) => [tribe, await artDataUrl(cacheDir, id)] as const,
    ),
  );
  return Object.fromEntries(entries.filter((e): e is [string, string] => e[1] !== undefined));
}
