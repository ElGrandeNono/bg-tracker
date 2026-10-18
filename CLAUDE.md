# BG Tracker — guide pour Claude

Tracker Hearthstone Battlegrounds : Electron + TypeScript strict + React, monorepo pnpm, licence MIT. Jalon courant : **M0 terminé → M1** (parseur + GameState + replay). Plan complet : voir le plan de jalons (M0 à M8) résumé plus bas.

## Commandes

| Action                                | Commande                                                    |
| ------------------------------------- | ----------------------------------------------------------- |
| Installer                             | `pnpm install`                                              |
| Build (tsc -b, références de projets) | `pnpm build`                                                |
| Tests (Vitest)                        | `pnpm test` (`pnpm test:watch`, `pnpm coverage`)            |
| Lint                                  | `pnpm lint`                                                 |
| Format                                | `pnpm format` / `pnpm format:check`                         |
| Compresser une fixture                | `node scripts/gzip-fixture.mjs fixtures/<fichier>.log`      |
| Replay                                | `pnpm replay <fichier.log[.gz]> [--speed N]` — arrive en M1 |

Windows : Node et pnpm sont installés mais un shell ouvert avant l'installation n'a pas le PATH à jour (`C:\Program Files\nodejs`, `%APPDATA%\npm`).

## Structure

```
packages/core   parseur Power.log, reducer immuable, filtre fair-play, replay (pur TS, zéro UI)
packages/data   HearthstoneJSON, cache par build, table GameTag ID→nom versionnée
packages/sim    simulateur de combat Monte Carlo (worker_threads)
seasons/s14     mécaniques saisonnières (Dark Gifts, Activate, trinkets) — rien de saisonnier dans core
apps/           overlay, dashboard, stream-server (à partir de M2)
fixtures/       vrais logs anonymisés, versionnés en .gz uniquement (voir fixtures/README.md)
scripts/        outils de dev
```

Pipeline : `LogWatcher → Parser → GameState (reducer immuable) → filtre visibilité → EventBus → [Overlay | Stats | Stream | Plugins]`. Le mode replay alimente le même pipeline depuis un fichier.

## Conventions

- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), ESM, imports relatifs avec extension `.js`.
- Chaque paquet a `tsconfig.json` (vérif. typée, tests inclus, noEmit) et `tsconfig.build.json` (émission vers `dist`, tests exclus). Les paquets exposent la condition d'export `source` → Vitest et TS lisent `src/` directement.
- **TypeScript épinglé en `~6.0`** : typescript-eslint 8.x exige `typescript <6.1`. Ne pas passer à TS 7 tant que typescript-eslint ne le supporte pas.
- Tests à côté du code (`*.test.ts`). Scénarios déterministes (graine fixée) pour le simulateur.
- Conventional Commits, un commit par étape logique.
- Commentaires et docs en français ; identifiants en anglais.
- Toute info externe (notes de patch, champs HearthstoneJSON, règles) : citer la source en commentaire ou dans `docs/`.

## Règles non négociables

1. **Lecture des fichiers de log uniquement.** Interdit : lecture mémoire du processus, injection, hook DLL, modification des fichiers du jeu, automatisation d'inputs, capture d'écran + OCR.
2. **Fair play.** Aucune info invisible en jeu normal (mains cachées, boutiques adverses, entités masquées). Une seule couche de filtrage entre parseur et UI, couverte par un test automatisé.
3. **Pas d'assets Blizzard** dans le dépôt ni l'installeur. Données/images depuis HearthstoneJSON au runtime, en cache. Disclaimer « non affilié à Blizzard Entertainment » (README + écran À propos).
4. **Pas de scraping** de données propriétaires/payantes. Stats externes via l'interface `StatsProvider` ; défaut = historique local.
5. **Vie privée.** Tout local, aucune télémétrie par défaut, tout envoi réseau optionnel désactivé par défaut et documenté.
6. **Ne jamais deviner** noms de tags, champs HearthstoneJSON ou règles du jeu : vérifier dans les sources ou demander un log réel. Fin de partie hors cas observé, Duos, anomalies, quêtes, reconnexion : points d'extension seulement, en attendant un log.

## Faits établis sur le format (détails dans `docs/log-format.md` à partir de M1)

- UTF-8, CRLF, lignes `D hh:mm:ss.fffffff <Source>.<Méthode>() - <message>` ; date dans le nom du dossier `Hearthstone_AAAA_MM_JJ_hh_mm_ss`.
- Source retenue : `GameState.DebugPrintPower()`. `PowerTaskList.DebugPrintPower()` duplique les mêmes événements : ne jamais compter les deux.
- PlayerID variables d'une partie à l'autre : jamais en dur. Joueur local = `GameAccountId` non nul.
- Tags inconnus affichés en numérique (`tag=3085`) : garder le brut, jamais d'exception.
- Place finale = dernière `PLAYER_LEADERBOARD_PLACE` du héros local à l'élimination. `PLAYSTATE=LOST` ne veut pas dire hors top 4.
- Tribus du lobby non annoncées : déduction progressive avec niveau de confiance.
- Troncature : `Truncating log, which has reached the size limit of 10000KB` → ne jamais remettre l'état à zéro ; avertir.

## Jalons

M0 scaffold/CI ✅ · M1 parseur + GameState + replay · M2 overlay minimal + filtre fair-play · M3 pool + tribus + navigateur · M4 mécaniques saisonnières · M5 simulateur · M6 SQLite + stats + replay de partie · M7 personnalisation, streamer, i18n, packaging · M8 docs.

Critère M1 : sur les deux fixtures, chronologie correcte (tours, combats et adversaires, tiers, places) ; partie complète → `TB_BaconShop_HERO_55`, place 3, tribus Dragon/Démons/Murloc/Mécas/Élémentaires ; log tronqué → avertissement sans crash.

## À demander à l'utilisateur au bon moment

- Pendant M1 : fixture n°3 (partie solo courte / abandon).
- Avant M4 : Aberrations / Naga présents dans ses parties actuelles ? (36.6.1 a ajouté les Aberrations et retiré les Naga ; la partie du 18/10 montre des Naga.)
- Avant le mode Duos : fixture n°4.
