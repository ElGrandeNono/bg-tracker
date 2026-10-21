// Mesure de la précision du simulateur sur des logs réels (outil de dev, après `pnpm build`).
//   node scripts/sim-eval.mjs <Power.log | .gz | dossier Logs> [...]
//
// Pour chaque combat : plateaux figés au début (comme l'overlay), simulation (5 000 combats,
// graine fixe), puis issue RÉELLE déduite des PV + armure des deux héros avant / après le combat.
// Affiche : probabilité donnée à l'issue réelle, score de Brier, cartes non simulées les plus
// fréquentes. Rien n'est écrit ni envoyé : lecture locale uniquement.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const core = await import(pathToFileURL(join(root, 'packages/core/dist/index.js')).href);
const sim = await import(pathToFileURL(join(root, 'packages/sim/dist/index.js')).href);
const { numTag, Pipeline, readLogLines } = core;

const toSim = (b) => ({
  cardId: b.cardId,
  attack: b.attack ?? 0,
  health: b.health ?? 1,
  tier: numTag({ id: 0, cardId: b.cardId, tags: b.tags }, 'TECH_LEVEL') ?? 1,
  golden: b.golden,
  taunt: b.tags.TAUNT === 1,
  divineShield: b.tags.DIVINE_SHIELD === 1,
  reborn: b.tags.REBORN === 1,
  venomous: b.tags.VENOMOUS === 1,
  windfury: b.tags.WINDFURY === 1,
  stealth: b.tags.STEALTH === 1,
});
const hp = (p) => (p === undefined ? undefined : p.health - (p.damage ?? 0) + (p.armor ?? 0));

function files(args) {
  const out = [];
  for (const a of args) {
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
const unsupported = new Map();
for (const file of files(process.argv.slice(2))) {
  const p = new Pipeline();
  const open = new Map(); // clé partie/tour → { sum, before }
  p.subscribe(() => {
    const { bg, state } = p;
    const c = bg.combats.at(-1);
    if (c === undefined) return;
    const key = `${bg.gameIndex}:${c.round}`;
    const local = bg.localPlayerId === undefined ? undefined : bg.players[bg.localPlayerId];
    const opp = c.opponentPlayerId === undefined ? undefined : bg.players[c.opponentPlayerId];
    if (c.endMs === undefined && c.boardsLocked && !open.has(key)) {
      if (c.localBoard.length === 0 && c.opponentBoard.length === 0) return;
      const g =
        state.gameEntityId === undefined ? undefined : state.entities.get(state.gameEntityId);
      const cap =
        numTag(g, 'BACON_COMBAT_DAMAGE_CAP_ENABLED') === 1
          ? numTag(g, 'BACON_COMBAT_DAMAGE_CAP')
          : undefined;
      const input = {
        a: { minions: c.localBoard.map(toSim), tavernTier: local?.techLevel ?? 1 },
        b: { minions: c.opponentBoard.map(toSim), tavernTier: opp?.techLevel ?? 1 },
        ...(cap === undefined ? {} : { damageCap: cap }),
      };
      const sum = sim.simulate(input, { iterations: 5000, seed: 2026 });
      open.set(key, {
        sum,
        before: [hp(local), hp(opp)],
        file,
        round: c.round,
        game: bg.gameIndex,
      });
    } else if (c.endMs !== undefined && open.has(key)) {
      const o = open.get(key);
      open.delete(key);
      const [la, oa] = [hp(local), hp(opp)];
      if (
        o.before[0] === undefined ||
        o.before[1] === undefined ||
        la === undefined ||
        oa === undefined
      )
        return;
      const actual = la < o.before[0] ? 'loss' : oa < o.before[1] ? 'win' : 'tie';
      rows.push({
        ...o,
        actual,
        after: [la, oa],
        sizes: [c.localBoard.length, c.opponentBoard.length],
      });
      for (const id of o.sum.unsupportedCards) unsupported.set(id, (unsupported.get(id) ?? 0) + 1);
    }
  });
  for await (const line of readLogLines(file)) p.feedLine(line);
  p.end();
}

let brier = 0;
let hits = 0;
const buckets = { exact: 0, approx: 0, exactOk: 0, approxOk: 0 };
for (const r of rows) {
  const p = { win: r.sum.win, tie: r.sum.tie, loss: r.sum.loss };
  brier += ['win', 'tie', 'loss'].reduce((s, k) => s + (p[k] - (r.actual === k ? 1 : 0)) ** 2, 0);
  const best = Object.entries(p).sort((a, b) => b[1] - a[1])[0][0];
  const ok = best === r.actual;
  if (ok) hits++;
  const b = r.sum.approximate ? 'approx' : 'exact';
  buckets[b]++;
  if (ok) buckets[`${b}Ok`]++;
}
const pct = (x) => `${Math.round(x * 100)} %`;
console.log(`combats évalués : ${rows.length}`);
console.log(`issue la plus probable = issue réelle : ${pct(hits / Math.max(1, rows.length))}`);
console.log(
  `  sans carte non simulée : ${buckets.exactOk}/${buckets.exact} · avec : ${buckets.approxOk}/${buckets.approx}`,
);
console.log(
  `score de Brier moyen (0 = parfait, 0,67 = hasard) : ${(brier / Math.max(1, rows.length)).toFixed(3)}`,
);
console.log('pires prédictions (probabilité donnée à l’issue réelle) :');
for (const r of [...rows].sort((a, b) => a.sum[a.actual] - b.sum[b.actual]).slice(0, 12)) {
  console.log(
    `  ${r.file.split(/[\\/]/).at(-2)} partie ${r.game} tour ${r.round} [${r.sizes}] PV ${r.before}→${r.after} : réel=${r.actual} prédit V${pct(r.sum.win)} É${pct(r.sum.tie)} D${pct(r.sum.loss)}${r.sum.approximate ? ' ≈' : ''}`,
  );
}
console.log('cartes non simulées les plus fréquentes (combats concernés) :');
for (const [id, n] of [...unsupported].sort((a, b) => b[1] - a[1]).slice(0, 25))
  console.log(`  ${id} ${n}`);
