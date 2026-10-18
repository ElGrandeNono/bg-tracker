import type { Keyword } from '@bgt/core';
import type { HsWindowState } from '../shared/payload.js';

/** Textes de l'overlay (français). Regroupés ici pour l'i18n de M7. */

export const KEYWORD_LABELS: Record<Keyword, { short: string; long: string }> = {
  TAUNT: { short: 'P', long: 'Provocation' },
  DIVINE_SHIELD: { short: 'B', long: 'Bouclier divin' },
  REBORN: { short: 'R', long: 'Réincarnation' },
  VENOMOUS: { short: 'V', long: 'Venimeux' },
  WINDFURY: { short: 'F', long: 'Furie des vents' },
  DEATHRATTLE: { short: 'Ra', long: "Râle d'agonie" },
  STEALTH: { short: 'C', long: 'Camouflage' },
};

export const TRIBE_LABELS: Record<string, string> = {
  MURLOC: 'Murlocs',
  DRAGON: 'Dragons',
  ELEMENTALS: 'Élémentaires',
  MECH: 'Méca',
  DEMON: 'Démons',
  NAGA: 'Nagas',
  PIRATE: 'Pirates',
  UNDEAD: 'Morts-vivants',
  QUILLBOAR: 'Huranes',
  BEAST: 'Bêtes',
  ABERRATION: 'Aberrations',
};

/** Mots-clés HearthstoneJSON (`mechanics`) proposés comme filtre dans le navigateur. */
export const MECHANIC_LABELS: Record<string, string> = {
  TAUNT: 'Provocation',
  DIVINE_SHIELD: 'Bouclier divin',
  REBORN: 'Réincarnation',
  VENOMOUS: 'Venimeux',
  WINDFURY: 'Furie des vents',
  DEATHRATTLE: "Râle d'agonie",
  STEALTH: 'Camouflage',
  BATTLECRY: 'Cri de guerre',
  START_OF_COMBAT: 'Début du combat',
  AVENGE: 'Vengeance',
  MAGNETIC: 'Magnétisme',
  BACON_RALLY: 'Ralliement',
  END_OF_TURN_TRIGGER: 'Fin de tour',
  CHOOSE_ONE: 'Choix des armes',
  DISCOVER: 'Découverte',
};

export const HS_WINDOW_MESSAGES: Partial<Record<HsWindowState, string>> = {
  notFound: 'Hearthstone n’est pas lancé.',
  fullscreen:
    'Jeu en plein écran : si l’overlay n’apparaît pas, passez en « Fenêtré » ou « Plein écran fenêtré » (Options › Graphismes).',
};

export const PHASE_LABELS = {
  pending: 'En attente',
  heroSelection: 'Choix du héros',
  recruit: 'Recrutement',
  combat: 'Combat',
  over: 'Terminée',
} as const;
