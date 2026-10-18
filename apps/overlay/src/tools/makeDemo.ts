import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildVisibleView, Pipeline, readLogLines, type VisibleView } from '@bgt/core';
import { buildPoolCatalog, loadCardDb } from '@bgt/data';
import { S14_POOL_RULES } from '@bgt/season-s14';
import type { PoolCard } from '@bgt/core';
import type { CatalogCard } from '../shared/payload.js';
import { catalogCards, poolPayload } from '../main/poolPayload.js';
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
pipeline.subscribe(() => {
  // Comme l'overlay : uniquement l'état déjà affiché par le client.
  const { bg, state } = pipeline.displayed;
  // Un instantané au milieu de chaque recrutement (après la fin du combat) et à chaque combat.
  for (; lastKinds < bg.timeline.length; lastKinds++) {
    const kind = bg.timeline[lastKinds]?.kind;
    if (kind === 'combatEnd' || kind === 'combatStart' || kind === 'eliminated') {
      views.push(buildVisibleView(bg, state));
    }
  }
});
for await (const line of readLogLines(fixture)) pipeline.feedLine(line);
pipeline.end();
views.push(buildVisibleView(pipeline.displayed.bg, pipeline.displayed.state));

const build = views.at(-1)?.build ?? 'latest';
let names: Record<string, string> = {};
let catalog: PoolCard[] = [];
let uiCatalog: CatalogCard[] = [];
try {
  const { db } = await loadCardDb({ build, locale: 'frFR', cacheDir });
  catalog = buildPoolCatalog(db);
  uiCatalog = catalogCards(db, catalog, S14_POOL_RULES);
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
  pool: catalog.length === 0 ? undefined : poolPayload(view, catalog, S14_POOL_RULES),
}));
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(frames));
await writeFile(join(dirname(out), 'demo-catalog.json'), JSON.stringify(uiCatalog));
console.log(`${frames.length} instantanés → ${join(out)}`);
