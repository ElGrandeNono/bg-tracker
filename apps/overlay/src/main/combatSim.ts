import type { VisibleMinion } from '@bgt/core';
import type { CardDb } from '@bgt/data';
import { effectStatus, type SimInput, type SimMinionInput } from '@bgt/sim';
import type { OverlayView } from './season.js';

/**
 * Entrée du simulateur à partir de la vue FILTRÉE (plateaux affichés à l'écran uniquement) :
 * - en combat : les deux plateaux figés au début du combat ;
 * - en recrutement : ton plateau actuel contre le dernier plateau vu du prochain adversaire
 *   (il a pu changer depuis : résultat indicatif).
 */

export interface SimRequest {
  readonly input: SimInput;
  readonly context: 'combat' | 'nextOpponent';
  readonly opponentPlayerId: number;
  /** Tour où le plateau adverse a été vu. */
  readonly boardRound: number;
}

function toSim(m: VisibleMinion, db: CardDb | undefined): SimMinionInput {
  const card = db?.normalVersion(m.cardId) ?? db?.byId(m.cardId);
  const status = effectStatus(m.cardId, db?.byId(m.cardId)?.mechanics ?? card?.mechanics);
  return {
    cardId: m.cardId,
    attack: m.attack ?? 0,
    health: m.health ?? 1,
    tier: card?.techLevel ?? 1,
    golden: m.golden,
    taunt: m.keywords.includes('TAUNT'),
    divineShield: m.keywords.includes('DIVINE_SHIELD'),
    reborn: m.keywords.includes('REBORN'),
    venomous: m.keywords.includes('VENOMOUS'),
    windfury: m.keywords.includes('WINDFURY'),
    stealth: m.keywords.includes('STEALTH'),
    unsupportedEffect: status === 'unsupported',
  };
}

export function buildSimRequest(view: OverlayView, db: CardDb | undefined): SimRequest | undefined {
  if (!view.isBattlegrounds || view.mode !== 'solo' || view.outcome !== 'inProgress')
    return undefined;
  const local = view.players.find((p) => p.isLocal);
  const hp = (
    p: { health: number | undefined; armor: number | undefined } | undefined,
  ): number | undefined => (p?.health === undefined ? undefined : p.health + (p.armor ?? 0));

  const cc = view.currentCombat;
  const opponent =
    cc !== undefined
      ? view.players.find((p) => p.playerId === cc.opponentPlayerId)
      : view.players.find((p) => p.isNextOpponent);
  if (opponent === undefined) return undefined;
  const localMinions = cc?.localBoard ?? view.localBoard;
  const oppMinions = cc?.opponentBoard ?? opponent.lastBoard?.minions;
  if (oppMinions === undefined || localMinions.length === 0 || oppMinions.length === 0)
    return undefined;

  return {
    context: cc !== undefined ? 'combat' : 'nextOpponent',
    opponentPlayerId: opponent.playerId,
    boardRound: cc?.round ?? opponent.lastBoard?.round ?? view.round,
    input: {
      a: {
        minions: localMinions.map((m) => toSim(m, db)),
        tavernTier: view.local.techLevel ?? 1,
        heroHealth: hp(local),
      },
      b: {
        minions: oppMinions.map((m) => toSim(m, db)),
        tavernTier: opponent.techLevel ?? 1,
        heroHealth: hp(opponent),
      },
      ...(view.damageCap === undefined ? {} : { damageCap: view.damageCap }),
    },
  };
}
