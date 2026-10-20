# BG Tracker

Tracker pour **Hearthstone Battlegrounds** : overlay en jeu, suivi du lobby et des adversaires, pool de serviteurs, simulateur de combat et historique local de parties.

> **Non affilié à Blizzard Entertainment.** Hearthstone et Battlegrounds sont des marques de Blizzard Entertainment, Inc. Aucun asset Blizzard n'est inclus dans ce dépôt ni dans l'installeur : les données de cartes et les images sont téléchargées au runtime depuis [HearthstoneJSON](https://hearthstonejson.com/) et mises en cache localement.

État : **M7**. Overlay en jeu (Battlegrounds **solo** uniquement ; le Duos affiche un avertissement) : tour, taverne et coût d'amélioration, or, minuteur, PV, triples, classement des 8 joueurs, prochain adversaire et son dernier plateau vu, tribus du lobby déduites, mécaniques de la saison 14 (**bibelots**, **Sombres dons**, **Activations**, bonus des sorts de taverne, Divinité), **simulateur de combat** (victoire / égalité / défaite, létal, dégâts ; marqué « approximatif » quand une carte n'est pas simulée, voir [docs/simulator-coverage.md](docs/simulator-coverage.md)), **pool de serviteurs estimé** et **navigateur de serviteurs** (Ctrl+Maj+B), **historique et statistiques** (Ctrl+Maj+D). Interface en **français ou anglais**, thèmes sombre, clair et **contraste élevé** (adapté au daltonisme), taille du texte réglable, sections masquables, **alertes** configurables et **mode streamer** pour OBS (Ctrl+Maj+P : réglages). Rien n'est affiché avant que le jeu ne l'ait montré (les combats sont connus du log avant leur animation). Architecture : [docs/architecture.md](docs/architecture.md) ; format du log : [docs/log-format.md](docs/log-format.md).

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

## Disposition de l'overlay

- **En haut au milieu** : probabilités du combat en cours ou à venir (létal · victoire · égalité · défaite · létal).
- **À gauche** : icônes des tribus du lobby (« ? » = probable ; ✎ pour cocher les 5 tribus que le jeu affiche « Dans cette partie », le log ne les contenant pas), classement des joueurs (PV + armure), mécaniques de saison avec l'image de la divinité de la partie, dernier plateau du prochain adversaire (bouton « Voir »).
- **En haut à droite** : tour, taverne, or, minuteur, PV, triples, et trois boutons cliquables : serviteurs et probabilités, historique, réglages.
- **À droite du pouvoir héroïque** (recrutement) : rafraîchissements gratuits, bonus des gemmes de sang, bonus des sorts de taverne, bonus des serviteurs de la taverne (calculés d'après la boutique affichée).

Chaque panneau se déplace (Ctrl+Maj+U) et se masque (Réglages › Sections). Options désactivées par défaut : ligne « Pool par niveau », heure, simulation masquée tant qu'on ne clique pas dessus.

## Installer

Téléchargez `BG-Tracker-Setup-<version>.exe` depuis les [releases GitHub](https://github.com/ElGrandeNono/bg-tracker/releases) (installation par utilisateur, sans droits administrateur). L'installeur **n'est pas signé** (une signature exige un certificat de signature de code payant) : Windows SmartScreen affiche « Windows a protégé votre ordinateur » ; cliquez sur « Informations complémentaires » puis « Exécuter quand même ». Le code de l'installeur est construit par la CI publique à partir de ce dépôt (`.github/workflows/release.yml`).

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
| Ctrl+Maj+P | réglages : langue, thème, opacité, taille, sections, alertes, mode streamer, mises à jour, à propos                   |

Rejouer un log enregistré dans une fenêtre autonome : `pnpm overlay:replay <fichier.log|.gz|.zip> --speed 10`.

**Pool de serviteurs** : les exemplaires restants et les probabilités sont des **estimations** fondées uniquement sur ce que vous voyez (votre main, votre plateau, la boutique, les plateaux adverses vus en combat). Le pool réel est plus petit. Les règles (copies par niveau, emplacements de boutique) viennent du wiki et sont vérifiées sur des logs réels quand c'est possible : voir `seasons/s14/src/poolRules.ts`.

**Historique** : chaque partie suivie en direct est enregistrée localement (`history.sqlite` dans le dossier de l'application). Les parties abandonnées ou interrompues sont listées mais exclues des moyennes. Le MMR n'est pas dans les logs : saisie manuelle facultative. Le bouton « Importer les anciens logs » rejoue les sessions conservées dans `Logs/` par le jeu.

**Alertes** (Réglages › Alertes) : début du tour, minuteur sous 10 secondes, triple réalisable (deux exemplaires à vous et le troisième en boutique), tribus du lobby identifiées ; son facultatif (bip synthétisé, aucun fichier audio).

**Mode streamer** (Réglages › Mode streamer, désactivé par défaut) : un petit serveur local sert l'overlay à OBS. Ajoutez une « source navigateur » d'URL `http://127.0.0.1:5280/?obs` (port réglable), à la taille de votre capture du jeu. Le serveur n'écoute que sur `127.0.0.1` (jamais sur le réseau) ; options : masquer les pseudos adverses (activé par défaut), la simulation de combat, le pool. Les spectateurs voient exactement ce que vous voyez, jamais plus.

**Réseau** :

- Données de cartes et illustrations des icônes de tribus : téléchargées depuis HearthstoneJSON (mises en cache localement, jamais incluses dans l'installeur). Seul accès indispensable ; aucune donnée personnelle n'est envoyée.
- Vérification des mises à jour (**désactivée par défaut**, Réglages › Mises à jour) : interroge les releases GitHub de ce dépôt au démarrage ; rien n'est téléchargé sans votre accord.
- Mode streamer (**désactivé par défaut**) : serveur local uniquement, aucune connexion sortante.
- Aucune télémétrie.

**Antivirus** : l'overlay suit la position de la fenêtre du jeu via les fonctions standard de Windows (`user32`). Il ne lit jamais la mémoire du jeu.

## Développement

Prérequis : Node ≥ 22, pnpm 10.

```bash
pnpm install
```

```bash
pnpm test
```

Construire l'installeur Windows en local (après `pnpm build`) :

```bash
pnpm --filter @bgt/overlay package
```

Voir [CLAUDE.md](CLAUDE.md) pour les commandes et conventions.

## Licence

[MIT](LICENSE).
