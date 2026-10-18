# Architecture

BG Tracker est un monorepo pnpm en TypeScript strict. Le principe directeur : **un seul pipeline**, alimenté soit par le jeu en direct, soit par un log enregistré (mode replay), et **un seul point de sortie vers l'UI**, le filtre de visibilité.

```
            ┌──────────────┐   ┌────────────┐   ┌──────────────┐   ┌───────────┐
Power.log ─▶│  LogWatcher  │──▶│ PowerParser│──▶│  GameState   │──▶│  BgGame   │
 (direct)   │ tail, tronc. │   │  tolérant  │   │ (immuable,   │   │ (tours,   │
            └──────────────┘   └────────────┘   │  entités)    │   │ combats…) │
 fichier ──▶ replayFile ────────────▲            └──────┬───────┘   └─────┬─────┘
 .log/.gz/.zip (vitesse réglable)                       │                 │
                                                        ▼                 ▼
                                     pipeline.displayed : instantané retenu tant que
                                     PowerTaskList (rythme d'animation) n'a pas rattrapé
                                                        │
                                               ┌────────────────────────────────┐
                                               │ buildVisibleView (FILTRE       │
                                               │ FAIR-PLAY, liste blanche)      │
                                               └───────────────┬────────────────┘
                                                               ▼
                                         IPC (preload contextBridge) ▶ overlay React
                                         (plus tard : dashboard, stream, plugins)
```

## Paquets

| Paquet             | Rôle                                                                                                                                                           | Dépendances                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `packages/core`    | ligne → événements Power → état des entités → modèle BG → vue filtrée ; LogWatcher ; replay ; vérification de `log.config` / `client.config` (fonctions pures) | `fflate` (lecture `.zip`)                  |
| `packages/data`    | données de cartes HearthstoneJSON, cache par build, repli hors ligne ; catalogue du pool solo                                                                  | `@bgt/core`                                |
| `packages/sim`     | simulateur de combat Monte Carlo : moteur, registre d'effets par carte, worker threads                                                                         | aucune (`@bgt/core` en dev pour les tests) |
| `packages/history` | historique local SQLite (`node:sqlite`), enregistreur de parties depuis la vue filtrée, statistiques, import des anciens logs                                  | `@bgt/core`                                |
| `seasons/s14`      | règles de la saison 14 (pool : copies, emplacements, tribus hors rotation) ; mécaniques en M4 ; rien de saisonnier dans `core`                                 | `@bgt/core`                                |
| `apps/overlay`     | Electron : processus principal (pipeline, suivi de fenêtre, raccourcis, réglages), preload, renderer React                                                     | `electron`, `koffi`, `react`               |

## Choix et invariants

- **Source unique `GameState.DebugPrintPower()`** : jamais `PowerTaskList` en plus (doublons). Voir [log-format.md](log-format.md).
- **Immutabilité** : `reduceGameState` et `reduceBgGame` sont des fonctions pures. Les entités sont dans un trie persistant (`IdMap`, 2 niveaux de 256) : une écriture copie ~512 cases au lieu de toute la table, ce qui rejoue 440 000 lignes en ~3 s.
- **Tolérance** : une ligne inconnue est comptée dans `parser.diagnostics` puis ignorée ; un tag inconnu est gardé tel quel ; une troncature ne remet jamais l'état à zéro.
- **Fair play** : `GameState` contient des informations cachées. Seule `buildVisibleView` (liste blanche) produit ce que voit l'UI. Le test `visibility/view.test.ts` rejoue les trois fixtures réelles et vérifie, avec un oracle indépendant, que toute carte de la vue a été montrée au joueur ; aucun identifiant d'entité ne sort.
- **Fair play temporel** : `GameState` connaît l'issue d'un combat 8 à 48 s avant que le client ne l'anime. L'UI lit `pipeline.displayed`, un instantané libéré au rythme des repères affichés par `PowerTaskList` (qui ne fournit aucune donnée). Voir [log-format.md](log-format.md#décalage-daffichage-des-combats-f2-f4--enjeu-fair-play).
- **Pool de serviteurs** : la vue filtrée liste les serviteurs VUS hors du pool (`poolSightings` : main, plateau, boutique, plateaux adverses) ; `computePool` (pur) applique les règles de saison au catalogue ; probabilités par loi hypergéométrique. Tout est une estimation : le tracker ne voit ni les boutiques ni les mains adverses.
- **Navigateur de serviteurs** : fenêtre classique (Ctrl+Maj+B), même renderer (route `#browser`), même pont IPC ; catalogue envoyé une fois par build (`bgt:catalog`).
- **Simulateur** : entrée construite depuis la vue filtrée (plateaux affichés : combat en cours, ou dernier plateau vu du prochain adversaire) ; 10 000 combats en worker threads, résultats publiés par tranches, relancé seulement quand les plateaux changent. Voir [simulator-coverage.md](simulator-coverage.md).
- **Historique** : `GameRecorder` observe les vues affichées (donc filtrées) et livre un `GameRecord` (héros, place, issue, tribus, durée, replay par tour des plateaux vus) à la fin de la partie ; `HistoryStore` (SQLite via `node:sqlite`, sans module natif) dédoublonne par clé build + date + héros et complète une partie interrompue sans écraser les saisies du joueur. Les statistiques excluent les parties abandonnées ou interrompues. Tableau de bord : fenêtre `#dashboard`.
- **Mode de jeu** : seul le solo (`GT_BATTLEGROUNDS`) est pris en charge ; Duos et modes inconnus n'affichent qu'un avertissement (jamais d'info fausse sans avertissement).
- **Issue de partie** : `finished` (élimination ou `STATE=COMPLETE`) ou `interrupted` (fin du flux ou nouvelle partie sans événement de fin : abandon, troncature). Jamais de place finale inventée.

## Overlay (Electron)

- Fenêtre transparente, sans cadre, toujours au-dessus, **click-through** (`setIgnoreMouseEvents(true, { forward: true })`), non focusable, calée sur la zone client de la fenêtre Hearthstone.
- **Suivi de la fenêtre du jeu** par appels `user32` directs (FFI `koffi`) : `FindWindowW` (titre `Hearthstone`, classe `UnityWndClass`), `GetClientRect`, `ClientToScreen`, `IsIconic`, `GetForegroundWindow`. C'est de l'information du gestionnaire de fenêtres, pas de la mémoire du jeu. L'overlay se masque quand le jeu n'est pas au premier plan. Une première version utilisait un PowerShell masqué avec `-EncodedCommand` : Avast a mis `electron.exe` en quarantaine (`IDP.Generic`, détection comportementale). Ce schéma est proscrit.
- **Plein écran** : impossible de distinguer exclusif et fenêtré sans bordure depuis l'extérieur ; si la fenêtre couvre l'écran et que `options.txt` contient `graphicsfullscreen=True`, l'overlay affiche un conseil (passer en fenêtré ou plein écran fenêtré).
- **Sécurité** : `contextIsolation`, `sandbox`, pas de `nodeIntegration` ; preload à 4 canaux typés ; CSP stricte injectée au build (`default-src 'none'`, aucun script distant, `connect-src 'none'`) ; navigation, `window.open`, webviews et permissions refusés.
- **Latence** : LogWatcher en polling à 100 ms + regroupement des envois à 100 ms → < 300 ms du log à l'écran.
- **Réglages** (`overlay-settings.json` dans le dossier utilisateur) : opacité, compact, thème, échelle, position des panneaux en fraction de la fenêtre. Toujours verrouillé au démarrage.
- **Raccourcis** : Ctrl+Maj+H afficher/masquer · Ctrl+Maj+U déverrouiller (déplacer les panneaux, la souris est alors capturée) · Ctrl+Maj+O opacité · Ctrl+Maj+C compact.

## Réseau

Seul accès réseau : téléchargement des données de cartes depuis `api.hearthstonejson.com` (nécessaire, aucune donnée utilisateur envoyée). Aucune télémétrie.
