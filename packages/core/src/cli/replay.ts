#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { formatEntry, formatSummary } from '../bg/format.js';
import { Pipeline } from '../pipeline.js';
import { replayFile } from '../replay/replay.js';

/** `pnpm replay <fichier.log|.gz|.zip> [--speed N] [--quiet]` : rejoue un log et affiche la chronologie. */

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    speed: { type: 'string', default: '0' },
    quiet: { type: 'boolean', default: false },
  },
});

const file = positionals[0];
if (file === undefined) {
  console.error('usage : pnpm replay <fichier.log|.gz|.zip> [--speed N] [--quiet]');
  process.exit(1);
}

const pipeline = new Pipeline();
let printed = 0;
pipeline.subscribe((bg) => {
  if (values.quiet) return;
  for (; printed < bg.timeline.length; printed++) {
    const entry = bg.timeline[printed];
    const text = entry === undefined ? undefined : formatEntry(bg, entry);
    if (text !== undefined) console.log(text);
  }
});

const started = performance.now();
await replayFile(file, pipeline, { speed: Number(values.speed) });
const elapsed = Math.round(performance.now() - started);

console.log(`\n${formatSummary(pipeline.bg)}`);
const diag = pipeline.parser.diagnostics;
console.log(`Lignes Power non reconnues : ${diag.unrecognized} · rejoué en ${elapsed} ms`);
