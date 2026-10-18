import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Pipeline, readLogLines } from '@bgt/core';
import { buildPoolCatalog, loadCardDb, type CardDb } from '@bgt/data';
import { simulate } from '@bgt/sim';
import { buildSimRequest } from '../main/combatSim.js';
import {
  currentPoolRules as S14_POOL_RULES,
  currentSeason,
  overlayView,
  type OverlayView,
} from '../main/season.js';
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

const pipeline = new Pipeline(currentSeason);
const views: OverlayView[] = [];
let lastKinds = 0;
const lockedRounds = new Set<number>();
pipeline.subscribe(() => {
  // Comme l'overlay : uniquement l'état déjà affiché par le client.
  const { bg } = pipeline.displayed;
  // Un instantané au milieu de chaque recrutement (après la fin du combat) et à chaque combat.
  // Et un instantané en plein combat, dès que les plateaux sont figés (simulation du combat).
  const c = bg.combats.at(-1);
  if (c !== undefined && c.endMs === undefined && c.boardsLocked && !lockedRounds.has(c.round)) {
    lockedRounds.add(c.round);
    views.push(overlayView(pipeline.displayed));
  }
  for (; lastKinds < bg.timeline.length; lastKinds++) {
    const kind = bg.timeline[lastKinds]?.kind;
    if (kind === 'combatEnd' || kind === 'combatStart' || kind === 'eliminated') {
      views.push(overlayView(pipeline.displayed));
    }
  }
});
for await (const line of readLogLines(fixture)) pipeline.feedLine(line);
pipeline.end();
views.push(overlayView(pipeline.displayed));

const build = views.at(-1)?.build ?? 'latest';
let names: Record<string, string> = {};
let db: CardDb | undefined;
let catalog: PoolCard[] = [];
let uiCatalog: CatalogCard[] = [];
try {
  db = (await loadCardDb({ build, locale: 'frFR', cacheDir })).db;
  catalog = buildPoolCatalog(db);
  uiCatalog = catalogCards(db, catalog, S14_POOL_RULES);
  const ids = new Set<string>();
  for (const v of views) {
    if (v.local.heroCardId !== undefined) ids.add(v.local.heroCardId);
    for (const p of v.players) {
      ids.add(p.heroCardId);
      for (const m of p.lastBoard?.minions ?? []) ids.add(m.cardId);
    }
    for (const id of v.season?.shownCardIds ?? []) ids.add(id);
  }
  names = Object.fromEntries([...ids].map((id) => [id, db?.name(id) ?? id]));
} catch (e) {
  console.warn(`noms de cartes indisponibles : ${String(e)}`);
}

/** Simulation calculée sur le thread courant pour la démo (même entrée que l'overlay). */
function demoSim(view: OverlayView): OverlayPayload['combatSim'] {
  const req = buildSimRequest(view, db);
  if (req === undefined) return undefined;
  return {
    context: req.context,
    opponentPlayerId: req.opponentPlayerId,
    boardRound: req.boardRound,
    summary: simulate(req.input, { iterations: 5000, seed: 1 }),
    final: true,
  };
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
  combatSim: demoSim(view),
}));
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(frames));
await writeFile(join(dirname(out), 'demo-catalog.json'), JSON.stringify(uiCatalog));
console.log(`${frames.length} instantanés → ${join(out)}`);
