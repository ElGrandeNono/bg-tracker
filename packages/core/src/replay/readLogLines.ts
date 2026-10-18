import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import type { Readable } from 'node:stream';

/**
 * Lit un Power.log enregistré, en clair (`.log`) ou compressé (`.gz`), ligne par ligne.
 * Le fichier est en UTF-8 avec des fins de ligne CRLF : readline retire le `\r`
 * grâce à `crlfDelay: Infinity`.
 */
export async function* readLogLines(path: string): AsyncGenerator<string> {
  let stream: Readable = createReadStream(path);
  if (path.endsWith('.gz')) {
    stream = stream.pipe(createGunzip());
  } else if (path.endsWith('.zip')) {
    // Le support .zip arrive en M1 avec le mode replay complet.
    throw new Error(`Format .zip pas encore pris en charge : ${path}`);
  }
  stream.setEncoding('utf8');
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      yield line;
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}
