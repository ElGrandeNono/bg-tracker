# Fixtures

Logs `Power.log` réels, **anonymisés avant d'arriver ici**. Ne cherchez jamais à retrouver les vrais pseudos.

Seuls les `.gz` sont versionnés ; les `.log` bruts sont ignorés par git (`.gitignore`). Le mode replay lit les `.gz` directement. Pour régénérer un `.gz` : `node scripts/gzip-fixture.mjs fixtures/<fichier>.log`.

| Fichier | Build | Date | Mode | Contenu | Vérité terrain |
| --- | --- | --- | --- | --- | --- |
| `bg-solo-2026-09-21-tronque.Power.log.gz` | 251952 | 21/09/2026 | solo | ~75 600 lignes, **tronqué** au tour 13 (`Truncating log…` ligne 75 640) | — |
| `bg-solo-2026-10-18-complete.Power.log.gz` | 254477 (patch 37.0) | 18/10/2026 | solo | ~439 400 lignes, partie complète de 27 min | héros Fongimancien Flurgl (`TB_BaconShop_HERO_55`), tribus Dragon / Démons / Murloc / Mécas / Élémentaires, place finale 3 |
| `bg-solo-2026-10-18-abandon.Power.log.gz` | 254477 (patch 37.0) | 18/10/2026 | solo | 20 378 lignes (`Power.partie-courte.anonymise.log`), TURN 1 à 5, 2 combats, **abandon** : fin du log sur la place 8 du héros local | héros Yeux-de-Serpent (`BG28_HERO_400`), PlayerID 1 et 9, tribus vues DEMON, DRAGON, ELEMENTALS, NAGA, PIRATE, QUILLBOAR, pas de place finale |
| `bg-solo-2026-10-18-aberrations.Power.log.gz` | 254477 (patch 37.0) | 18/10/2026 | solo | 40 081 lignes (`Power.partie-courte-aberrations.anonymise.log`), 19:57:42 → 20:03:02, TURN 1 à 9, 4 combats, **abandon** (3e juste avant le 8 final), tribu **ABERRATION** | héros Onyxia (`BG22_HERO_305`, entité 90), PlayerID 7 et 15, taverne 3 au plus dans le lobby (2 pour le joueur local), Aberrations jouées : Zoatroïde, Tortionnaire de l'esprit, Brise-volonté errant, Sacrifice flottant ; C'Thun invoqué au combat 4 |

Notes :

- Partie abandonnée : l'utilisateur était au niveau de taverne 2 au moment d'abandonner, mais le log s'arrête avant l'achat ; le héros local y reste à 1.
- Partie aux Aberrations : le parseur compte 44 entités `CARDRACE=ABERRATION` (45 lignes, une entité décrite deux fois) ; l'utilisateur en avait compté 43.
- `Power.duos-2-parties.anonymise.zip` (2 parties Duos, fourni le 18/10/2026) : pas encore converti, réservé au mode Duos (P2).

## Fixtures attendues

4. Partie Duos : reçue (`Power.duos-2-parties.anonymise.zip`, 2 parties), à convertir en fixture au moment du mode Duos (P2).

Les logs synthétiques ne sont permis que pour des tests unitaires ciblés, nommés `synthetic-*` et signalés comme tels.
