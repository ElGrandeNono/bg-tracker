import type { VisibleView } from '@bgt/core';

/** Contrat IPC entre le processus principal et le renderer de l'overlay. */

export const CHANNELS = {
  update: 'bgt:update',
  ready: 'bgt:ready',
  saveLayout: 'bgt:save-layout',
  rendered: 'bgt:rendered',
} as const;

export type HsWindowState = 'notFound' | 'ok' | 'minimized' | 'background' | 'fullscreen';

export interface OverlayStatus {
  readonly source: 'live' | 'replay';
  /** Problèmes détectés dans log.config / client.config (vide si tout va bien). */
  readonly configProblems: readonly string[];
  readonly hsWindow: HsWindowState;
  readonly cardData: 'loading' | 'ok' | 'stale' | 'error';
  readonly replayDone: boolean;
}

export interface PanelPosition {
  /** Position en fraction de la fenêtre (0-1), pour suivre les redimensionnements du jeu. */
  readonly x: number;
  readonly y: number;
}

export interface OverlaySettings {
  readonly opacity: number;
  readonly compact: boolean;
  readonly theme: 'dark' | 'light';
  /** Verrouillé = click-through ; déverrouillé = panneaux déplaçables. */
  readonly locked: boolean;
  readonly hidden: boolean;
  readonly scale: number;
  readonly panels: Readonly<Record<'bar' | 'lobby', PanelPosition>>;
  /** Fond sombre de démonstration (captures, mode autonome) : jamais en jeu. */
  readonly backdrop: boolean;
}

export const DEFAULT_SETTINGS: OverlaySettings = {
  opacity: 0.92,
  compact: false,
  theme: 'dark',
  locked: true,
  hidden: false,
  scale: 1,
  panels: { bar: { x: 0.36, y: 0.012 }, lobby: { x: 0.8, y: 0.16 } },
  backdrop: false,
};

export interface OverlayPayload {
  readonly view: VisibleView;
  /** Noms localisés des cartes présentes dans la vue (cardId → nom). */
  readonly names: Readonly<Record<string, string>>;
  readonly status: OverlayStatus;
  readonly settings: OverlaySettings;
  /** Fin estimée du recrutement en cours (horloge locale, ms) ; absent si inconnue. */
  readonly timerEndsAt: number | undefined;
}

/** API exposée au renderer par le preload (`window.bgt`). */
export interface BgtBridge {
  onUpdate(listener: (payload: OverlayPayload) => void): () => void;
  ready(): void;
  saveLayout(panels: OverlaySettings['panels']): void;
  rendered(): void;
}
