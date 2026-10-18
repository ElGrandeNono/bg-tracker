import { buildVisibleView, type Snapshot, type VisibleView } from '@bgt/core';
import { S14_POOL_RULES, S14_SEASON, type S14State, type S14View } from '@bgt/season-s14';

/**
 * Saison en cours. Un seul module pour l'instant ; le choix selon le build du jeu viendra avec la
 * saison 15 (voir docs/adding-a-season.md).
 */
export const currentSeason = S14_SEASON;
export const currentPoolRules = S14_POOL_RULES;

export type OverlayView = VisibleView<S14View>;

/** Vue filtrée complète (cœur + saison) d'un instantané déjà affiché par le client. */
export function overlayView(snap: Snapshot): OverlayView {
  const season = currentSeason.view(snap.season as S14State, snap.bg, snap.state);
  return buildVisibleView(snap.bg, snap.state, season);
}
