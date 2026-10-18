# BG Tracker

Tracker pour **Hearthstone Battlegrounds** : overlay en jeu, suivi du lobby et des adversaires, pool de serviteurs, simulateur de combat et historique local de parties.

> **Non affilié à Blizzard Entertainment.** Hearthstone et Battlegrounds sont des marques de Blizzard Entertainment, Inc. Aucun asset Blizzard n'est inclus dans ce dépôt ni dans l'installeur : les données de cartes et les images sont téléchargées au runtime depuis [HearthstoneJSON](https://hearthstonejson.com/) et mises en cache localement.

État : **M6**. Overlay en jeu (Battlegrounds **solo** uniquement ; le Duos affiche un avertissement) : tour, taverne et coût d'amélioration, or, minuteur, PV, triples, classement des 8 joueurs, prochain adversaire et son dernier plateau vu, tribus du lobby déduites, mécaniques de la saison 14 (**bibelots**, **Sombres dons**, **Activations**, bonus des sorts de taverne, Divinité), **simulateur de combat** (victoire / égalité / défaite, létal, dégâts ; marqué « approximatif » quand une carte n'est pas simulée, voir [docs/simulator-coverage.md](docs/simulator-coverage.md)), **pool de serviteurs estimé** et **navigateur de serviteurs** (Ctrl+Maj+B). Rien n'est affiché avant que le jeu ne l'ait montré (les combats sont connus du log avant leur animation). Architecture : [docs/architecture.md](docs/architecture.md) ; format du log : [docs/log-format.md](docs/log-format.md).

## Principes

- **Lecture des fichiers de log uniquement** (`Power.log`). Pas de lecture mémoire, pas d'injection, pas d'automatisation, pas d'OCR.
- **Fair play** : n'affiche que ce qu'un joueur peut voir en jouant normalement.
- **Vie privée** : tout est local, aucune télémétrie.

## Activer les logs du jeu

1. `%LOCALAPPDATA%\Blizzard\Hearthstone\log.config` doit contenir :
   ```ini
   [Power]
   LogLevel=1
   FilePrinting=true
   ConsolePrinting=false
   ScreenPrinting=false
   Verbose=true
   ```
2. Par défaut le jeu tronque `Power.log` à 10 000 Ko (vers le tour 13 d'une partie). Pour lever la limite, créez ou complétez `client.config` **à la racine du dossier d'installation du jeu** (ex. `C:\Program Files (x86)\Hearthstone\client.config`, droits administrateur possibles) :
   ```ini
   [Log]
   FileSizeLimit.Int=-1
   ```
   Effet vérifié : une partie complète de 27 min (61 Mo) écrite sans troncature.

L'application proposera de faire ces deux réglages pour vous, avec votre accord.

## Utiliser l'overlay

Le jeu doit être en mode **fenêtré** ou **plein écran fenêtré** : un overlay ne peut pas s'afficher au-dessus d'un plein écran exclusif.

```bash
pnpm overlay
```

| Raccourci  | Action                                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| Ctrl+Maj+H | afficher / masquer                                                                                                    |
| Ctrl+Maj+U | déverrouiller pour déplacer les panneaux (la souris est alors capturée), puis reverrouiller                           |
| Ctrl+Maj+O | opacité                                                                                                               |
| Ctrl+Maj+C | mode compact                                                                                                          |
| Ctrl+Maj+D | historique : statistiques, parties (MMR, notes, tags), replay tour par tour, export CSV/JSON, import des anciens logs |
| Ctrl+Maj+B | navigateur de serviteurs (recherche, tribus du lobby, exemplaires restants, probabilités)                             |

Rejouer un log enregistré dans une fenêtre autonome : `pnpm overlay:replay <fichier.log|.gz|.zip> --speed 10`.

**Pool de serviteurs** : les exemplaires restants et les probabilités sont des **estimations** fondées uniquement sur ce que vous voyez (votre main, votre plateau, la boutique, les plateaux adverses vus en combat). Le pool réel est plus petit. Les règles (copies par niveau, emplacements de boutique) viennent du wiki et sont vérifiées sur des logs réels quand c'est possible : voir `seasons/s14/src/poolRules.ts`.

**Historique** : chaque partie suivie en direct est enregistrée localement (`history.sqlite` dans le dossier de l'application). Les parties abandonnées ou interrompues sont listées mais exclues des moyennes. Le MMR n'est pas dans les logs : saisie manuelle facultative. Le bouton « Importer les anciens logs » rejoue les sessions conservées dans `Logs/` par le jeu.

**Réseau** : seul accès, le téléchargement des données de cartes depuis HearthstoneJSON (mis en cache par version du jeu). Aucune télémétrie.

**Antivirus** : l'overlay suit la position de la fenêtre du jeu via les fonctions standard de Windows (`user32`). Il ne lit jamais la mémoire du jeu.

## Développement

Prérequis : Node ≥ 22, pnpm 10.

```bash
pnpm install
```

```bash
pnpm test
```

Voir [CLAUDE.md](CLAUDE.md) pour les commandes et conventions.

## Licence

[MIT](LICENSE).
