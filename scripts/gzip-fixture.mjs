// Compresse un log brut en .gz (niveau max) à côté de lui : node scripts/gzip-fixture.mjs <fichier.log>
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGzip, constants } from 'node:zlib';

const src = process.argv[2];
if (!src) {
  console.error('usage : node scripts/gzip-fixture.mjs <fichier.log>');
  process.exit(1);
}
await pipeline(
  createReadStream(src),
  createGzip({ level: constants.Z_BEST_COMPRESSION }),
  createWriteStream(`${src}.gz`),
);
console.log(`${src}.gz écrit`);
