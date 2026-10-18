import { initialBgGame, markInterrupted, reduceBgGame, type BgGame } from './bg/bgGame.js';
import { PowerParser } from './power/parser.js';
import type { PowerEvent } from './power/types.js';
import { initialGameState, reduceGameState, type GameState } from './state/gameState.js';

/** Couple état brut / modèle BG à un instant donné (immuables, donc partageables). */
export interface Snapshot {
  readonly state: GameState;
  readonly bg: BgGame;
}

/** Diagnostic de l'alignement GameState ↔ affichage du client. */
export interface DisplayClockStatus {
  /** Repères GameState pas encore affichés par le client. */
  readonly behind: number;
  /** Repères d'affichage qui n'ont pas pu être alignés. */
  readonly mismatches: number;
  /** Faux si l'horloge a été désactivée (alignement perdu) : l'UI suit alors GameState. */
  readonly active: boolean;
}

/** Fenêtre de recherche pour réaligner un repère d'affichage sur les repères GameState. */
const ALIGN_WINDOW = 8;
/** Au-delà, l'alignement est jugé perdu et l'horloge désactivée pour la partie. */
const MAX_MISMATCHES = 5;
/**
 * Sécurité : un instantané plus vieux que ceci (temps du log) est libéré même sans repère
 * d'affichage. Les combats observés durent au plus ~50 s d'animation (docs/log-format.md).
 */
const MAX_HOLD_MS = 120_000;

/**
 * Chaîne Parser → GameState → BgGame, alimentée ligne par ligne. Le même objet sert pour le
 * suivi en direct (LogWatcher) et pour le mode replay.
 *
 * Deux vues du temps :
 * - `state` / `bg` : ce que sait GameState, le plus tôt possible (chronologie, historique) ;
 * - `displayed` : ce que le CLIENT a déjà affiché. GameState connaît l'issue d'un combat jusqu'à
 *   ~48 s avant son animation ; l'UI ne doit donc lire que `displayed`. On prend un instantané
 *   juste avant chaque repère GameState (power/markers.ts) et on ne le libère que lorsque
 *   PowerTaskList affiche le même repère.
 */
export class Pipeline {
  readonly parser = new PowerParser();
  private _state: GameState = initialGameState;
  private _bg: BgGame = initialBgGame;
  private _history: readonly BgGame[] = [];
  private readonly listeners = new Set<(bg: BgGame, event: PowerEvent) => void>();

  /** Instantanés pris avant chaque repère GameState pas encore affiché. */
  private held: { key: string; timeMs: number; snap: Snapshot }[] = [];
  private mismatches = 0;
  private clockActive = true;

  get state(): GameState {
    return this._state;
  }

  get bg(): BgGame {
    return this._bg;
  }

  /** État tel que le client l'a déjà affiché : SEULE source autorisée pour l'UI. */
  get displayed(): Snapshot {
    return this.held[0]?.snap ?? { state: this._state, bg: this._bg };
  }

  get displayClock(): DisplayClockStatus {
    return { behind: this.held.length, mismatches: this.mismatches, active: this.clockActive };
  }

  /** Parties BG précédentes de ce flux, closes (terminées, interrompues ou abandonnées). */
  get history(): readonly BgGame[] {
    return this._history;
  }

  /**
   * Abonnement : appelé quand le modèle BG change OU quand l'affichage du client avance.
   * Renvoie la fonction de désabonnement.
   */
  subscribe(listener: (bg: BgGame, event: PowerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  feedLine(text: string): void {
    for (const event of this.parser.feed(text)) this.apply(event);
  }

  /**
   * Fin du flux : fichier rejoué jusqu'au bout, ou (suivi en direct) session de jeu remplacée
   * par une nouvelle (`LogWatcher` → `fileChanged`). Une partie en cours devient « interrompue »
   * ou « abandonnée » ; tout ce qui était retenu est libéré.
   */
  end(): void {
    for (const event of this.parser.flush()) this.apply(event);
  }

  private notify(event: PowerEvent): void {
    for (const l of this.listeners) l(this._bg, event);
  }

  private apply(event: PowerEvent): void {
    if (event.type === 'stateMarker') {
      if (this.clockActive) {
        this.held.push({
          key: event.key,
          timeMs: event.at.timeMs,
          snap: { state: this._state, bg: this._bg },
        });
      }
      return;
    }
    if (event.type === 'displayMarker') {
      if (this.onDisplayed(event.key, event.at.timeMs)) this.notify(event);
      return;
    }

    const prev = this._state;
    const next = reduceGameState(prev, event);
    if (next.gameIndex !== prev.gameIndex) {
      if (this._bg.isBattlegrounds) {
        // Nouvelle partie : la précédente est archivée ; sans événement de fin, elle est
        // « interrompue » ou « abandonnée ».
        this._history = [...this._history, markInterrupted(this._bg, event.at.timeMs)];
      }
      this.resetClock();
    }
    const bg = reduceBgGame(this._bg, event, prev, next);
    this._state = next;
    const changed = bg !== this._bg;
    this._bg = bg;
    if (event.type === 'endOfStream') {
      // Plus rien ne viendra : l'affichage ne rattrapera jamais, on libère tout.
      this.held = [];
      this.notify(event);
      return;
    }
    if (this.releaseStale(event.at.timeMs) || changed) this.notify(event);
  }

  /** Aligne un repère affiché par le client ; renvoie vrai si l'état affiché a changé. */
  private onDisplayed(key: string, timeMs: number): boolean {
    if (!this.clockActive) return false;
    const limit = Math.min(this.held.length, ALIGN_WINDOW);
    for (let i = 0; i < limit; i++) {
      if (this.held[i]?.key === key) {
        this.held.splice(0, i + 1);
        return true;
      }
    }
    // Repère d'une partie précédente (client en retard sur un CREATE_GAME), ou alignement perdu.
    if (this.held.length > 0 && ++this.mismatches > MAX_MISMATCHES) {
      this.clockActive = false;
      this.held = [];
      return true;
    }
    return this.releaseStale(timeMs);
  }

  private releaseStale(nowMs: number): boolean {
    let n = 0;
    while (n < this.held.length && elapsed(this.held[n]?.timeMs ?? nowMs, nowMs) > MAX_HOLD_MS) n++;
    if (n === 0) return false;
    this.held.splice(0, n);
    return true;
  }

  private resetClock(): void {
    this.held = [];
    this.mismatches = 0;
    this.clockActive = true;
  }
}

/** Écart en ms entre deux heures du log (sans date), minuit compris. */
function elapsed(fromMs: number, toMs: number): number {
  const d = toMs - fromMs;
  return d < -12 * 3600_000 ? d + 24 * 3600_000 : d;
}
