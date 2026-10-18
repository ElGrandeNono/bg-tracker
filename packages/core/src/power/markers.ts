/**
 * Repères d'affichage communs à `GameState` et `PowerTaskList`.
 *
 * `GameState` reçoit un combat entier en moins d'une seconde ; le client l'anime ensuite pendant
 * 8 à 48 s, au rythme de `PowerTaskList` (mesuré sur les fixtures, voir docs/log-format.md).
 * Pour ne jamais montrer ce que le joueur ne voit pas encore, on aligne les deux flux sur des
 * repères présents dans les deux, dans le même ordre : blocs `ATTACK` et `DEATHS`, `TURN` et
 * `BACON_IN_COMBAT_PHASE` sur GameEntity, `STATE=COMPLETE`, `PLAYSTATE` terminal.
 * Vérifié : séquences identiques dans les 4 fixtures (302, 83, 39 repères ; dans la partie
 * abandonnée, `PowerTaskList` s'arrête 2 repères avant). Exclus car ordonnés ou nommés
 * différemment d'un flux à l'autre : `STATE=RUNNING` (`Entity=4` contre `Entity=GameEntity`),
 * `PLAYSTATE=PLAYING|LOSING`.
 *
 * `PowerTaskList` ne sert QUE d'horloge : aucune de ses données n'entre dans l'état.
 */

const BLOCK = /^BLOCK_START BlockType=(ATTACK|DEATHS) /;
const GAME_TAG = /^TAG_CHANGE Entity=GameEntity tag=(TURN|BACON_IN_COMBAT_PHASE) value=(\S+)/;
const COMPLETE = /^TAG_CHANGE Entity=\S+ tag=STATE value=COMPLETE\b/;
const PLAYSTATE_END = /^TAG_CHANGE Entity=.+ tag=PLAYSTATE value=(LOST|WON|CONCEDED|TIED)\b/;

/** Clé du repère porté par une commande Power (corps de ligne sans indentation), sinon `undefined`. */
export function displayMarkerOf(body: string): string | undefined {
  let m: RegExpExecArray | null;
  if ((m = BLOCK.exec(body))) return m[1];
  if ((m = GAME_TAG.exec(body))) return `${m[1] ?? ''}=${m[2] ?? ''}`;
  if (COMPLETE.test(body)) return 'STATE=COMPLETE';
  if ((m = PLAYSTATE_END.exec(body))) return `PLAYSTATE=${m[1] ?? ''}`;
  return undefined;
}
