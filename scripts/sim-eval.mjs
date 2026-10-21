// Mesure de la précision du simulateur sur des logs réels (outil de dev, après `pnpm build`).
//   node scripts/sim-eval.mjs [--cards <cacheDir>] [--verbose] <Power.log | .gz | dossier Logs> [...]
//
// Pour chaque combat : plateaux figés au début, entrée construite EXACTEMENT comme l'overlay
// (données de cartes : stats de base, tribus, effets non simulés), 5 000 combats à graine fixe,
// puis issue RÉELLE déduite des PV + armure des deux héros avant / après le combat. Les combats
// contre un adversaire déjà éliminé (fantôme) sont écartés : l'issue n'est pas mesurable.
// Lecture locale uniquement : rien n'est écrit ni envoyé.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const load = (p) => import(pathToFileURL(join(root, p)).href);
const core = await load('packages/core/dist/index.js');
const sim = await load('packages/sim/dist/index.js');
const data = await load('packages/data/dist/index.js');
const { canonicalTribe, numTag, Pipeline, readLogLines } = core;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const cardsDir = flag('--cards') ?? join(process.env.APPDATA ?? '', 'BG Tracker', 'cards');
const verbose = args.includes('--verbose');
const inputs = args.filter((a) => a !== '--verbose');

const KEYWORDS = ['TAUNT', 'DIVINE_SHIELD', 'REBORN', 'VENOMOUS', 'WINDFURY', 'STEALTH'];
const dbs = new Map();
async function dbFor(build) {
  if (!dbs.has(build)) {
    dbs.set(
      build,
      await data
        .loadCardDb({ build: build ?? 'latest', locale: 'frFR', cacheDir: cardsDir })
        .then((r) => r.db)
        .catch(() => undefined),
    );
  }
  return dbs.get(build);
}

/** Même construction que apps/overlay/src/main/combatSim.ts (plateaux figés : SoC résolus). */
function toSim(b, db, bloodGemUnknown) {
  const card = db?.normalVersion(b.cardId) ?? db?.byId(b.cardId);
  const own = db?.byId(b.cardId);
  const status = sim.effectStatus(card?.id ?? b.cardId, own?.mechanics ?? card?.mechanics, {
    golden: b.golden,
    startOfCombatApplied: true,
    bloodGemUnknown,
  });
  const has = (k) => own?.mechanics.includes(k) ?? false;
  return {
    cardId: card?.id ?? b.cardId,
    tribes: (card?.races ?? []).map(canonicalTribe),
    base:
      own?.attack === undefined
        ? undefined
        : {
            attack: own.attack,
            taunt: has('TAUNT'),
            divineShield: has('DIVINE_SHIELD'),
            venomous: has('VENOMOUS'),
            windfury: has('WINDFURY'),
          },
    attack: b.attack ?? 0,
    health: b.health ?? 1,
    tier: card?.techLevel ?? numTag({ id: 0, cardId: b.cardId, tags: b.tags }, 'TECH_LEVEL') ?? 1,
    golden: b.golden,
    ...Object.fromEntries(
      KEYWORDS.map((k) => [
        {
          TAUNT: 'taunt',
          DIVINE_SHIELD: 'divineShield',
          REBORN: 'reborn',
          VENOMOUS: 'venomous',
          WINDFURY: 'windfury',
          STEALTH: 'stealth',
        }[k],
        b.tags[k] === 1,
      ]),
    ),
    unsupportedEffect: status === 'unsupported',
  };
}

const hp = (p) => (p === undefined ? undefined : p.health - (p.damage ?? 0) + (p.armor ?? 0));

function files(list) {
  const out = [];
  for (const a of list) {
    if (statSync(a).isDirectory()) {
      for (const d of readdirSync(a).sort()) {
        const f = join(a, d, 'Power.log');
        if (existsSync(f)) out.push(f);
      }
    } else out.push(a);
  }
  return out;
}

const rows = [];
let ghosts = 0;
const unsupported = new Map();
for (const file of files(inputs)) {
  const p = new Pipeline();
  const pending = [];
  const open = new Map();
  p.subscribe(() => {
    const { bg, state } = p;
    const c = bg.combats.at(-1);
    if (c === undefined) return;
    const key = `${bg.gameIndex}:${c.round}`;
    const local = bg.localPlayerId === undefined ? undefined : bg.players[bg.localPlayerId];
    const opp = c.opponentPlayerId === undefined ? undefined : bg.players[c.opponentPlayerId];
    if (c.endMs === undefined && c.boardsLocked && !open.has(key)) {
      if (c.localBoard.length === 0 || c.opponentBoard.length === 0) return;
      const g =
        state.gameEntityId === undefined ? undefined : state.entities.get(state.gameEntityId);
      const cap =
        numTag(g, 'BACON_COMBAT_DAMAGE_CAP_ENABLED') === 1
          ? numTag(g, 'BACON_COMBAT_DAMAGE_CAP')
          : undefined;
      open.set(key, {
        build: bg.build,
        boards: [c.localBoard, c.opponentBoard],
        // Bonus de gemmes du joueur local (entité Player locale), comme l'overlay.
        gem: (() => {
          const me = core.localPlayer(state);
          const e = me === undefined ? undefined : state.entities.get(me.entityId);
          return {
            attack: 1 + (numTag(e, 'BACON_BLOODGEMBUFFATKVALUE') ?? 0),
            health: 1 + (numTag(e, 'BACON_BLOODGEMBUFFHEALTHVALUE') ?? 0),
          };
        })(),
        tiers: [local?.techLevel ?? 1, opp?.techLevel ?? 1],
        cap,
        before: [hp(local), hp(opp)],
        file,
        round: c.round,
        game: bg.gameIndex,
      });
    } else if (c.endMs !== undefined && open.has(key)) {
      const o = open.get(key);
      open.delete(key);
      pending.push({ ...o, after: [hp(local), hp(opp)] });
    }
  });
  for await (const line of readLogLines(file)) p.feedLine(line);
  p.end();
  for (const o of pending) {
    const [b0, b1] = o.before;
    const [a0, a1] = o.after;
    if ([b0, b1, a0, a1].some((x) => x === undefined)) continue;
    if (b1 <= 0) {
      ghosts++;
      continue;
    }
    const actual = a0 < b0 ? 'loss' : a1 < b1 ? 'win' : 'tie';
    const db = await dbFor(o.build);
    const input = {
      a: {
        minions: o.boards[0].map((m) => toSim(m, db, false)),
        tavernTier: o.tiers[0],
        bloodGem: o.gem,
      },
      b: { minions: o.boards[1].map((m) => toSim(m, db, true)), tavernTier: o.tiers[1] },
      ...(o.cap === undefined ? {} : { damageCap: o.cap }),
    };
    const sum = sim.simulate(input, { iterations: 5000, seed: 2026 });
    rows.push({ ...o, actual, sum, input });
    for (const id of new Set(sum.unsupportedCards))
      unsupported.set(id, (unsupported.get(id) ?? 0) + 1);
  }
}

let brier = 0;
const buckets = { exact: [0, 0], approx: [0, 0] };
let missesWith = new Map();
for (const r of rows) {
  const pr = { win: r.sum.win, tie: r.sum.tie, loss: r.sum.loss };
  brier += ['win', 'tie', 'loss'].reduce((s, k) => s + (pr[k] - (r.actual === k ? 1 : 0)) ** 2, 0);
  const best = Object.entries(pr).sort((a, b) => b[1] - a[1])[0][0];
  const b = buckets[r.sum.approximate ? 'approx' : 'exact'];
  b[1]++;
  if (best === r.actual) b[0]++;
  else
    for (const id of new Set(r.sum.unsupportedCards))
      missesWith.set(id, (missesWith.get(id) ?? 0) + 1);
}
const pct = (x) => `${Math.round(x * 100)} %`;
const total = rows.length;
console.log(`combats évalués : ${total} (fantômes écartés : ${ghosts})`);
console.log(
  `issue la plus probable = issue réelle : ${pct((buckets.exact[0] + buckets.approx[0]) / Math.max(1, total))}`,
);
console.log(`  sans carte non simulée : ${buckets.exact[0]}/${buckets.exact[1]}`);
console.log(`  avec carte(s) non simulée(s) : ${buckets.approx[0]}/${buckets.approx[1]}`);
console.log(
  `score de Brier moyen (0 = parfait, 0,67 = hasard) : ${(brier / Math.max(1, total)).toFixed(3)}`,
);
const name = (id) => [...dbs.values()].find((d) => d?.byId(id))?.name(id) ?? id;
console.log('cartes non simulées : combats concernés · dont mal prédits');
for (const [id, n] of [...unsupported].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  console.log(`  ${id} ${name(id)} : ${n} · ${missesWith.get(id) ?? 0}`);
}
if (verbose) {
  console.log('pires prédictions (probabilité donnée à l’issue réelle) :');
  for (const r of [...rows].sort((a, b) => a.sum[a.actual] - b.sum[b.actual]).slice(0, 15)) {
    console.log(
      `  ${r.file.split(/[\\/]/).at(-2)} partie ${r.game} tour ${r.round} : réel=${r.actual} V${pct(r.sum.win)} É${pct(r.sum.tie)} D${pct(r.sum.loss)}${r.sum.approximate ? ' ≈' : ''}`,
    );
  }
}
