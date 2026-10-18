# Format de `Power.log` (Battlegrounds)

Ce document consigne ce que le parseur sait du format, **et d'où il le sait**. Sauf mention contraire, chaque point a été observé dans les deux fixtures réelles anonymisées (`fixtures/README.md`) :

- **F1** : `bg-solo-2026-09-21-tronque` (build 251952, solo, tronqué au tour 13) ;
- **F2** : `bg-solo-2026-10-18-complete` (build 254477 = patch 37.0, solo, partie complète de 27 min) ;
- **F3** : `bg-solo-2026-10-18-abandon` (build 254477, solo, abandon volontaire au tour 3) ;
- **F4** : `bg-solo-2026-10-18-aberrations` (build 254477, solo, abandon au tour 5, tribu Aberration).

Références de format : dépôt [Hearthstone-Deck-Tracker](https://github.com/HearthSim/Hearthstone-Deck-Tracker) et bibliothèque [python-hslog](https://github.com/HearthSim/python-hslog) (HearthSim, licence MIT), utilisées comme documentation. Aucun code n'en est repris.

Ce qui n'est **pas** dans les fixtures (Duos, quêtes, anomalies, reconnexion, victoire en 1re place, abandon) n'est pas implémenté : voir « Inconnues » en bas de page.

## Lignes

```
D 06:11:54.5321202 GameState.DebugPrintPower() -     TAG_CHANGE Entity=4 tag=STATE value=RUNNING
```

- UTF-8, fins de ligne CRLF. Des noms non ASCII (cyrillique) apparaissent.
- Niveau (`D`, `W`), heure locale `hh:mm:ss.fffffff` **sans date** : la date se lit dans le nom du dossier `Logs/Hearthstone_AAAA_MM_JJ_hh_mm_ss/` (`sessionDate()`). Le replay traite un recul de plus de 12 h comme un passage à minuit.
- `<Source>.<Méthode>() - ` puis le message ; l'indentation du message reflète l'imbrication des blocs.
- Lignes hors format : `Truncating log, which has reached the size limit of 10000KB` (F1, ligne 75 640), lignes de `=`. Le parseur les reçoit en `kind: 'raw'`.
- **Un nom d'entité peut contenir un saut de ligne** (F3, 134 occurrences, familier cosmétique `PET_9_4`) : `…Entity=[entityName=Jeunemort` puis, sur la ligne suivante sans préfixe, `le Brise-monde id=156 zone=COSMETIC … player=9] tag=4901 value=0`. Le parseur recolle une ligne `GameState` dont un crochet reste ouvert avec les lignes brutes suivantes (4 au plus, jamais une ligne de troncature).

Code : `packages/core/src/log/line.ts`.

## Source retenue : `GameState.DebugPrintPower()`

Chaque événement est journalisé deux fois (F2 : ~170 800 lignes `GameState.DebugPrintPower`, ~171 100 lignes `PowerTaskList.DebugPrintPower`). `GameState` écrit à la réception des paquets ; `PowerTaskList` rejoue les mêmes données au rythme des animations, avec du retard. Le parseur ne lit **que** `GameState.DebugPrintPower()` (et `GameState.DebugPrintGame()` pour l'en-tête) : plus tôt, et jamais compté deux fois.

Autres sources présentes, non exploitées en M1 : `GameState.DebugPrintOptions` / `SendOption` (actions du joueur), `DebugPrintEntityChoices` / `DebugPrintEntitiesChosen` (choix de héros, découvertes, Dark Gifts), `PowerProcessor.*`, `ChoiceCardMgr.*`.

## Commandes

| Commande                                                               | Forme observée                                                                                                                               | Événement                            |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `CREATE_GAME`                                                          | suivi de `GameEntity EntityID=n` et de deux `Player EntityID=n PlayerID=p GameAccountId=[hi=… lo=…]`, chacun suivi de lignes `tag=X value=Y` | `createGame`, `gameEntity`, `player` |
| `FULL_ENTITY - Creating ID=n CardID=c`                                 | suivi de lignes `tag=` ; `CardID=` vide si l'entité est cachée                                                                               | `fullEntity`                         |
| `SHOW_ENTITY - Updating Entity=<réf> CardID=c`                         | révèle une entité, suivi de lignes `tag=`                                                                                                    | `showEntity`                         |
| `CHANGE_ENTITY - Updating Entity=<réf> CardID=c`                       | change la carte (ex. passage en doré `BG31_177` → `BG31_177_G`)                                                                              | `changeEntity`                       |
| `HIDE_ENTITY - Entity=<réf> tag=ZONE value=Z`                          |                                                                                                                                              | `hideEntity`                         |
| `TAG_CHANGE Entity=<réf> tag=T value=V`                                |                                                                                                                                              | `tagChange`                          |
| `BLOCK_START BlockType=B Entity=<réf> …` / `BLOCK_END`                 | **non équilibrés** (F2 : 4 687 starts, 4 559 ends) : on ne s'appuie pas sur l'imbrication                                                    | `blockStart` / `blockEnd`            |
| `META_DATA`, `Info[i] =`, `Source =`, `Targets`, `SUB_SPELL_START/END` | métadonnées d'historique et effets visuels                                                                                                   | ignorées                             |

Une ligne `GameState.DebugPrintPower` inconnue est comptée dans `parser.diagnostics` (avec des exemples) puis ignorée, jamais fatale. F1, F2 et F3 : 0 ligne non reconnue.

### Références d'entité (`Entity=…`)

Trois formes :

1. un entier : `Entity=27` ;
2. un crochet : `[entityName=Tchak Coupebeurre id=120 zone=HAND zonePos=4 cardId=BG21_HERO_010 player=2]` — le nom peut contenir des espaces et même des crochets (`UNKNOWN ENTITY [cardType=INVALID]`) ; seul `id=n` est lu ;
3. un nom : `GameEntity`, ou un nom de joueur.

**Noms de joueurs.** Il n'y a que deux entités `Player` en BG solo : le joueur local et un emplacement « dummy » (`BACON_DUMMY_PLAYER=1`, `GameAccountId=[hi=0 lo=0]`). L'en-tête donne un nom à chacun (`PlayerName=Игрок1` pour le dummy dans F1 et F2), mais dans les `TAG_CHANGE` le dummy apparaît sous **d'autres** noms : `Bob`, `Bob le barman` en recrutement, et le nom de l'adversaire pendant les combats (`Adversaire2`…). Règle : nom d'en-tête → ce joueur ; tout autre nom → le dummy (`resolveRef`).

### Valeurs de tags

- Le jeu écrit le nom du tag s'il le connaît (`PLAYER_TECH_LEVEL`), sinon son identifiant (`tag=3085`). F2 : 257 tags nommés, 205 numériques. Les deux sont gardés tels quels, en chaîne ; un tag inconnu n'est jamais une erreur.
- Valeur entière → `number`, sinon nom d'énumération (`ZONE value=PLAY`) → `string`.
- Une table ID → nom versionnée (issue de `python-hearthstone/enums.py`) est prévue dans `packages/data` pour normaliser les tags numériques ; M1 n'en a pas besoin.

## Battlegrounds

### En-tête (`DebugPrintGame`)

`BuildNumber` (251952 puis 254477), `GameType=GT_BATTLEGROUNDS`, `FormatType=FT_WILD`, `ScenarioID=3459`, puis `PlayerID=p, PlayerName=…` pour les deux joueurs. Les `PlayerID` changent d'une partie à l'autre (F1 : 8 et 16 ; F2 : 2 et 10) : jamais codés en dur.

**Joueur local** : l'entité `Player` dont le `GameAccountId` est non nul.

### Mode de jeu

`GameType` de l'en-tête : `GT_BATTLEGROUNDS` = solo (F1, F2, F3). `GT_BATTLEGROUNDS_DUO` = **Duos** : vu dans le `Power.log` réel de l'utilisateur le 18/10/2026 (en-tête seulement, log non versionné). C'est le critère de détection retenu (`gameModeOf`), à la place de `BACON_DUOS_PUNISH_LEAVERS` qui est présent en solo. Tout autre `GT_BATTLEGROUNDS*` est `unknown`. Hors solo, l'overlay n'affiche qu'un avertissement tant que le Duos n'est pas implémenté à partir d'une fixture Duos.

### Cycle de partie

- `STEP=BEGIN_MULLIGAN` sur GameEntity : choix du héros (4 héros proposés dans F2, via `DebugPrintEntityChoices` `ChoiceType=MULLIGAN`).
- `TURN` sur GameEntity : **impair = recrutement, pair = combat**. Tour de recrutement n = ⌈TURN / 2⌉. F2 : TURN 1 → 28, soit 14 tours. Le `TURN` des entités `Player` compte les tours de chaque emplacement (le local aux tours impairs de GameEntity, le dummy aux pairs).
- `BACON_IN_COMBAT_PHASE` (0/1) sur GameEntity : début et fin de combat. Le `TURN` du recrutement suivant est posé **avant** `BACON_IN_COMBAT_PHASE=0`.
- `STATE=COMPLETE` sur GameEntity : fin de la partie (pour le client local).

### Joueurs du lobby

Chaque joueur est représenté par une entité `CARDTYPE=HERO` portant `PLAYER_ID` (id de classement) et `PLAYER_LEADERBOARD_PLACE`, contrôlée par le dummy (sauf celle du joueur local, désignée par `HERO_ENTITY` sur son entité `Player`). C'est elle qui porte `PLAYER_TECH_LEVEL`, `PLAYER_TRIPLES`, `HEALTH`, `DAMAGE`, `ARMOR`. Des **copies** de héros sont créées pour chaque combat (même `PLAYER_ID`) : elles sont ignorées.

L'id de classement du joueur local est égal à son `PlayerID` (F1 : 8 ; F2 : 2).

Les héros des 7 autres joueurs sont visibles en jeu (classement) : les afficher respecte le fair play.

### Adversaires

- `BACON_CURRENT_COMBAT_PLAYER_ID` est posé sur le joueur local (valeur = **son propre id**) et sur le dummy (valeur = **id de l'adversaire**), puis remis à 0 en fin de combat. Les « valeurs 8 et 0 qui s'intercalent » de F1 sont donc l'id du joueur local et la fin de combat.
  - F1 : adversaires 4, 7, 3, 2, 5, 6 sur 6 combats ; F2 : 14 combats, tous avec un id.
- Le **nom** de l'adversaire est celui que porte le dummy pendant le combat. Le renommage est décalé : il peut précéder le tag d'id (F2, combat 1), le suivre, n'arriver qu'à la fin du combat (F2, combat 13), voire ne jamais arriver (F1, combat 6). Règle : le premier nom du dummy jamais vu hors combat est celui de l'adversaire, sauf s'il est déjà attribué à un autre joueur. Le combat est annoncé dès que l'id est connu ; le nom complète l'enregistrement. Sur F1 et F2, chaque nom correspond toujours au même héros.
- `NEXT_OPPONENT_PLAYER_ID` sur le joueur local (et son héros) : prochain adversaire, information affichée en jeu.

### Infos du joueur local (F2)

- **Or** : `RESOURCES - RESOURCES_USED` sur l'entité `Player` locale (3, 4, 5… en début de tour ; `RESOURCES_USED` baisse à la vente). L'or temporaire d'autres effets n'a pas été identifié.
- **Minuteur** : `TIMEOUT` sur le joueur local, posé juste avant le recrutement, donne sa durée en secondes (40 s → recrutement mesuré de 41 s ; 55 s → 56 s). L'overlay décompte à partir de la réception du `TURN` impair : c'est une estimation.
- **Coût d'amélioration** : `COST` du bouton `TB_BaconShopTechUp0N_Button` (`CARDTYPE=GAME_MODE_BUTTON`, `TECH_LEVEL` = niveau visé) contrôlé par le joueur local, en `PLAY`. Un nouveau bouton est créé à chaque tour ; on prend le plus récent.

### Boutique (F2, F4)

La boutique de Bob est l'ensemble des serviteurs contrôlés par le dummy, en `PLAY`, pendant le recrutement. Sa taille maximale par tour suit exactement 3 / 4 / 4 / 5 / 5 / 6 emplacements selon le niveau de taverne (1 à 6), ce qui confirme les valeurs du wiki (test `seasons/s14/src/poolRules.test.ts`).

### Plateaux de combat (F2)

Après `BACON_CURRENT_COMBAT_PLAYER_ID`, le jeu crée par `FULL_ENTITY` les copies des deux plateaux (`CARDTYPE=MINION`, `ZONE=PLAY`, `CONTROLLER` = joueur local ou dummy), puis les blocs `BLOCK_START BlockType=ATTACK`. Le plateau « vu » d'un adversaire est donc l'ensemble des serviteurs du dummy entrés en `PLAY` une fois l'adversaire connu, figé au premier bloc `ATTACK` (les effets de Début du combat déjà résolus y sont inclus). Stats : `ATK`, `HEALTH - DAMAGE` ; doré : `PREMIUM=1` ou cardId en `_G` ; mots-clés : `TAUNT`, `DIVINE_SHIELD`, `REBORN`, `VENOMOUS`, `WINDFURY`, `DEATHRATTLE`, `STEALTH` (tous vus nommés dans F2).

### Fin de partie et place

- Élimination du joueur local : son héros passe en `ZONE=GRAVEYARD` (gros `DAMAGE`), puis `PLAYSTATE=LOST` sur le joueur local et `PLAYSTATE=WON` sur le dummy (alors nommé comme l'adversaire du dernier combat).
- **`PLAYSTATE=LOST` est reçu avec une 3e place** (F2) : il ne dit rien du top 4.
- Place finale = dernière `PLAYER_LEADERBOARD_PLACE` du héros local à l'élimination. Elle varie souvent pendant la partie (5, 6, 5, 6 en quelques secondes) : jamais présentée comme finale avant l'élimination. F2 : 3, conforme à la réalité.
- Le log continue ~40 s après la mort du héros et ne couvre pas la fin de partie des autres joueurs.

### Abandon

F3 : abandon volontaire au 3e tour de recrutement. Le log ne contient **aucun** événement de fin : ni `PLAYSTATE=LOST`/`CONCEDED`, ni héros en `GRAVEYARD`, ni `STATE=COMPLETE`. Le dernier événement `GameState` date de 18:56:56 ; le fichier s'arrête à 18:57:10 au milieu d'une liste de tâches (`PowerProcessor.PrepareHistoryForCurrentTaskList` sans `EndCurrentTaskList`).

Dans F3 et F4, le dernier événement d'état est `PLAYER_LEADERBOARD_PLACE=8` sur le héros local (en `PLAY`), précédé dans la même milliseconde de `GameEntity tag=4302 value=1`, un tag numérique absent de F1 et F2. Ce 8 n'est pas un classement : dans F4 le joueur était 3e juste avant (20:00:35) ; dans F3 il passait de 7 à 8.

**Heuristique « abandon »** (2 exemples) : le flux se termine sans `PLAYSTATE` terminal ET le dernier événement d'état est la place 8 du héros local → `outcome: 'abandoned'`. La place 8 est retirée du joueur local (`placeBeforeAbandon` garde la précédente, à titre informatif), aucune place finale n'est retenue, et la partie sera exclue des moyennes de classement (M6). Le tag 4302 est un indice concordant, non utilisé par la règle tant qu'il n'est pas mieux établi.

Règle : une partie BG commencée qui n'a reçu ni élimination ni `STATE=COMPLETE` est **« abandonnée ou interrompue »** (`outcome: 'interrupted'`, sans place finale) quand le flux s'arrête (fin du fichier rejoué, nouvelle session de jeu) ou qu'un nouveau `CREATE_GAME` arrive. Un simple silence du log ne suffit pas (le joueur peut réfléchir). Une partie tronquée (F1) finit aussi en `interrupted`, avec `truncated: true`.

### Tribus du lobby

Aucune annonce au début de la partie. `BACON_SUBSET_<TRIBU>` apparaît sur les serviteurs (et sur certains héros) au fil de la partie. Le tracker compte les **cartes distinctes** (version dorée `_G` ramenée à la carte de base) par tribu, sur les serviteurs visibles (zones `PLAY` et `HAND`). F2 en fin de partie : DRAGON 23, MECH 21, MURLOC 19, DEMON 17, ELEMENTALS 17 ; puis NAGA 2, PIRATE 1, QUILLBOAR 1, UNDEAD 1 (cartes arrivées par effets). Une tribu est « identifiée » à partir de 8 cartes distinctes, parmi les 5 premières ; l'UI affiche « k/5 tribus identifiées ».

Le nombre de tribus par lobby (5) et le seuil sont des paramètres (`defaultTribeOptions`), à déplacer dans les données de saison.

### Aberrations et orthographe des tribus (F4)

Les **Aberrations** sont un TYPE de serviteur (36.6.1), pas des anomalies (toujours absentes). Elles portent `CARDRACE=ABERRATION` et `BACON_SUBSET_ABERRATION=1`. F4 : 44 entités, cartes `BG36_098` Zoatroïde, `BG36_099` Tortionnaire de l'esprit, `BG36_100` Brise-volonté errant, `BG36_113` Sacrifice flottant, et `BGFYM_000` **C'Thun** : créé en `SETASIDE`, il entre en `PLAY` au combat 4 (affiché par le client de 20:02:38 à 20:02:49) via la « Divinité secrète » `BG_OldGod` en zone `SECRET`.

Les deux familles de tags n'ont pas la même orthographe : `CARDRACE=QUILBOAR` (un L) / `BACON_SUBSET_QUILLBOAR` (deux L), `MECHANICAL` / `MECH`, `ELEMENTAL` / `ELEMENTALS`. Le tracker lit les deux et normalise vers la forme `BACON_SUBSET_` (`canonicalTribe`).

Nagas : retirés du pool au patch actuel (constat de l'utilisateur), ils n'apparaissent que via des serviteurs à double type.

### Décalage d'affichage des combats (F2, F4) — enjeu fair-play

`GameState` reçoit le combat entier en moins d'une seconde ; le client l'anime ensuite. `PowerTaskList` suit l'animation. Mesure du `TURN` de fin de combat : écart GameState → affichage de **7,7 à 48,1 s** (F2) et de 7,9 à 30,4 s (F4) ; au début du combat l'écart est ≤ 2 s. Tout ce que le modèle déduit de `GameState` pendant un combat (PV perdus, classement, élimination, invocations) est donc connu du tracker avant d'être visible à l'écran.

**Horloge d'affichage** (`power/markers.ts`, `pipeline.ts`). `GameState` reste la seule source de DONNÉES ; `PowerTaskList` ne sert que d'horloge. Les deux flux contiennent la même séquence de repères, dans le même ordre : blocs `ATTACK` et `DEATHS`, `TURN` et `BACON_IN_COMBAT_PHASE` sur GameEntity, `STATE=COMPLETE`, `PLAYSTATE` terminal (séquences identiques vérifiées : 302 repères dans F2, 83 dans F1, 39 dans F4 ; dans F3 `PowerTaskList` s'arrête 2 repères avant). Exclus : `STATE=RUNNING` (`Entity=4` d'un côté, `Entity=GameEntity` de l'autre) et `PLAYSTATE=PLAYING/LOSING` (ordre différent dans F2). Le pipeline prend un instantané immuable juste avant chaque repère `GameState` et ne le libère que lorsque `PowerTaskList` affiche le même repère : `pipeline.displayed` est la seule source de l'UI. Garde-fous : réalignement sur 8 repères, horloge désactivée après 5 désaccords, libération après 120 s de temps de log, et à la fin du flux.

Test (`displayClock.test.ts`) : sur les 4 fixtures, le `TURN` affiché ne dépasse jamais celui des lignes `PowerTaskList` brutes ; dans F2, quand GameState apprend la perte de 10 PV au combat 7, l'overlay montre encore 25.

### Saison 14 : trinkets, Dark Gifts, Activation, compteurs (F1, F2, F4)

Activées par `BACON_TRINKETS_ACTIVE=1` et `BACON_DARK_GIFTS_ACTIVE=1` sur GameEntity à la création. Piège : `BACON_DUOS_PUNISH_LEAVERS=1` est présent en **solo**.

- **Trinkets** : deux entités `CARDTYPE=BATTLEGROUND_TRINKET` du joueur local, en `PLAY`, cardIds `BG30_Trinket_1st` (mineur) et `BG30_Trinket_2nd` (majeur), avec `BACON_TURNS_LEFT_TO_DISCOVER_TRINKET` (5 et 8 au départ, décompté chaque tour). Au choix (`DebugPrintEntityChoices`, 4 options en `SETASIDE`), l'entité emplacement est transformée en trinket choisi (`BACON_TRINKET=1`). F2 : Portrait de conque (`BG35_MagicItem_305`, tour 6), Boussole colorée (`BG30_MagicItem_426t`, tour 9).
- **Dark Gifts** : bouton `BG36_Button_DarkGift` (`COST=3`, `EXHAUSTED`, `BACON_DARK_GIFT_PRESSABLE_VFX=1` quand il est utilisable). Un clic crée `BG36_MidGameEffect_010` (« Sombre don des champs de bataille ») qui propose 3 serviteurs ; chacun porte `DARK_GIFT_ENTITY` = l'entité « don » (sort `BG36_MidGameEffect_000t…` : Dorure, Bouclier robuste, Cicatrices de guerre…) et `HAS_DARK_GIFT=1`. Le serviteur choisi passe de `SETASIDE` à `HAND`. F2 : 3 dons (tours 4, 7 et 10), F4 : 2, F1 : 1. Le bouton n'est utilisable qu'à partir du tour 3, une fois par tour (vérifié sur F2, conforme aux notes 36.2 ; 3 utilisations maximum par partie selon ces notes).
- **Activation** : bloc `BLOCK_START BlockType=PLAY` sur un serviteur du joueur local DÉJÀ en `PLAY`, avec dépense d'or (`RESOURCES_USED`). F2 : 9 (Fugitif des égouts `BG36_700` ×6, Garde océanique `BG36_701` ×3). Le coût figure dans le texte de la carte (« Activation (n) ») ; aucun tag dédié n'a été identifié (le tag numérique 1196, posé juste avant, concerne toutes sortes de serviteurs).
- **Compteurs nommés** sur le joueur local : `TAVERN_SPELL_ATTACK_INCREASE` / `TAVERN_SPELL_HEALTH_INCREASE` (F2 : +8/+8), `NUM_SPELLS_PLAYED_THIS_GAME` (F2 : 53), `BACON_PLAYER_EXTRA_GOLD_NEXT_TURN`, `BACON_OLD_GOD_ATTACK` / `BACON_OLD_GOD_HEALTH` (F4 : C'Thun 5/3, identique à son invocation). Aucun compteur de gemmes de sang ni de buff d'Élémentaires n'apparaît dans ces parties : non implémentés.

### Héros

CardIds `TB_BaconShop_HERO_<n>`, `BG<nn>_HERO_<nnn>`, et skins (`BG20_HERO_202_SKIN_A`, `TB_BaconShop_HERO_50_SKIN_D4`). Placeholder avant le choix : `TB_BaconShop_HERO_PH`. La normalisation skin → héros de base passera par les données HearthstoneJSON (M3), pas par une règle sur le nom.

## Troncature

Sans `client.config` → `[Log] FileSizeLimit.Int=-1`, le jeu s'arrête vers 10 000 Ko (F1 : tour 13, ~9 min) et écrit `Truncating log, …`. Le parseur émet `truncated` ; l'état n'est **jamais** remis à zéro ; l'UI affiche « log tronqué, état possiblement incomplet ». Le LogWatcher signale aussi un fichier qui raccourcit (`shrunk`). Ce que le jeu écrit après une troncature n'a pas été observé : rien n'est présumé.

## Inconnues (demander un log réel avant d'implémenter)

- Mode Duos : détection connue (`GT_BATTLEGROUNDS_DUO`), tout le reste (partenaire, appariement, plateaux) attend une fixture Duos.
- Victoire en 1re place ; défaite rapide (élimination en début de partie, a priori comme F2).
- Reconnexion en cours de partie.
- Quêtes, anomalies.
- Aberrations / Divinités (patch 36.6.1) : aucun tag nommé dans F2 ; `BACON_GLOBAL_OLD_GOD_DBID` est un candidat.
