import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { strFromU8, unzipSync } from 'fflate';

/**
 * Lit un Power.log enregistré, ligne par ligne : en clair (`.log`), compressé (`.gz`) ou dans
 * une archive (`.zip`, premier fichier `.log` de l'archive). Le fichier est en UTF-8 avec des
 * fins de ligne CRLF : readline retire le `\r` grâce à `crlfDelay: Infinity`.
 */
export async function* readLogLines(path: string): AsyncGenerator<string> {
  let stream: Readable;
  if (path.endsWith('.zip')) {
    stream = Readable.from([await readZippedLog(path)]);
  } else {
    stream = createReadStream(path);
    if (path.endsWith('.gz')) stream = stream.pipe(createGunzip());
    stream.setEncoding('utf8');
  }
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

async function readZippedLog(path: string): Promise<string> {
  const files = unzipSync(new Uint8Array(await readFile(path)), {
    filter: (f) => f.name.toLowerCase().endsWith('.log'),
  });
  const name = Object.keys(files).sort()[0];
  const data = name === undefined ? undefined : files[name];
  if (data === undefined) throw new Error(`Aucun fichier .log dans l'archive : ${path}`);
  return strFromU8(data);
}
