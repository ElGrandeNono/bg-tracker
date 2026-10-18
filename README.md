# BG Tracker

Tracker pour **Hearthstone Battlegrounds** : overlay en jeu, suivi du lobby et des adversaires, pool de serviteurs, simulateur de combat et historique local de parties.

> **Non affilié à Blizzard Entertainment.** Hearthstone et Battlegrounds sont des marques de Blizzard Entertainment, Inc. Aucun asset Blizzard n'est inclus dans ce dépôt ni dans l'installeur : les données de cartes et les images sont téléchargées au runtime depuis [HearthstoneJSON](https://hearthstonejson.com/) et mises en cache localement.

État : **M0 (scaffold)**. Rien n'est encore utilisable en jeu.

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
