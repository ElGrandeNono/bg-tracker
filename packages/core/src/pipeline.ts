import { initialBgGame, markInterrupted, reduceBgGame, type BgGame } from './bg/bgGame.js';
import { PowerParser } from './power/parser.js';
import type { PowerEvent } from './power/types.js';
import { initialGameState, reduceGameState, type GameState } from './state/gameState.js';

/**
 * Chaîne Parser → GameState → BgGame, alimentée ligne par ligne. Le même objet sert pour le
 * suivi en direct (LogWatcher) et pour le mode replay.
 */
export class Pipeline {
  readonly parser = new PowerParser();
  private _state: GameState = initialGameState;
  private _bg: BgGame = initialBgGame;
  private _history: readonly BgGame[] = [];
  private readonly listeners = new Set<(bg: BgGame, event: PowerEvent) => void>();

  get state(): GameState {
    return this._state;
  }

  get bg(): BgGame {
    return this._bg;
  }

  /** Parties BG précédentes de ce flux, closes (terminées ou interrompues). */
  get history(): readonly BgGame[] {
    return this._history;
  }

  /** Abonnement aux mises à jour du modèle BG ; renvoie la fonction de désabonnement. */
  subscribe(listener: (bg: BgGame, event: PowerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  feedLine(text: string): void {
    for (const event of this.parser.feed(text)) this.apply(event);
  }

  /**
   * Fin du flux : fichier rejoué jusqu'au bout, ou (suivi en direct) session de jeu remplacée
   * par une nouvelle (`LogWatcher` → `fileChanged`). Une partie en cours devient « interrompue ».
   */
  end(): void {
    for (const event of this.parser.flush()) this.apply(event);
  }

  private apply(event: PowerEvent): void {
    const prev = this._state;
    const next = reduceGameState(prev, event);
    if (next.gameIndex !== prev.gameIndex && this._bg.isBattlegrounds) {
      // Nouvelle partie : la précédente est archivée ; sans événement de fin, elle est
      // « abandonnée ou interrompue ».
      this._history = [...this._history, markInterrupted(this._bg, event.at.timeMs)];
    }
    const bg = reduceBgGame(this._bg, event, prev, next);
    this._state = next;
    const changed = bg !== this._bg;
    this._bg = bg;
    if (changed) for (const l of this.listeners) l(bg, event);
  }
}
