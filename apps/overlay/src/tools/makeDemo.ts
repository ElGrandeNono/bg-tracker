import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildVisibleView, Pipeline, readLogLines, type VisibleView } from '@bgt/core';
import { loadCardDb } from '@bgt/data';
import { DEFAULT_SETTINGS, type OverlayPayload } from '../shared/payload.js';

/**
 * Génère `demo.json` pour développer l'UI dans un navigateur : instantanés de la vue filtrée
 * (jamais l'état brut) pris pendant le replay d'une fixture anonymisée.
 *   node dist/tools/makeDemo.js <fixture> <sortie.json> <cacheDir>
 */

const [fixture, out, cacheDir] = process.argv.slice(2);
if (fixture === undefined || out === undefined || cacheDir === undefined) {
  console.error('usage : makeDemo <fixture> <sortie.json> <cacheDir>');
  process.exit(1);
}

const pipeline = new Pipeline();
const views: VisibleView[] = [];
let lastKinds = 0;
pipeline.subscribe((bg) => {
  // Un instantané au milieu de chaque recrutement (après la fin du combat) et à chaque combat.
  for (; lastKinds < bg.timeline.length; lastKinds++) {
    const kind = bg.timeline[lastKinds]?.kind;
    if (kind === 'combatEnd' || kind === 'combatStart' || kind === 'eliminated') {
      views.push(buildVisibleView(bg, pipeline.state));
    }
  }
});
for await (const line of readLogLines(fixture)) pipeline.feedLine(line);
pipeline.end();
views.push(buildVisibleView(pipeline.bg, pipeline.state));

const build = views.at(-1)?.build ?? 'latest';
let names: Record<string, string> = {};
try {
  const { db } = await loadCardDb({ build, locale: 'frFR', cacheDir });
  const ids = new Set<string>();
  for (const v of views) {
    if (v.local.heroCardId !== undefined) ids.add(v.local.heroCardId);
    for (const p of v.players) {
      ids.add(p.heroCardId);
      for (const m of p.lastBoard?.minions ?? []) ids.add(m.cardId);
    }
  }
  names = Object.fromEntries([...ids].map((id) => [id, db.name(id)]));
} catch (e) {
  console.warn(`noms de cartes indisponibles : ${String(e)}`);
}

const frames: OverlayPayload[] = views.map((view) => ({
  view,
  names,
  status: {
    source: 'replay',
    configProblems: [],
    hsWindow: 'ok',
    cardData: 'ok',
    replayDone: true,
  },
  settings: { ...DEFAULT_SETTINGS, backdrop: true },
  timerEndsAt: undefined,
}));
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(frames));
console.log(`${frames.length} instantanés → ${join(out)}`);
