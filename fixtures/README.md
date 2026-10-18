# Fixtures

Logs `Power.log` réels, **anonymisés avant d'arriver ici**. Ne cherchez jamais à retrouver les vrais pseudos.

Seuls les `.gz` sont versionnés ; les `.log` bruts sont ignorés par git (`.gitignore`). Le mode replay lit les `.gz` directement. Pour régénérer un `.gz` : `node scripts/gzip-fixture.mjs fixtures/<fichier>.log`.

| Fichier | Build | Date | Mode | Contenu | Vérité terrain |
| --- | --- | --- | --- | --- | --- |
| `bg-solo-2026-09-21-tronque.Power.log.gz` | 251952 | 21/09/2026 | solo | ~75 600 lignes, **tronqué** au tour 13 (`Truncating log…` ligne 75 640) | — |
| `bg-solo-2026-10-18-complete.Power.log.gz` | 254477 (patch 37.0) | 18/10/2026 | solo | ~439 400 lignes, partie complète de 27 min | héros Fongimancien Flurgl (`TB_BaconShop_HERO_55`), tribus Dragon / Démons / Murloc / Mécas / Élémentaires, place finale 3 |

## Fixtures attendues

3. Partie solo courte (défaite rapide ou abandon) : autre chemin de fin de partie.
4. Partie Duos, même courte : nécessaire avant de toucher au mode Duos (P2).

Les logs synthétiques ne sont permis que pour des tests unitaires ciblés, nommés `synthetic-*` et signalés comme tels.
