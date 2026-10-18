# Simulateur de combat : couverture

`packages/sim` simule un combat Battlegrounds par Monte Carlo (10 000 combats par défaut, worker threads, résultat qui s'affine par tranches de 1 000). Mesure : **10 000 combats 7 contre 7 en ~100 ms** sur un seul thread (test `engine.test.ts`).

Le résultat est marqué **« approximatif »** dès qu'un serviteur des deux plateaux a un effet de combat que le registre ne sait pas simuler. Jamais de faux résultat présenté comme exact.

## Règles simulées

| Règle                                                                                | Source                                                                          | Test                |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------- |
| Commence le camp qui a le plus de serviteurs, sinon tirage au sort                   | [wiki](https://hearthstone.wiki.gg/wiki/Battlegrounds)                          | `engine.test.ts`    |
| Attaques alternées, de gauche à droite ; les invocations participent                 | wiki                                                                            | registre (microbot) |
| Cible aléatoire, Provocation d'abord                                                 | wiki                                                                            | Provocation         |
| Serviteur à 0 d'attaque : passe son tour ; égalité si plus que des 0 d'attaque       | wiki                                                                            | égalité             |
| Égalité si aucun survivant                                                           | wiki                                                                            | égalité             |
| Dégâts : niveau de taverne du gagnant + niveaux de ses survivants (jeton = 1)        | wiki                                                                            | dégâts              |
| Plafond de dégâts : `BACON_COMBAT_DAMAGE_CAP` si `_ENABLED=1` (2, 5, 10, 15 dans F2) | log                                                                             | plafond             |
| Furie des vents : deux attaques                                                      | wiki                                                                            | Furie des vents     |
| Venimeux : seul le premier serviteur endommagé est détruit                           | [notes 26.2](https://news.blizzard.com/en-us/article/23935322/26-2-patch-notes) | Venimeux            |
| Bouclier divin : absorbe un coup (Venimeux compris)                                  | règle Hearthstone, **non vérifiée sur log BG**                                  | Bouclier divin      |
| Réincarnation : revient avec 1 PV à sa place, après les Râles d'agonie               | règle Hearthstone, **non vérifiée**                                             | Réincarnation       |
| Camouflage : non ciblé tant qu'il reste une cible visible                            | règle Hearthstone, **non vérifiée**                                             | Camouflage          |
| Ordre des morts : camp attaquant d'abord, de gauche à droite                         | **non vérifié**                                                                 | —                   |
| 7 serviteurs maximum : une invocation sur plateau plein est perdue                   | règle Hearthstone                                                               | —                   |

## Validation sur des combats réels

`acceptance.test.ts` simule les 14 combats de la partie complète du 18/10/2026 (plateaux figés à la première attaque, niveaux `TECH_LEVEL`, plafond du log) et les compare aux issues réelles, armure comprise :

| Combat | Issue réelle     | Simulation                                             |
| ------ | ---------------- | ------------------------------------------------------ |
| 1, 2   | égalité          | égalité 100 %                                          |
| 3      | défaite −4       | défaite 100 %, dégâts 4–5                              |
| 4      | défaite −4       | **victoire 59 %, défaite 4 %** (3 cartes non simulées) |
| 5      | défaite −9       | défaite 100 %, dégâts dans la fourchette               |
| 6      | aucun dégât subi | victoire 100 %                                         |
| 7      | défaite −10      | défaite 100 %, 10                                      |
| 8      | défaite −12      | défaite 100 %, 11–15                                   |
| 9 à 13 | aucun dégât subi | défaite de 0 à 31 %                                    |
| 14     | mort             | défaite 83 %                                           |

Le combat 4 est le seul écart : ses effets non simulés suffisent à inverser l'issue. Il illustre pourquoi l'UI affiche « approximatif ».

## Cartes du registre (`packages/sim/src/registry.ts`)

| Carte                                   | Effet                                                | Traitement           |
| --------------------------------------- | ---------------------------------------------------- | -------------------- |
| `BG29_611` Tireur de câble              | Râle d'agonie : invoque un microbot 1/1 (doré : 2/2) | simulé               |
| `BG32_336` Gourmet gormelin             | Râle d'agonie : obtenez un ragoût de la mer          | sans effet en combat |
| `BG34_171` Assemblage porteur           | Râle d'agonie : obtenez un volumateur                | sans effet en combat |
| `BG34_856` Être aqueux                  | Râle d'agonie : buff d'un serviteur de la taverne    | sans effet en combat |
| `BG35_881` Raboteur de ligne tellurique | Râle d'agonie : obtenez une absorption des arcanes   | sans effet en combat |
| `BG32_170` Chasseur métallique          | Râle d'agonie : obtenez une flèche aiguisée          | sans effet en combat |

Les versions dorées pointent vers la même entrée.

## Non simulé (résultat « approximatif »)

Toute carte dont les `mechanics` HearthstoneJSON contiennent `DEATHRATTLE`, `InvisibleDeathrattle`, `START_OF_COMBAT`, `AVENGE`, `AURA`, `TRIGGER_VISUAL` ou `BACON_RALLY` et qui n'est pas dans le registre. `TRIGGER_VISUAL` couvre aussi des déclencheurs de recrutement : le marquage est volontairement prudent. Les effets de héros, de trinkets et de Divinités (C'Thun) en combat ne sont pas simulés.

Sur les vrais plateaux des fixtures : 71 cartes distinctes, dont 30 sans effet de combat (simulées exactement par les mots-clés) et 41 avec un effet possible.

## Ajouter une carte

1. Lire son texte exact dans HearthstoneJSON (version normale et dorée) et le citer dans `note`.
2. Ajouter l'entrée dans `ENTRIES` (`deathrattle`, ou `noCombatEffect: true` si l'effet n'agit pas pendant le combat).
3. Écrire un test déterministe dans `engine.test.ts` (issue certaine quel que soit le tirage).
4. Mettre à jour le tableau ci-dessus.
