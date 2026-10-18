import type { EffectRegistry } from './registry.js';
import type { Rng } from './rng.js';
import type { CombatOutcome, SimInput, SimMinionInput, SimSideInput } from './types.js';

/**
 * Moteur de combat Battlegrounds. Règles appliquées et leur source :
 *
 * [wiki] https://hearthstone.wiki.gg/wiki/Battlegrounds (consulté le 19/10/2026)
 * - commence le camp qui a le plus de serviteurs ; égalité → tirage au sort ;
 * - attaques automatiques, en alternance, de gauche à droite ; les serviteurs invoqués en cours de
 *   combat participent à cet ordre ;
 * - cible aléatoire, Provocations d'abord ;
 * - un serviteur à 0 d'attaque passe son tour ; égalité si les deux camps n'ont plus que des
 *   serviteurs à 0 d'attaque, ou si aucun ne survit ;
 * - dégâts au héros perdant : niveau de taverne du gagnant + niveaux de ses serviteurs survivants ;
 * - Furie des vents : attaque deux fois.
 * [26.2] https://news.blizzard.com/en-us/article/23935322/26-2-patch-notes
 * - Venimeux : seul le premier serviteur endommagé par lui pendant le combat est détruit.
 * [log] plafond de dégâts lu dans le log (`BACON_COMBAT_DAMAGE_CAP`), fourni par l'appelant.
 *
 * Règles standard de Hearthstone NON vérifiées sur un log BG (voir docs/simulator-coverage.md) :
 * Bouclier divin (absorbe un coup), Réincarnation (revient comme la carte d'origine avec 1 PV, à
 * sa place, après les Râles d'agonie ; Bouclier divin d'origine retrouvé : constaté dans le log), Camouflage (non ciblable tant qu'il n'a pas attaqué, sauf s'il ne reste que des
 * cibles camouflées), ordre de résolution des morts (camp attaquant d'abord, de gauche à droite),
 * limite de 7 serviteurs.
 */

export const MAX_BOARD = 7;
const MAX_ATTACKS = 400;

export class Minion {
  readonly cardId: string;
  attack: number;
  health: number;
  readonly tier: number;
  readonly golden: boolean;
  taunt: boolean;
  divineShield: boolean;
  reborn: boolean;
  venomous: boolean;
  windfury: boolean;
  stealth: boolean;
  readonly tribes: readonly string[];
  readonly base: SimMinionInput['base'];
  dead = false;

  constructor(m: SimMinionInput) {
    this.cardId = m.cardId;
    this.attack = m.attack;
    this.health = m.health;
    this.tier = m.tier;
    this.golden = m.golden ?? false;
    this.taunt = m.taunt ?? false;
    this.divineShield = m.divineShield ?? false;
    this.reborn = m.reborn ?? false;
    this.venomous = m.venomous ?? false;
    this.windfury = m.windfury ?? false;
    this.stealth = m.stealth ?? false;
    this.tribes = m.tribes ?? [];
    this.base = m.base;
  }
}

export class Side {
  board: Minion[];
  /** Index du prochain attaquant. */
  next = 0;

  constructor(
    readonly index: 0 | 1,
    input: SimSideInput,
  ) {
    this.board = input.minions.slice(0, MAX_BOARD).map((m) => new Minion(m));
  }

  alive(): Minion[] {
    return this.board.filter((m) => !m.dead);
  }
}

/** Contexte offert aux effets de cartes (registre). */
export class CombatContext {
  constructor(
    readonly sides: readonly [Side, Side],
    readonly rng: Rng,
    readonly registry: EffectRegistry,
  ) {}

  /** Invoque un serviteur à `position` (bornée) si le plateau a de la place ; renvoie-le. */
  summon(side: Side, position: number, m: SimMinionInput): Minion | undefined {
    if (side.board.filter((x) => !x.dead).length >= MAX_BOARD) return undefined;
    const minion = new Minion(m);
    const pos = Math.max(0, Math.min(position, side.board.length));
    side.board.splice(pos, 0, minion);
    if (pos < side.next) side.next++;
    return minion;
  }

  /** Inflige des dégâts (Bouclier divin, Venimeux de la source) ; renvoie vrai si touché. */
  damage(target: Minion, amount: number, source: Minion | undefined): boolean {
    if (amount <= 0 || target.dead) return false;
    if (target.divineShield) {
      target.divineShield = false;
      return false;
    }
    target.health -= amount;
    if (source?.venomous === true) {
      target.health = Math.min(target.health, 0);
      source.venomous = false; // [26.2] seul le premier serviteur endommagé est détruit
    }
    return true;
  }
}

function pickTarget(defender: Side, rng: Rng): Minion | undefined {
  const alive = defender.alive();
  if (alive.length === 0) return undefined;
  const visible = alive.filter((m) => !m.stealth);
  const pool = visible.length > 0 ? visible : alive;
  const taunts = pool.filter((m) => m.taunt);
  return rng.pick(taunts.length > 0 ? taunts : pool);
}

/** Prochain attaquant du camp (à partir du pointeur, en boucle), ou undefined s'il n'y en a pas. */
function nextAttacker(side: Side): Minion | undefined {
  const n = side.board.length;
  if (n === 0) return undefined;
  if (side.next >= n) side.next = 0;
  for (let k = 0; k < n; k++) {
    const i = (side.next + k) % n;
    const m = side.board[i];
    if (m !== undefined && !m.dead && m.attack > 0) {
      side.next = i;
      return m;
    }
  }
  return undefined;
}

/** Retire les morts, déclenche Râles d'agonie et Réincarnations ; recommence tant qu'il y en a. */
function resolveDeaths(ctx: CombatContext, attackerSide: Side): void {
  for (let guard = 0; guard < 50; guard++) {
    const order = [attackerSide, ctx.sides[1 - attackerSide.index] as Side];
    let any = false;
    for (const side of order) {
      for (let i = 0; i < side.board.length; i++) {
        const m = side.board[i];
        if (m === undefined || m.dead || m.health > 0) continue;
        any = true;
        m.dead = true;
        const position = i;
        // Retrait immédiat pour que les invocations prennent sa place.
        side.board.splice(i, 1);
        if (i < side.next) side.next--;
        i--;
        ctx.registry.get(m.cardId)?.deathrattle?.(ctx, side, position, m);
        if (m.reborn) {
          // Revient comme la carte d'origine, avec 1 PV et sans Réincarnation.
          const b = m.base;
          ctx.summon(side, position, {
            cardId: m.cardId,
            attack: b?.attack ?? m.attack,
            health: 1,
            tier: m.tier,
            golden: m.golden,
            taunt: b?.taunt ?? m.taunt,
            divineShield: b?.divineShield ?? false,
            venomous: b?.venomous ?? false,
            windfury: b?.windfury ?? m.windfury,
            tribes: m.tribes,
            base: b,
          });
        }
      }
    }
    if (!any) return;
  }
}

function attackOnce(ctx: CombatContext, attackerSide: Side, attacker: Minion): void {
  const defender = ctx.sides[1 - attackerSide.index] as Side;
  const target = pickTarget(defender, ctx.rng);
  if (target === undefined) return;
  attacker.stealth = false;
  // Ralliement (« Chaque fois que ce serviteur attaque ») : avant les dégâts.
  ctx.registry.get(attacker.cardId)?.onAttack?.(ctx, attackerSide, attacker);
  const atk = attacker.attack;
  const def = target.attack;
  const targetPosition = defender.board.indexOf(target);
  const hit = ctx.damage(target, atk, attacker);
  ctx.damage(attacker, def, target);
  if (hit && target.health <= 0) {
    ctx.registry
      .get(attacker.cardId)
      ?.afterKill?.(ctx, attacker, defender, targetPosition, -target.health);
  }
  resolveDeaths(ctx, attackerSide);
}

function heroDamage(winner: Side, input: SimSideInput, cap: number | undefined): number {
  const raw = input.tavernTier + winner.alive().reduce((s, m) => s + m.tier, 0);
  return cap === undefined ? raw : Math.min(raw, cap);
}

/** Simule UN combat. `input` n'est jamais modifié. */
export function simulateCombat(input: SimInput, rng: Rng, registry: EffectRegistry): CombatOutcome {
  const a = new Side(0, input.a);
  const b = new Side(1, input.b);
  const ctx = new CombatContext([a, b], rng, registry);

  let turn: Side =
    a.board.length > b.board.length
      ? a
      : b.board.length > a.board.length
        ? b
        : rng.int(2) === 0
          ? a
          : b;
  let attacks = 0;

  while (attacks < MAX_ATTACKS) {
    if (a.alive().length === 0 || b.alive().length === 0) break;
    let attacker = nextAttacker(turn);
    if (attacker === undefined) {
      turn = ctx.sides[1 - turn.index] as Side;
      attacker = nextAttacker(turn);
      if (attacker === undefined) break; // plus aucun serviteur avec de l'attaque : égalité
    }
    const strikes = attacker.windfury ? 2 : 1;
    for (let s = 0; s < strikes && !attacker.dead; s++) {
      const defender = ctx.sides[1 - turn.index] as Side;
      if (defender.alive().length === 0) break;
      attackOnce(ctx, turn, attacker);
      attacks++;
    }
    // Pointeur : juste après l'attaquant s'il a survécu, à sa place sinon.
    const idx = turn.board.indexOf(attacker);
    if (idx >= 0) turn.next = idx + 1;
    turn = ctx.sides[1 - turn.index] as Side;
  }

  const aAlive = a.alive().length;
  const bAlive = b.alive().length;
  if (aAlive > 0 && bAlive === 0) {
    return { result: 'win', damage: heroDamage(a, input.a, input.damageCap), attacks };
  }
  if (bAlive > 0 && aAlive === 0) {
    return { result: 'loss', damage: heroDamage(b, input.b, input.damageCap), attacks };
  }
  return { result: 'tie', damage: 0, attacks };
}
