import { simulateCombat } from './engine.js';
import { DEFAULT_REGISTRY, type EffectRegistry } from './registry.js';
import { Rng } from './rng.js';
import type { CombatOutcome, SimInput, SimSummary } from './types.js';

/** Agrégat sérialisable (transmis par les workers puis fusionné). */
export interface Tally {
  iterations: number;
  win: number;
  tie: number;
  loss: number;
  lethalA: number;
  lethalB: number;
  dmgB: { n: number; sum: number; min: number; max: number };
  dmgA: { n: number; sum: number; min: number; max: number };
}

export function emptyTally(): Tally {
  return {
    iterations: 0,
    win: 0,
    tie: 0,
    loss: 0,
    lethalA: 0,
    lethalB: 0,
    dmgB: { n: 0, sum: 0, min: Infinity, max: 0 },
    dmgA: { n: 0, sum: 0, min: Infinity, max: 0 },
  };
}

export function addOutcome(t: Tally, o: CombatOutcome, input: SimInput): void {
  t.iterations++;
  if (o.result === 'win') {
    t.win++;
    add(t.dmgB, o.damage);
    if (input.b.heroHealth !== undefined && o.damage >= input.b.heroHealth) t.lethalA++;
  } else if (o.result === 'loss') {
    t.loss++;
    add(t.dmgA, o.damage);
    if (input.a.heroHealth !== undefined && o.damage >= input.a.heroHealth) t.lethalB++;
  } else {
    t.tie++;
  }
}

function add(d: Tally['dmgA'], v: number): void {
  d.n++;
  d.sum += v;
  d.min = Math.min(d.min, v);
  d.max = Math.max(d.max, v);
}

export function mergeTallies(a: Tally, b: Tally): Tally {
  const m = (x: Tally['dmgA'], y: Tally['dmgA']): Tally['dmgA'] => ({
    n: x.n + y.n,
    sum: x.sum + y.sum,
    min: Math.min(x.min, y.min),
    max: Math.max(x.max, y.max),
  });
  return {
    iterations: a.iterations + b.iterations,
    win: a.win + b.win,
    tie: a.tie + b.tie,
    loss: a.loss + b.loss,
    lethalA: a.lethalA + b.lethalA,
    lethalB: a.lethalB + b.lethalB,
    dmgB: m(a.dmgB, b.dmgB),
    dmgA: m(a.dmgA, b.dmgA),
  };
}

export function summarize(t: Tally, input: SimInput): SimSummary {
  const n = Math.max(1, t.iterations);
  const stats = (d: Tally['dmgA']): SimSummary['damageToA'] =>
    d.n === 0 ? undefined : { min: d.min, avg: d.sum / d.n, max: d.max };
  const unsupported = [...input.a.minions, ...input.b.minions]
    .filter((m) => m.unsupportedEffect === true)
    .map((m) => m.cardId);
  return {
    iterations: t.iterations,
    win: t.win / n,
    tie: t.tie / n,
    loss: t.loss / n,
    lethalForA: input.b.heroHealth === undefined ? undefined : t.lethalA / n,
    lethalForB: input.a.heroHealth === undefined ? undefined : t.lethalB / n,
    damageToB: stats(t.dmgB),
    damageToA: stats(t.dmgA),
    approximate: unsupported.length > 0,
    unsupportedCards: [...new Set(unsupported)],
  };
}

/** Lance `iterations` combats à partir de `seed` (déterministe) et renvoie l'agrégat brut. */
export function runTally(
  input: SimInput,
  iterations: number,
  seed: number,
  registry: EffectRegistry = DEFAULT_REGISTRY,
): Tally {
  const rng = new Rng(seed);
  const t = emptyTally();
  for (let i = 0; i < iterations; i++) addOutcome(t, simulateCombat(input, rng, registry), input);
  return t;
}

/** Monte Carlo sur le thread courant. */
export function simulate(
  input: SimInput,
  options: { iterations?: number; seed?: number; registry?: EffectRegistry } = {},
): SimSummary {
  const t = runTally(input, options.iterations ?? 10_000, options.seed ?? 1, options.registry);
  return summarize(t, input);
}
