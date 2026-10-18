# Simulateur de combat : couverture

`packages/sim` simule un combat Battlegrounds par Monte Carlo (10 000 combats par défaut, worker threads, résultat qui s'affine par tranches de 1 000). Mesure : **10 000 combats 7 contre 7 en ~100 ms** sur un seul thread (test `engine.test.ts`).

Le résultat est marqué **« approximatif »** dès qu'un serviteur des deux plateaux a un effet de combat que le registre ne sait pas simuler. Jamais de faux résultat présenté comme exact.

## Règles simulées

| Règle                                                                                                                              | Source                                                                                                                                | Test                             |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Commence le camp qui a le plus de serviteurs, sinon tirage au sort                                                                 | [wiki](https://hearthstone.wiki.gg/wiki/Battlegrounds)                                                                                | `engine.test.ts`                 |
| Attaques alternées, de gauche à droite ; les invocations participent                                                               | wiki                                                                                                                                  | registre (microbot)              |
| Cible aléatoire, Provocation d'abord                                                                                               | wiki                                                                                                                                  | Provocation                      |
| Serviteur à 0 d'attaque : passe son tour ; égalité si plus que des 0 d'attaque                                                     | wiki                                                                                                                                  | égalité                          |
| Égalité si aucun survivant                                                                                                         | wiki                                                                                                                                  | égalité                          |
| Dégâts : niveau de taverne du gagnant + niveaux de ses survivants (jeton = 1)                                                      | wiki                                                                                                                                  | dégâts                           |
| Plafond de dégâts : `BACON_COMBAT_DAMAGE_CAP` si `_ENABLED=1` (2, 5, 10, 15 dans F2)                                               | log                                                                                                                                   | plafond                          |
| Furie des vents : deux attaques                                                                                                    | wiki                                                                                                                                  | Furie des vents                  |
| Ralliement : « Chaque fois que ce serviteur attaque », avant les dégâts                                                            | [wiki Rally](https://hearthstone.wiki.gg/wiki/Rally), [notes 33.2](https://news.blizzard.com/en-us/article/24223019/33-2-patch-notes) | Gardien de la lueur, Crache-bile |
| « Début du combat » : déjà résolu dans un plateau figé à la première attaque (exact) ; approximatif sur ton plateau de recrutement | log (blocs TRIGGER avant le premier ATTACK)                                                                                           | statut                           |
| Venimeux : seul le premier serviteur endommagé est détruit                                                                         | [notes 26.2](https://news.blizzard.com/en-us/article/23935322/26-2-patch-notes)                                                       | Venimeux                         |
| Bouclier divin : absorbe un coup (Venimeux compris)                                                                                | règle Hearthstone, **non vérifiée sur log BG**                                                                                        | Bouclier divin                   |
| Réincarnation : revient comme la carte d'origine (attaque et mots-clés de base) avec 1 PV, à sa place, après les Râles d'agonie    | règle Hearthstone ; **retour du Bouclier divin constaté dans le log** (Gardien de bronze, combat 4 de F2)                             | Réincarnation                    |
| Camouflage : non ciblé tant qu'il reste une cible visible                                                                          | règle Hearthstone, **non vérifiée**                                                                                                   | Camouflage                       |
| Ordre des morts : camp attaquant d'abord, de gauche à droite                                                                       | **non vérifié**                                                                                                                       | —                                |
| 7 serviteurs maximum : une invocation sur plateau plein est perdue                                                                 | règle Hearthstone                                                                                                                     | —                                |

## Validation sur des combats réels

`acceptance.test.ts` simule les 14 combats de la partie complète du 18/10/2026 (plateaux figés à la première attaque, niveaux `TECH_LEVEL`, plafond du log) et les compare aux issues réelles, armure comprise. Avec les données de cartes (comme dans l'overlay), **13 combats sur 14 n'ont plus aucune carte non simulée** :

| Combat | Issue réelle     | Simulation (overlay, données de cartes)                             |
| ------ | ---------------- | ------------------------------------------------------------------- |
| 1, 2   | égalité          | égalité 100 %                                                       |
| 3      | défaite −4       | défaite 100 %, dégâts 4–5                                           |
| 4      | défaite −4       | victoire 38 %, égalité 36 %, **défaite 26 %** (exactement 4 dégâts) |
| 5      | défaite −9       | défaite 100 %, dégâts 4–9                                           |
| 6      | aucun dégât subi | victoire 100 %                                                      |
| 7      | défaite −10      | défaite 100 %, 10                                                   |
| 8      | défaite −12      | défaite 100 %, 11–15                                                |
| 9 à 13 | aucun dégât subi | défaite de 0 à 45 %                                                 |
| 12     | aucun dégât subi | victoire 100 %, **approximatif** (Redresseuse de torts cramoisie)   |
| 14     | mort             | défaite 67 %                                                        |

Le combat 4 a révélé une erreur corrigée : une Réincarnation copiait l'état courant au lieu de la carte d'origine (le Bouclier divin du Gardien de bronze n'était pas rendu). Avant correction, la défaite réelle n'y était jugée possible qu'à 4 %.

## Cartes du registre (`packages/sim/src/registry.ts`)

Les versions dorées utilisent la même entrée (l'overlay ramène un doré à sa version normale et transmet `golden`). Chaque entrée cite le texte HearthstoneJSON.

**Effets simulés**

| Carte                                   | Effet                                                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `BG29_611` Tireur de câble              | Râle d'agonie : invoque un microbot 1/1 (doré : 2/2)                                                                    |
| `BG29_888` Gardien de la lueur          | Ralliement : +2 ATQ (doré : +4)                                                                                         |
| `BG33_318` Crache-bile                  | Ralliement : Venimosité à un autre Murloc allié (doré : 2) — choix parmi ceux qui ne l'ont pas : non vérifié            |
| `BGS_126` Élémentaire du feu de brousse | après un kill, surplus de dégâts à un adversaire adjacent (au hasard) ; doré sans texte dans les données : approximatif |

**Début du combat** (exact sur un plateau figé, approximatif sur ton plateau de recrutement) : `BG32_330` Éclaireur véloce, `BG27_556` Fourrageur boueux, `BG34_142` Victime de la mode, `BG24_500` Veilleur d'ambre, `BG36_245` Arcaniste runique, `BG26_963` Synthé électrique.

**Sans effet en combat** (Râles d'agonie qui donnent des cartes ou agissent sur la taverne ; déclencheurs de recrutement, de main, de fin de tour ou d'après-combat ; auras déjà comptées) : `BG32_336`, `BG34_171`, `BG34_856`, `BG35_881`, `BG32_170`, `BG36_113`, `BG36_703`, `BG36_704`, `BG29_300`, `BG35_814`, `TB_Baconups_202`, `BGS_127`, `BG26_147`, `BG26_524`, `BG26_ICC_901`, `BG36_367`, `BG34_Giant_120`, `BG21_015`, `BGS_004`, `BG26_174`, `BG32_873`, `BG26_523`, `BG36_360t6`, `BG_LOE_077`, `BG29_813`, `BG34_Giant_314`, `BG36_242`, `BG33_924`.

Les cartes sans aucune mécanique de combat dans HearthstoneJSON (Activations, effets de vente…) sont simulées exactement par leurs seuls mots-clés.

## Non simulé (résultat « approximatif »)

Toute carte dont les `mechanics` HearthstoneJSON contiennent `DEATHRATTLE`, `InvisibleDeathrattle`, `START_OF_COMBAT`, `AVENGE`, `AURA`, `TRIGGER_VISUAL` ou `BACON_RALLY` et qui n'est pas dans le registre. `TRIGGER_VISUAL` couvre aussi des déclencheurs de recrutement : le marquage est volontairement prudent. Les effets de héros, de trinkets et de Divinités (C'Thun) en combat ne sont pas simulés.

Restent non simulés sur les plateaux des fixtures : Redresseuse de torts cramoisie (Ralliement : Souffle de dragon puissant), Campeuse à défenses (gemme de sang : valeur dépendante de compteurs non observés), Chevalier éternel (aura qui grandit avec les morts de chevaliers).

## Ajouter une carte

1. Lire son texte exact dans HearthstoneJSON (version normale et dorée) et le citer dans `note`.
2. Ajouter l'entrée dans `ENTRIES` (`deathrattle`, ou `noCombatEffect: true` si l'effet n'agit pas pendant le combat).
3. Écrire un test déterministe dans `engine.test.ts` (issue certaine quel que soit le tirage).
4. Mettre à jour le tableau ci-dessus.
