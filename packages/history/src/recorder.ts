import type { VisibleView } from '@bgt/core';
import type { GameRecord, ReplayRound } from './types.js';

/**
 * Construit un `GameRecord` à partir des vues filtrées successives d'une partie (celles que
 * l'overlay affiche). Un instantané est pris pour chaque combat dès que ses plateaux sont figés ;
 * l'enregistrement est livré une seule fois, quand l'issue de la partie devient définitive.
 *
 * `sessionDate` : date du dossier de session du jeu (`Logs/Hearthstone_AAAA_MM_JJ_…`) ; avec
 * l'heure de début lue dans le log, elle donne `startedAt`. Absente → date du jour.
 */
export class GameRecorder {
  private gameIndex = -1;
  private rounds = new Map<number, ReplayRound>();
  private lastView: VisibleView | undefined;
  private delivered = false;
  private firstSeenAt: Date | undefined;

  constructor(
    private readonly heroBase: (cardId: string) => string = (id) => id,
    private sessionDate: Date | undefined = undefined,
  ) {}

  setSessionDate(d: Date | undefined): void {
    this.sessionDate = d;
  }

  /**
   * Observe une vue ; renvoie un enregistrement quand une partie se termine (une seule fois), ou
   * quand une nouvelle partie commence alors que la précédente n'a pas été livrée.
   */
  observe(view: VisibleView, now: Date = new Date()): GameRecord | undefined {
    let out: GameRecord | undefined;
    if (view.gameIndex !== this.gameIndex) {
      if (!this.delivered && this.lastView !== undefined) out = this.build(this.lastView, true);
      this.gameIndex = view.gameIndex;
      this.rounds = new Map();
      this.delivered = false;
      this.firstSeenAt = now;
    }
    this.lastView = view;
    if (!view.isBattlegrounds) return out;

    const cc = view.currentCombat;
    if (cc !== undefined && !this.rounds.has(cc.round)) {
      const local = view.players.find((p) => p.isLocal);
      const opp = view.players.find((p) => p.playerId === cc.opponentPlayerId);
      const places: Record<number, number> = {};
      for (const p of view.players) if (p.place !== undefined) places[p.playerId] = p.place;
      this.rounds.set(cc.round, {
        round: cc.round,
        techLevel: view.local.techLevel,
        health: local?.health,
        armor: local?.armor,
        triples: view.local.triples,
        gold: view.local.maxGold,
        localBoard: cc.localBoard,
        opponent:
          opp === undefined
            ? undefined
            : {
                playerId: opp.playerId,
                heroCardId: opp.heroCardId,
                name: opp.name,
                board: cc.opponentBoard,
              },
        places,
      });
    }

    if (!this.delivered && view.outcome !== 'inProgress') {
      this.delivered = true;
      return this.build(view, false);
    }
    return out;
  }

  /** Fin du flux : livre la partie en cours si elle ne l'a pas été. */
  flush(): GameRecord | undefined {
    if (this.delivered || this.lastView === undefined || !this.lastView.isBattlegrounds)
      return undefined;
    this.delivered = true;
    return this.build(this.lastView, true);
  }

  private startedAt(view: VisibleView): string | undefined {
    const base = this.sessionDate ?? this.firstSeenAt;
    if (base === undefined) return undefined;
    if (view.gameStartMs === undefined) return base.toISOString();
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    let t = d.getTime() + view.gameStartMs;
    // Session commencée avant minuit, partie après : l'heure du log est plus petite.
    if (this.sessionDate !== undefined && t < this.sessionDate.getTime()) t += 24 * 3600_000;
    return new Date(t).toISOString();
  }

  private build(view: VisibleView, replaced: boolean): GameRecord | undefined {
    if (!view.isBattlegrounds) return undefined;
    const local = view.players.find((p) => p.isLocal);
    const heroCardId = local?.heroCardId ?? view.local.heroCardId ?? '';
    if (heroCardId === '') return undefined;
    const startedAt = this.startedAt(view);
    // Une partie remplacée sans fin observée est au mieux « interrompue ».
    const outcome = replaced && view.outcome === 'inProgress' ? 'interrupted' : view.outcome;
    const finalPlace = outcome === 'finished' ? view.finalPlace : undefined;
    return {
      key: `${view.build ?? '?'}|${startedAt ?? '?'}|${heroCardId}`,
      startedAt,
      build: view.build,
      mode: view.mode,
      heroCardId,
      heroBaseCardId: this.heroBase(heroCardId),
      outcome,
      finalPlace,
      tribes: view.tribes.identified,
      rounds: view.round,
      durationMs: durationOf(view),
      truncated: view.warnings.includes('truncated'),
      mmr: undefined,
      notes: '',
      tags: [],
      replay: [...this.rounds.values()].sort((a, b) => a.round - b.round),
    };
  }
}

/** Durée début → dernière entrée de chronologie, minuit compris. */
function durationOf(view: VisibleView): number | undefined {
  if (view.gameStartMs === undefined || view.lastTimelineMs === undefined) return undefined;
  const d = view.lastTimelineMs - view.gameStartMs;
  return d < 0 ? d + 24 * 3600_000 : d;
}
