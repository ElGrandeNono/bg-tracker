import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readdirSync } from 'node:fs';
import { Pipeline, readLogLines } from '@bgt/core';
import { GameRecorder, HistoryStore } from '@bgt/history';
import { buildPoolCatalog, loadCardDb, type CardDb } from '@bgt/data';
import { simulate } from '@bgt/sim';
import { buildSimRequest } from '../main/combatSim.js';
import { trackTavernBuffs } from '../main/tavernBuffs.js';
import { cardArt, loadTribeArt } from '../main/tribeArt.js';
import {
  currentPoolRules as S14_POOL_RULES,
  currentSeason,
  overlayView,
  type OverlayView,
} from '../main/season.js';
import type { PoolCard } from '@bgt/core';
import type { CatalogCard, HistoryGame } from '../shared/payload.js';
import { catalogCards, poolPayload } from '../main/poolPayload.js';
import { DEFAULT_SETTINGS, type OverlayPayload, type TavernBuff } from '../shared/payload.js';

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
    const dbf = v.season?.counters.deityDbfId;
    const deity = dbf === undefined ? undefined : db.byDbfId(dbf)?.id;
    if (deity !== undefined) ids.add(deity);
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

// Bonus de la taverne suivis d'instantané en instantané, comme dans l'overlay.
let tavernMemory = new Map<string, TavernBuff>();
const tavernByFrame = views.map((v) => {
  tavernMemory = trackTavernBuffs(tavernMemory, v.shopEnchantments);
  return [...tavernMemory.values()];
});
for (const b of tavernMemory.values()) names[b.source] = db?.name(b.source) ?? b.source;

const frames: OverlayPayload[] = views.map((view, i) => ({
  view,
  names,
  status: {
    source: 'replay',
    configProblems: [],
    hsWindow: 'ok',
    cardData: 'ok',
    replayDone: true,
    stale: false,
  },
  settings: { ...DEFAULT_SETTINGS, backdrop: true },
  timerEndsAt: undefined,
  pool: catalog.length === 0 ? undefined : poolPayload(view, catalog, S14_POOL_RULES),
  combatSim: demoSim(view),
  manualTribes: undefined,
  choiceStats: undefined,
  externalStats: { 'heroes-solo': undefined, 'heroes-duos': undefined, trinkets: undefined },
  appVersion: 'démo',
  updateStatus: { state: 'idle' },
  deityCardId: (() => {
    const dbf = view.season?.counters.deityDbfId;
    return dbf === undefined ? undefined : db?.byDbfId(dbf)?.id;
  })(),
  tavernBuffs: tavernByFrame[i] ?? [],
}));
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(frames));
await writeFile(join(dirname(out), 'demo-catalog.json'), JSON.stringify(uiCatalog));
// Images des tribus (HearthstoneJSON, cache de dev hors dépôt) : jamais dans l'application.
await writeFile(
  join(dirname(out), 'demo-tribe-art.json'),
  JSON.stringify({
    ...(await loadTribeArt(catalog, join(cacheDir, '..', 'art'))),
    ...Object.fromEntries(
      await Promise.all(
        [...new Set(frames.map((f) => f.deityCardId).filter((x) => x !== undefined))].map(
          async (id) => [`card:${id}`, await cardArt(join(cacheDir, '..', 'art'), id)] as const,
        ),
      ),
    ),
  }),
);

// Historique de démonstration : les parties des fixtures, enregistrées comme en direct puis
// stockées dans une base SQLite en mémoire (ids, tri) ; les noms viennent des données de cartes.
const store = new HistoryStore(':memory:');
for (const name of readdirSync(dirname(fixture)).filter((f) => f.endsWith('.Power.log.gz'))) {
  const dir = /(\d{4})-(\d\d)-(\d\d)/.exec(name);
  const date =
    dir === null ? undefined : new Date(Number(dir[1]), Number(dir[2]) - 1, Number(dir[3]));
  const recorder = new GameRecorder((id) => db?.baseHero(id)?.id ?? id, date);
  const p = new Pipeline(currentSeason);
  p.subscribe(() => {
    const r = recorder.observe(overlayView(p.displayed));
    if (r !== undefined) store.insert(r);
  });
  for await (const line of readLogLines(join(dirname(fixture), name))) p.feedLine(line);
  p.end();
  const last = recorder.observe(overlayView(p.displayed)) ?? recorder.flush();
  if (last !== undefined) store.insert(last);
}
const games = store.list();
const details: Record<number, HistoryGame> = {};
const allIds = new Set<string>();
for (const g of games) {
  const full = store.get(g.id ?? -1);
  if (full === undefined) continue;
  const ids = new Set<string>([full.heroCardId, full.heroBaseCardId]);
  for (const r of full.replay) {
    for (const m of [...r.localBoard, ...(r.opponent?.board ?? [])]) ids.add(m.cardId);
    if (r.opponent !== undefined) ids.add(r.opponent.heroCardId);
  }
  ids.forEach((i) => allIds.add(i));
  details[g.id ?? -1] = {
    game: full,
    names: Object.fromEntries([...ids].map((i) => [i, db?.name(i) ?? i])),
  };
}
await writeFile(
  join(dirname(out), 'demo-history.json'),
  JSON.stringify({
    games,
    names: Object.fromEntries([...allIds].map((i) => [i, db?.name(i) ?? i])),
    details,
  }),
);
console.log(`${games.length} parties dans l'historique de démo`);
console.log(`${frames.length} instantanés → ${join(out)}`);
