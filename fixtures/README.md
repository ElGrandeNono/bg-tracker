# Fixtures

Logs `Power.log` réels, **anonymisés avant d'arriver ici**. Ne cherchez jamais à retrouver les vrais pseudos.

Seuls les `.gz` sont versionnés ; les `.log` bruts sont ignorés par git (`.gitignore`). Le mode replay lit les `.gz` directement. Pour régénérer un `.gz` : `node scripts/gzip-fixture.mjs fixtures/<fichier>.log`.

| Fichier | Build | Date | Mode | Contenu | Vérité terrain |
| --- | --- | --- | --- | --- | --- |
| `bg-solo-2026-09-21-tronque.Power.log.gz` | 251952 | 21/09/2026 | solo | ~75 600 lignes, **tronqué** au tour 13 (`Truncating log…` ligne 75 640) | — |
| `bg-solo-2026-10-18-complete.Power.log.gz` | 254477 (patch 37.0) | 18/10/2026 | solo | ~439 400 lignes, partie complète de 27 min | héros Fongimancien Flurgl (`TB_BaconShop_HERO_55`), tribus Dragon / Démons / Murloc / Mécas / Élémentaires, place finale 3 |
| `bg-solo-2026-10-18-abandon.Power.log.gz` | 254477 (patch 37.0) | 18/10/2026 | solo | 20 378 lignes, TURN 1 à 5, 2 combats, **abandon volontaire** : aucun événement de fin | héros Yeux-de-Serpent (`BG28_HERO_400`), PlayerID 1 et 9, pas de place finale |

Note sur la partie abandonnée : l'utilisateur a mesuré « taverne niveau 2 ». Dans le log, le lobby atteint 2 mais le héros local reste à `PLAYER_TECH_LEVEL=1` ; le test d'acceptation suit le log.

## Fixtures attendues

4. Partie Duos, même courte : nécessaire avant de toucher au mode Duos (P2).

Les logs synthétiques ne sont permis que pour des tests unitaires ciblés, nommés `synthetic-*` et signalés comme tels.
