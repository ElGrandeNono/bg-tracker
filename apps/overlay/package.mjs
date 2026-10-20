// Empaquetage Windows (electron-builder, installeur NSIS). À lancer après `pnpm build`.
//   node package.mjs            installeur NSIS dans release/out
//   node package.mjs --dir      application décompressée seulement (vérification rapide)
//   node package.mjs --publish  installeur + brouillon de release GitHub (CI, GH_TOKEN requis)
//
// Le code est déjà regroupé par esbuild/Vite : l'application empaquetée ne contient que dist/
// et koffi (module natif, MIT). Aucun asset Blizzard ; l'icône est générée ici.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';
import { Arch, build, Platform } from 'electron-builder';

const here = import.meta.dirname;
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
const stage = join(here, 'release', 'app');
/** Modules chargés à l'exécution (natif ou worker) : embarqués tels quels dans node_modules. */
const RUNTIME_DEPS = ['koffi', 'tesseract.js', '@tesseract.js-data/fra', '@tesseract.js-data/eng'];
const resources = join(here, 'release', 'build');

// ------------------------------------------------------------- dossier de l'application
rmSync(join(here, 'release'), { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
mkdirSync(resources, { recursive: true });
cpSync(join(here, 'dist'), join(stage, 'dist'), {
  recursive: true,
  // ni outil de démo ni cartes de sources (taille), ni données de démonstration
  filter: (src) => !/[\\/]dist[\\/]tools([\\/]|$)|\.map$|demo[^\\/]*\.json$/.test(src),
});
writeFileSync(
  join(stage, 'package.json'),
  JSON.stringify(
    {
      name: 'bg-tracker',
      productName: 'BG Tracker',
      version: pkg.version,
      description: 'Tracker Hearthstone Battlegrounds. Non affilié à Blizzard Entertainment.',
      license: 'MIT',
      author: 'ElGrandeNono',
      type: 'module',
      main: 'dist/main/main.js',
      // Seules dépendances non regroupées par esbuild (voir build.mjs, external), versions exactes.
      dependencies: Object.fromEntries(RUNTIME_DEPS.map((d) => [d, pkg.dependencies[d]])),
    },
    null,
    2,
  ),
);
// Installées par npm dans le dossier de l'application : koffi tire son binaire Windows
// (paquet optionnel @koromix/koffi-win32-x64) ; scripts d'installation désactivés.
execFileSync(
  'npm',
  ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock'],
  { cwd: stage, stdio: 'inherit', shell: true },
);
cpSync(join(here, '..', '..', 'LICENSE'), join(stage, 'LICENSE'));

// ------------------------------------------------------------- icône générée (PNG 256×256)
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) raw.set(pixel(x, y), y * (size * 4 + 1) + 1 + x * 4);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
// Carré arrondi ambre, anneau sombre et losange central (couleurs de l'overlay).
const S = 256;
writeFileSync(
  join(resources, 'icon.png'),
  png(S, (x, y) => {
    const cx = x - S / 2 + 0.5;
    const cy = y - S / 2 + 0.5;
    const r = 44;
    const qx = Math.max(Math.abs(cx) - (S / 2 - 8 - r), 0);
    const qy = Math.max(Math.abs(cy) - (S / 2 - 8 - r), 0);
    if (Math.hypot(qx, qy) > r) return [0, 0, 0, 0];
    const d = Math.hypot(cx, cy);
    if (Math.abs(cx) + Math.abs(cy) < 46) return [0xee, 0xf0, 0xf6, 255];
    if (d > 70 && d < 86) return [0x12, 0x14, 0x1c, 255];
    return [0xf5, 0xb4, 0x2a, 255];
  }),
);

// ------------------------------------------------------------- electron-builder
const args = process.argv.slice(2);
await build({
  targets: Platform.WINDOWS.createTarget(args.includes('--dir') ? 'dir' : 'nsis', Arch.x64),
  publish: args.includes('--publish') ? 'always' : 'never',
  config: {
    appId: 'io.github.elgrandenono.bgtracker',
    productName: 'BG Tracker',
    copyright: 'MIT · BG Tracker n’est pas affilié à Blizzard Entertainment',
    electronVersion: pkg.devDependencies.electron,
    directories: { app: stage, output: join(here, 'release', 'out'), buildResources: resources },
    files: ['**/*'],
    // Natif (koffi) et workers (simulation, OCR) : hors de l'archive asar.
    // Pas d'archive asar : module natif (koffi) et workers (simulation, OCR) chargent leurs
    // dépendances depuis le disque ; un worker_threads ne lit pas l'intérieur d'une archive asar.
    asar: false,
    electronLanguages: ['fr', 'en-US'],
    npmRebuild: false,
    nodeGypRebuild: false,
    win: { icon: join(resources, 'icon.png') },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      deleteAppDataOnUninstall: false,
      license: join(stage, 'LICENSE'),
      artifactName: 'BG-Tracker-Setup-${version}.${ext}',
    },
    publish: [
      { provider: 'github', owner: 'ElGrandeNono', repo: 'bg-tracker', releaseType: 'draft' },
    ],
  },
});
