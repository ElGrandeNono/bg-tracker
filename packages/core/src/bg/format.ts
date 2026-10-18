import type { BgGame, TimelineEntry } from './bgGame.js';
import { remainingHealth } from './bgGame.js';
import { estimateLobbyTribes } from './tribes.js';

/** Rendu texte (console) de la chronologie d'une partie. Les noms de cartes arrivent en M3. */

export function formatClock(timeMs: number): string {
  const s = Math.floor(timeMs / 1000);
  const hh = String(Math.floor(s / 3600) % 24).padStart(2, '0');
  const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function who(bg: BgGame, playerId: number | undefined): string {
  if (playerId === undefined) return 'adversaire inconnu';
  if (playerId === bg.localPlayerId) return 'toi';
  const p = bg.players[playerId];
  const name = p?.name ?? `joueur ${playerId}`;
  return p === undefined ? name : `${name} (${p.heroCardId})`;
}

export function formatEntry(bg: BgGame, e: TimelineEntry): string | undefined {
  const at = `[${formatClock(e.timeMs)}]`;
  switch (e.kind) {
    case 'gameStart':
      return `${at} Début de partie, build ${e.build ?? '?'}`;
    case 'heroPicked':
      return `${at} Héros choisi : ${e.cardId}`;
    case 'recruit':
      return `${at} ── Tour ${e.round} : recrutement`;
    case 'combatStart':
      return `${at}    Combat ${e.round} contre ${who(bg, e.opponentPlayerId)}`;
    case 'combatEnd': {
      const ranking = Object.entries(e.places)
        .sort((a, b) => a[1] - b[1])
        .map(([pid, place]) => `${place}.${Number(pid) === bg.localPlayerId ? 'toi' : `j${pid}`}`)
        .join(' ');
      const hp = e.localHealth === undefined ? '' : `, PV ${e.localHealth}`;
      return `${at}    Fin du combat ${e.round}${hp} | classement ${ranking}`;
    }
    case 'techLevel':
      return `${at}    Taverne ${e.level} : ${who(bg, e.playerId)}`;
    case 'triple':
      return e.playerId === bg.localPlayerId ? `${at}    Triple n°${e.total} : toi` : undefined;
    case 'eliminated':
      return `${at} Éliminé, place finale ${e.place ?? '?'}`;
    case 'gameOver':
      return `${at} Fin de partie`;
    case 'truncated':
      return `${at} ⚠ Log tronqué par le jeu (ligne ${e.line}) : état possiblement incomplet`;
  }
}

export function formatSummary(bg: BgGame): string {
  const local = bg.localPlayerId === undefined ? undefined : bg.players[bg.localPlayerId];
  const lobby = estimateLobbyTribes(bg.tribes);
  const tribes = lobby.tribes
    .map((t) => `${t.identified ? '✓' : '·'} ${t.tribe} (${t.distinctCards})`)
    .join(', ');
  const lines = [
    '═══ Résumé ═══',
    `Mode : ${bg.isBattlegrounds ? 'Battlegrounds' : 'autre'} · build ${bg.build ?? '?'}`,
    `Héros : ${local?.heroCardId ?? '?'}`,
    `Place finale : ${bg.finalPlace ?? (bg.truncated ? 'inconnue (log tronqué)' : 'partie non terminée')}`,
    `Taverne : ${local?.techLevel ?? '?'} · triples : ${local?.triples ?? 0} · PV : ${remainingHealth(local) ?? '?'}`,
    `Tours : ${bg.round} · combats : ${bg.combats.length}`,
    `Tribus du lobby : ${lobby.identified.length}/${lobby.expected} identifiées — ${tribes}`,
    'Joueurs :',
    ...Object.values(bg.players)
      .sort((a, b) => (a.place ?? 9) - (b.place ?? 9))
      .map(
        (p) =>
          `  ${p.place ?? '?'}. ${p.isLocal ? 'toi' : (p.name ?? `joueur ${p.playerId}`)} · ${p.heroCardId} · taverne ${p.techLevel ?? '?'}`,
      ),
  ];
  if (bg.truncated) lines.push('⚠ Log tronqué : état possiblement incomplet.');
  return lines.join('\n');
}
