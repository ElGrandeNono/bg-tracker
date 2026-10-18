// Build du processus principal et du preload (esbuild), et génération optionnelle de la démo.
//   node build.mjs              main + preload + outil de démo
//   node build.mjs --demo-only  + génère src/renderer/public/demo.json depuis une fixture
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  // koffi embarque un module natif (.node) : chargé depuis node_modules, pas empaqueté.
  external: ['electron', 'koffi'],
  // Les paquets du workspace exposent leurs sources TS sous la condition `source`.
  conditions: ['source'],
  logLevel: 'warning',
};

await Promise.all([
  build({
    ...common,
    entryPoints: ['src/main/main.ts'],
    outfile: 'dist/main/main.js',
    format: 'esm',
  }),
  build({
    ...common,
    entryPoints: ['src/preload/preload.ts'],
    outfile: 'dist/preload/preload.cjs',
    format: 'cjs',
  }),
  build({
    ...common,
    entryPoints: ['src/tools/makeDemo.ts'],
    outfile: 'dist/tools/makeDemo.js',
    format: 'esm',
  }),
  // Worker du simulateur de combat (worker_threads), chargé par SimulationPool.
  build({
    ...common,
    entryPoints: ['src/main/simWorker.ts'],
    outfile: 'dist/main/simWorker.js',
    format: 'esm',
  }),
]);

if (process.argv.includes('--demo-only')) {
  execFileSync(
    process.execPath,
    [
      'dist/tools/makeDemo.js',
      '../../fixtures/bg-solo-2026-10-18-complete.Power.log.gz',
      'src/renderer/public/demo.json',
      '.cache/cards',
    ],
    { stdio: 'inherit' },
  );
}
