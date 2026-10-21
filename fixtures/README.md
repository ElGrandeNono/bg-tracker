# Fixtures

Logs `Power.log` réels, **anonymisés avant d'arriver ici**. Ne cherchez jamais à retrouver les vrais pseudos.

Seuls les `.gz` sont versionnés ; les `.log` bruts sont ignorés par git (`.gitignore`). Le mode replay lit les `.gz` directement. Pour régénérer un `.gz` : `node scripts/gzip-fixture.mjs fixtures/<fichier>.log`.

| Fichier | Build | Date | Mode | Contenu | Vérité terrain |
| --- | --- | --- | --- | --- | --- |
| `bg-solo-2026-09-21-tronque.Power.log.gz` | 251952 | 21/09/2026 | solo | ~75 600 lignes, **tronqué** au tour 13 (`Truncating log…` ligne 75 640) | — |
| `bg-solo-2026-10-18-complete.Power.log.gz` | 254477 (patch 37.0) | 18/10/2026 | solo | ~439 400 lignes, partie complète de 27 min | héros Fongimancien Flurgl (`TB_BaconShop_HERO_55`), tribus Dragon / Démons / Murloc / Mécas / Élémentaires, place finale 3 |
| `bg-solo-2026-10-18-abandon.Power.log.gz` | 254477 (patch 37.0) | 18/10/2026 | solo | 20 378 lignes (`Power.partie-courte.anonymise.log`), TURN 1 à 5, 2 combats, **abandon** : fin du log sur la place 8 du héros local | héros Yeux-de-Serpent (`BG28_HERO_400`), PlayerID 1 et 9, tribus vues DEMON, DRAGON, ELEMENTALS, NAGA, PIRATE, QUILLBOAR, pas de place finale |
| `bg-solo-2026-10-18-aberrations.Power.log.gz` | 254477 (patch 37.0) | 18/10/2026 | solo | 40 081 lignes (`Power.partie-courte-aberrations.anonymise.log`), 19:57:42 → 20:03:02, TURN 1 à 9, 4 combats, **abandon** (3e juste avant le 8 final), tribu **ABERRATION** | héros Onyxia (`BG22_HERO_305`, entité 90), PlayerID 7 et 15, taverne 3 au plus dans le lobby (2 pour le joueur local), Aberrations jouées : Zoatroïde, Tortionnaire de l'esprit, Brise-volonté errant, Sacrifice flottant ; C'Thun invoqué au combat 4 |

**9 parties solo complètes** (fournies le 21/10/2026, déjà anonymisées ; build 254477, `GT_BATTLEGROUNDS`, ScenarioID 3459 ; toutes finies par `LOSING`→`LOST` du joueur local, aucune victoire). Héros, places et tribus : relevés par l'utilisateur dans le log, non confirmés en jeu.

| Fichier (source) | Parties |
| --- | --- |
| `bg-solo-3-parties.Power.log.gz` (`Power.solo-3-parties.anonymise.log`, 997 883 lignes) | A1 Le Geôlier `TB_BaconShop_HERO_702`, 5e, 12 manches ; A2 Mécano-amplificateur `BG24_HERO_204`, 4e ; A3 Morchie `BG34_HERO_004`, **2e** (le `WON` du gagnant n'apparaît que côté PowerTaskList) |
| `bg-solo-4-parties.Power.log.gz` (`Power.solo-4-parties.anonymise.log`, 1 008 298 lignes) | B1 Mécano-amplificateur, 6e (quête de héros adverse, `BACON_QUEST_COMPLETED`) ; B2 Tickatus `TB_BaconShop_HERO_94`, 7e (place 7↔8) ; B3 Tae'thelan `BG28_HERO_800`, 5e (compagnons `_Buddy`) ; B4 M. Bigglesworth `TB_BaconShop_HERO_70`, 6e (événements 45 s après le `LOST`) |
| `bg-solo-30-tours.Power.log.gz` (`Power.solo-1-partie-30-tours.anonymise.log`, 460 260 lignes) | C1 Cénarius `BG32_HERO_001`, 3e, 15 manches (place 1 à un moment) |
| `bg-solo-18-tours.Power.log.gz` (`Power.solo-1-partie-18-tours.anonymise.log`, 190 451 lignes) | D1 Tamsin `BG20_HERO_282_SKIN_C4` (skin), 7e, 9 manches |

Tribus du lobby (cartes distinctes vues) : 10 à 34 pour les 5 vraies, ≤ 2 pour les autres, dans les 9 parties ; ABERRATION dans B1, B3, C1, D1. Ces fichiers servent aussi à mesurer le simulateur (`scripts/sim-eval.mjs`, voir `docs/simulator-coverage.md`). Tests sur ces gros fichiers : « slow », ou extraits générés par script.

Notes :

- Partie abandonnée : l'utilisateur était au niveau de taverne 2 au moment d'abandonner, mais le log s'arrête avant l'achat ; le héros local y reste à 1.
- Partie aux Aberrations : le parseur compte 44 entités `CARDRACE=ABERRATION` (45 lignes, une entité décrite deux fois) ; l'utilisateur en avait compté 43.
- `Power.duos-2-parties.anonymise.zip` (2 parties Duos, fourni le 18/10/2026) : pas encore converti, réservé au mode Duos (P2).

## Fixtures attendues

4. Partie Duos : reçue (`Power.duos-2-parties.anonymise.zip`, 2 parties), à convertir en fixture au moment du mode Duos (P2).

Les logs synthétiques ne sont permis que pour des tests unitaires ciblés, nommés `synthetic-*` et signalés comme tels.
