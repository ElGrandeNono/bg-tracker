# Ajouter une saison

Battlegrounds change de saison tous les 3 à 4 mois (nouveaux mots-clés, rotation de tribus, mécaniques comme les trinkets ou les Dark Gifts). Rien de saisonnier ne doit être codé dans `packages/core` : le cœur ne connaît que des mécanismes génériques, paramétrés par un module `seasons/sNN`.

## Ce qu'un module de saison fournit aujourd'hui

### Mécaniques : `SeasonModule`

`seasons/s14/src/tracker.ts` exporte `S14_SEASON`, un `SeasonModule` (contrat dans `packages/core/src/season/module.ts`) :

- `initial` / `reduce(state, event, prev, next, bg)` : état propre à la saison (ex. Dark Gifts proposés et pris, Activations), mis à jour à chaque événement Power. Le pipeline le retient avec le reste par l'horloge d'affichage.
- `view(state, bg, game)` : vue de saison, UNIQUEMENT ce que le joueur local voit, avec `shownCardIds` (toutes les cartes citées).
- Test obligatoire (`tracker.test.ts`) : faits mesurés sur des fixtures réelles, et fair-play (oracle indépendant : chaque carte de `shownCardIds` doit avoir été montrée).

L'overlay l'utilise via `apps/overlay/src/main/season.ts` (`currentSeason`, `overlayView`) ; le panneau de saison est dans `apps/overlay/src/renderer/App.tsx` (`SeasonPanel`).

### Règles du pool : `PoolRules`

`seasons/s14/src/poolRules.ts` exporte un `PoolRules` (type défini dans `packages/core/src/pool/pool.ts`) :

| Champ                            | Rôle                                                        | Saison 14                                                           |
| -------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| `copiesPerTier`                  | exemplaires de chaque serviteur par niveau, avec `verified` | 15 (non confirmé : 15 ou 16 selon les sources), 15, 13, 11, 9, 7, 5 |
| `shopSlotsPerTier`               | cartes proposées par actualisation                          | 3, 4, 4, 5, 5, 6 (vérifié sur les logs, test `poolRules.test.ts`)   |
| `tribesPerLobby`                 | tribus tirées par partie                                    | 5                                                                   |
| `excludedTribes`                 | tribus hors rotation                                        | `NAGA`                                                              |
| `copiesPerGolden`                | exemplaires représentés par un doré                         | 3                                                                   |
| `eliminatedPlayersReturnMinions` | les plateaux des éliminés retournent au pool                | oui (non confirmé officiellement)                                   |

Chaque valeur cite sa source en commentaire. Une valeur dont les sources divergent porte `verified: false` : l'UI l'affiche comme incertaine.

## Procédure

1. **Vérifier** les notes de patch et le wiki ([hearthstone.wiki.gg/wiki/Battlegrounds](https://hearthstone.wiki.gg/wiki/Battlegrounds)) ; ne rien deviner. Demander à l'utilisateur un `Power.log` réel de la nouvelle saison.
2. Copier `seasons/s14` en `seasons/s15`, renommer le paquet (`@bgt/season-s15`), ajouter la référence dans `tsconfig.json` à la racine.
3. Mettre à jour `poolRules.ts` (sources datées) et `poolRules.test.ts` sur une fixture de la nouvelle saison.
4. Nouveaux tags (`BACON_*`) : les relever dans le log réel et les documenter dans `docs/log-format.md` avant d'écrire la moindre logique. Un tag inconnu reste toujours accepté tel quel par le parseur.
5. Nouvelle tribu : vérifier ses deux orthographes (`CARDRACE` et `BACON_SUBSET_`) dans le log et compléter `canonicalTribe` (`packages/core/src/bg/tribes.ts`) si elles diffèrent ; ajouter son libellé dans `apps/overlay/src/renderer/strings.ts`.
6. Écrire `tracker.ts` (mécaniques) et son test sur une fixture de la saison ; adapter `SeasonPanel` si la vue change de forme.
7. Brancher le module dans `apps/overlay/src/main/season.ts`. Le choix automatique de la saison selon le build est prévu pour M4.

## Ce qui n'est PAS saisonnier

- Le format du log, le parseur, l'horloge d'affichage, le filtre fair-play.
- Le catalogue du pool (`packages/data/src/poolCatalog.ts`) : il vient de HearthstoneJSON pour le build exact du jeu. Attention : `isBattlegroundsPoolMinion` ne suit pas les rotations (les Nagas y sont encore marqués en 37.0) ; d'où `excludedTribes`.
