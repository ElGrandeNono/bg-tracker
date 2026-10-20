# BG Tracker — guide pour Claude

Tracker Hearthstone Battlegrounds : Electron + TypeScript strict + React, monorepo pnpm, licence MIT. Jalon courant : **M7 terminé → M8** (finitions, docs utilisateur et développeur, README avec captures). Dépôt : https://github.com/ElGrandeNono/bg-tracker (public, CI GitHub Actions Windows + Ubuntu).

## Commandes

| Action                                       | Commande                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Installer                                    | `pnpm install`                                                                                          |
| Build (tsc -b, références de projets)        | `pnpm build`                                                                                            |
| Tests (Vitest)                               | `pnpm test` (`pnpm test:watch`, `pnpm coverage`)                                                        |
| Lint                                         | `pnpm lint`                                                                                             |
| Format                                       | `pnpm format` / `pnpm format:check`                                                                     |
| Compresser une fixture                       | `node scripts/gzip-fixture.mjs fixtures/<fichier>.log`                                                  |
| Overlay en direct / replay / démo navigateur | `pnpm overlay` · `pnpm overlay:replay <log> --speed 10` · `pnpm overlay:demo` (UI seule, port 5199)     |
| Capture de contrôle Electron                 | `apps/overlay`: `electron . --replay <log> --smoke <out.png>` (`BGT_DEBUG=1` pour le journal)           |
| Installeur Windows (après `pnpm build`)      | `pnpm --filter @bgt/overlay package` (`package:dir` = appli décompressée, plus rapide)                  |
| Replay (build puis chronologie console)      | `pnpm replay <fichier.log\|.gz\|.zip> [--speed N] [--quiet]` (`--speed 0` = instantané, 1 = temps réel) |

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

Dans `packages/core/src` :

```
log/line.ts           découpage d'une ligne (niveau, heure, source, méthode, message)
power/parser.ts       PowerParser : lignes GameState.DebugPrintPower → PowerEvent (tolérant, diagnostics)
state/gameState.ts    reducer immuable des entités (IdMap = trie persistant), résolution des noms
bg/bgGame.ts          modèle BG dérivé : tours, combats/adversaires, classement, tiers, triples, place finale
bg/tribes.ts          déduction des tribus du lobby avec niveau de confiance
bg/format.ts          rendu console de la chronologie
pipeline.ts           Parser → GameState → BgGame, abonnements
replay/               lecture .log/.gz/.zip, replay à vitesse réglable
watcher/              LogWatcher (tail, troncature, relance du jeu), log.config / client.config (fonctions pures)
cli/replay.ts         CLI `pnpm replay`
acceptance.test.ts    tests d'acceptation sur les deux fixtures réelles (vérité terrain)
```

`GameState` contient des infos cachées : seule `visibility/view.ts` (`buildVisibleView`, liste blanche) alimente l'UI, test `visibility/view.test.ts`.

Historique : `packages/history` (`HistoryStore` via `node:sqlite` intégré, migrations `PRAGMA user_version` ; `GameRecorder` construit un `GameRecord` + replay par tour depuis la vue FILTRÉE ; `computeStats` exclut abandons/interruptions ; `importLogFolder` rejoue `Logs/Hearthstone_*` ; sous-chemin pur `@bgt/history/stats` pour le renderer). Overlay : `src/main/history.ts` (IPC `invoke`), `src/renderer/Dashboard.tsx` (route `#dashboard`, Ctrl+Maj+D). Seul le suivi en direct enregistre (pas les replays).

Simulateur : `packages/sim` (moteur `engine.ts` avec ses sources, registre d'effets `registry.ts`, Monte Carlo `monteCarlo.ts`, `SimulationPool` en worker threads `pool.ts`/`worker.ts`). Overlay : `apps/overlay/src/main/combatSim.ts` (entrée depuis la vue filtrée), worker empaqueté `simWorker.ts`. Couverture et validation sur combats réels : `docs/simulator-coverage.md`. Le test `pool.test.ts` utilise `packages/sim/dist/worker.js` : `pnpm build` avant `pnpm test`.

Saison : contrat `core/src/season/module.ts` (`SeasonModule` : état propre + `reduce` + `view` avec `shownCardIds`), état retenu par l'horloge d'affichage (`Snapshot.season`). Saison 14 : `seasons/s14/src/tracker.ts` (trinkets, Dark Gifts, Activations, compteurs) + tests fair-play `tracker.test.ts`. Overlay : `apps/overlay/src/main/season.ts` (`overlayView`).

Pool : `core/src/pool/pool.ts` (calcul pur, hypergéométrique), règles dans `seasons/s14/src/poolRules.ts` (sources + `verified`), catalogue `data/src/poolCatalog.ts` (pool solo HearthstoneJSON, hors Duos), cartes vues = `VisibleView.poolSightings`. Navigateur de serviteurs = même renderer, route `#browser`, fenêtre séparée. Voir `docs/adding-a-season.md`.

Lecture d'écran (opt-in) : `main/screenTribes.ts` (capture de la fenêtre Hearthstone au choix du héros, OCR tesseract.js local, données fra/eng embarquées), `main/tribeNames.ts` (correspondance floue) ; `--ocr-test <png>` et `--ocr-selftest` pour vérifier.

Personnalisation (M7) : fenêtre Réglages `renderer/Settings.tsx` (route `#settings`, Ctrl+Maj+P, patchs validés par `main/settings.ts` `applyPatch`) ; i18n `renderer/i18n.ts` (fr = référence, en du même type ; aucun texte d'interface en dur ailleurs) et `main/menuStrings.ts` ; alertes `renderer/alerts.ts` ; mode streamer `main/streamServer.ts` + `renderer/streamBridge.ts` (opt-in, 127.0.0.1) ; mises à jour `main/updater.ts` (opt-in) ; empaquetage `apps/overlay/package.mjs` et `.github/workflows/release.yml`. Démo : `?lang=en&theme=contrast` dans l'URL.

`packages/data` : `loadCardDb` (HearthstoneJSON `/v1/<build>/<locale>/cards.json`, cache par build, repli `latest` puis cache périmé). `apps/overlay` : `src/main` (pipeline, `hsWindow.ts` user32 via koffi, réglages, config du jeu), `src/preload`, `src/renderer` (React), `src/shared/payload.ts` (contrat IPC), `build.mjs` (esbuild) + Vite. Détails : `docs/architecture.md`.

## Conventions

- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), ESM, imports relatifs avec extension `.js`.
- Chaque paquet a `tsconfig.json` (vérif. typée, tests inclus, noEmit) et `tsconfig.build.json` (émission vers `dist`, tests exclus). Les paquets exposent la condition d'export `source` → Vitest et TS lisent `src/` directement.
- **TypeScript épinglé en `~6.0`** : typescript-eslint 8.x exige `typescript <6.1`. Ne pas passer à TS 7 tant que typescript-eslint ne le supporte pas.
- Tests à côté du code (`*.test.ts`). Scénarios déterministes (graine fixée) pour le simulateur.
- Conventional Commits, un commit par étape logique.
- Commentaires et docs en français ; identifiants en anglais.
- Toute info externe (notes de patch, champs HearthstoneJSON, règles) : citer la source en commentaire ou dans `docs/`.

## Règles non négociables

1. **Logs, plus lecture de l'écran limitée.** Source principale : les fichiers de log. Interdit : lecture mémoire du processus, injection, hook DLL, modification des fichiers du jeu, automatisation d'inputs. **Assouplie par l'utilisateur le 20/10/2026** : la capture de la fenêtre du jeu + OCR est permise UNIQUEMENT pour des infos que le jeu affiche au joueur et que le log ne contient pas (tribus de la partie, MMR), en opt-in (désactivée par défaut), traitement 100 % local, aucune image conservée ni envoyée.
2. **Fair play.** Aucune info invisible en jeu normal (mains cachées, boutiques adverses, entités masquées). Une seule couche de filtrage entre parseur et UI, couverte par un test automatisé.
3. **Pas d'assets Blizzard** dans le dépôt ni l'installeur. Données/images depuis HearthstoneJSON au runtime, en cache. Disclaimer « non affilié à Blizzard Entertainment » (README + écran À propos).
4. **Pas de scraping** de données propriétaires/payantes. Stats externes via l'interface `StatsProvider` ; défaut = historique local.
5. **Vie privée.** Tout local, aucune télémétrie par défaut, tout envoi réseau optionnel désactivé par défaut et documenté.
6. **Ne jamais deviner** noms de tags, champs HearthstoneJSON ou règles du jeu : vérifier dans les sources ou demander un log réel. Fin de partie hors cas observé, Duos, anomalies, quêtes, reconnexion : points d'extension seulement, en attendant un log.

## Faits établis sur le format (détails et sources dans `docs/log-format.md` — le tenir à jour)

- UTF-8, CRLF, lignes `D hh:mm:ss.fffffff <Source>.<Méthode>() - <message>` ; date dans le nom du dossier `Hearthstone_AAAA_MM_JJ_hh_mm_ss`.
- Source retenue : `GameState.DebugPrintPower()`. `PowerTaskList.DebugPrintPower()` duplique les mêmes événements : ne jamais compter les deux.
- PlayerID variables d'une partie à l'autre : jamais en dur. Joueur local = `GameAccountId` non nul.
- Tags inconnus affichés en numérique (`tag=3085`) : garder le brut, jamais d'exception.
- Place finale = dernière `PLAYER_LEADERBOARD_PLACE` du héros local à l'élimination. `PLAYSTATE=LOST` ne veut pas dire hors top 4.
- Tribus du lobby non annoncées : déduction progressive avec niveau de confiance. `CARDRACE` et `BACON_SUBSET_` lus tous les deux, normalisés (QUILBOAR→QUILLBOAR, MECHANICAL→MECH, ELEMENTAL→ELEMENTALS). Aberrations = type de serviteur, pas des anomalies.
- Issues de partie : `finished`, `interrupted` (fin de flux sans fin de partie), `abandoned` (heuristique : fin de flux + dernier événement = place 8 du héros local ; la place 8 n'est jamais un classement). Exclure `abandoned`/`interrupted` des moyennes (M6).
- **Fair-play temporel** : `GameState` connaît l'issue d'un combat 8 à 48 s avant l'animation. L'UI ne lit QUE `pipeline.displayed` (instantané libéré par les repères `PowerTaskList`, `power/markers.ts`) ; `pipeline.bg`/`state` servent à la chronologie et à l'historique. `PowerTaskList` = horloge uniquement, jamais de données.
- Troncature : `Truncating log, which has reached the size limit of 10000KB` → ne jamais remettre l'état à zéro ; avertir.
- `TURN` GameEntity impair = recrutement, pair = combat. Joueurs du lobby = entités HERO avec `PLAYER_ID` + `PLAYER_LEADERBOARD_PLACE` (copies de combat ignorées).
- Seulement 2 entités `Player` : le local et un emplacement « dummy » renommé (`Bob le barman`, puis le nom de l'adversaire en combat, avec décalage). Adversaire = `BACON_CURRENT_COMBAT_PLAYER_ID` sur le dummy.

## Jalons

M0 scaffold/CI ✅ · M1 parseur + GameState + replay ✅ · M2 overlay minimal + filtre fair-play ✅ · M3 pool + tribus + navigateur ✅ · M4 mécaniques saisonnières ✅ · M5 simulateur ✅ · M6 SQLite + stats + replay de partie ✅ · M7 personnalisation, streamer, i18n, packaging ✅ · M8 docs.

Critère M1 : sur les deux fixtures, chronologie correcte (tours, combats et adversaires, tiers, places) ; partie complète → `TB_BaconShop_HERO_55`, place 3, tribus Dragon/Démons/Murloc/Mécas/Élémentaires ; log tronqué → avertissement sans crash.

## Pièges d'environnement

- **Avast** (antivirus de l'utilisateur) a mis `electron.exe` en quarantaine (`IDP.Generic`) quand l'overlay lançait un PowerShell masqué `-EncodedCommand` + `Add-Type user32`. Ne jamais réintroduire ce schéma : user32 passe par koffi. Si `node_modules/electron/dist/electron.exe` manque : `node node_modules/electron/install.js` dans `apps/overlay` (pnpm bloque parfois le script d'installation).
- Les binaires Electron et esbuild sont dans `onlyBuiltDependencies` (pnpm-workspace.yaml). La CI pose `ELECTRON_SKIP_BINARY_DOWNLOAD=1`.
- `koffi` charge son binaire depuis le paquet optionnel `@koromix/koffi-win32-x64` : `package.mjs` copie les deux (asarUnpack). Ne pas « simplifier » en ne copiant que `koffi`.
- `BGT_USER_DATA=<dossier>` : dossier de données séparé (réglages, historique, cache de cartes) pour les essais Electron, sans toucher aux réglages réels de l'utilisateur.
- **Ne jamais empaqueter en local** (ni `package` ni `package:dir`) : electron-builder liste les dépendances via `powershell.exe -EncodedCommand` et Avast bloque PowerShell (`IDP.HELU.PSE94`, 20/10/2026). L'installeur est construit par la CI (`windows-latest`), qui lance aussi `--ocr-selftest` sur l'appli empaquetée.
- Pas d'archive asar (`asar: false`) : les worker_threads (simulation, OCR) ne lisent pas l'intérieur d'une archive asar.
- Tests Electron en local : jamais d'exception non gérée (Electron affiche alors une boîte d'erreur sur l'écran de l'utilisateur).

## À demander à l'utilisateur au bon moment

- Fixture n°3 reçue (abandon, `bg-solo-2026-10-18-abandon`). Écart à lui signaler : il a mesuré « taverne 2 », le log montre le héros local à 1.
- Avant M4 : Aberrations / Naga présents dans ses parties actuelles ? (36.6.1 a ajouté les Aberrations et retiré les Naga ; la partie du 18/10 montre des Naga.)
- Avant le mode Duos : fixture n°4. L'utilisateur joue en Duos (log du 18/10/2026 19:07 sur sa machine, `GT_BATTLEGROUNDS_DUO`) : lui demander de l'anonymiser et de le fournir, ne jamais le copier soi-même.
