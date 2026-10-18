import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import type { VisibleMinion, VisiblePlayer, VisibleView } from '@bgt/core';
import type {
  BgtBridge,
  OverlayPayload,
  OverlaySettings,
  PanelPosition,
} from '../shared/payload.js';
import { HS_WINDOW_MESSAGES, KEYWORD_LABELS, PHASE_LABELS, TRIBE_LABELS } from './strings.js';

type Names = OverlayPayload['names'];

const nameOf = (names: Names, id: string | undefined): string =>
  id === undefined ? '?' : (names[id] ?? id);

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => {
      clearInterval(t);
    };
  }, [active]);
  return now;
}

// ------------------------------------------------------------------ panneau déplaçable

function Panel(props: {
  id: keyof OverlaySettings['panels'];
  position: PanelPosition;
  locked: boolean;
  onMove: (id: keyof OverlaySettings['panels'], p: PanelPosition) => void;
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [pos, setPos] = useState(props.position);
  useEffect(() => {
    setPos(props.position);
  }, [props.position]);

  const onDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (props.locked) return;
    const rect = e.currentTarget.getBoundingClientRect();
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (drag.current === null) return;
    setPos({
      x: Math.min(0.98, Math.max(0, (e.clientX - drag.current.dx) / window.innerWidth)),
      y: Math.min(0.98, Math.max(0, (e.clientY - drag.current.dy) / window.innerHeight)),
    });
  };
  const onUp = (): void => {
    if (drag.current === null) return;
    drag.current = null;
    props.onMove(props.id, pos);
  };
  // Le panneau reste toujours entièrement dans la fenêtre, quelle que soit sa taille.
  const style: CSSProperties = {
    left: `min(${pos.x * 100}%, calc(100% - var(--w, 0px) - 4px))`,
    top: `min(${pos.y * 100}%, calc(100% - var(--h, 0px) - 4px))`,
  };
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const ro = new ResizeObserver(() => {
      el.style.setProperty('--w', `${el.offsetWidth}px`);
      el.style.setProperty('--h', `${el.offsetHeight}px`);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);
  return (
    <div
      ref={ref}
      className={`panel ${props.locked ? '' : 'panel--unlocked'} ${props.className ?? ''}`}
      style={style}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      {props.children}
    </div>
  );
}

// ------------------------------------------------------------------ barre du joueur

function formatTimer(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function TopBar({ p, now }: { p: OverlayPayload; now: number }): React.JSX.Element {
  const { view } = p;
  const l = view.local;
  const remaining = p.timerEndsAt === undefined ? undefined : p.timerEndsAt - now;
  return (
    <div className="bar">
      <span className="bar__item bar__round">
        Tour <b>{view.round || '–'}</b>
        <small>{PHASE_LABELS[view.phase]}</small>
      </span>
      <span className="bar__item" title="Niveau de taverne · coût de l’amélioration">
        Taverne <b>{l.techLevel ?? '–'}</b>
        {l.upgradeCost !== undefined && l.techLevel !== 6 && (
          <small className="bar__upgrade">↑ {l.upgradeCost}</small>
        )}
      </span>
      <span className="bar__item bar__gold" title="Or disponible / or du tour">
        <b>{l.gold ?? '–'}</b>
        <small>/ {l.maxGold ?? '–'} or</small>
      </span>
      {remaining !== undefined && (
        <span
          className={`bar__item bar__timer ${remaining < 10_000 ? 'bar__timer--low' : ''}`}
          title="Minuteur estimé à partir du log"
        >
          ⏱ <b>{formatTimer(remaining)}</b>
        </span>
      )}
      <span className="bar__item" title="Points de vie · armure">
        ♥ <b>{l.health ?? '–'}</b>
        {l.armor !== undefined && l.armor > 0 && <small>+{l.armor}</small>}
      </span>
      <span className="bar__item" title="Triples réalisés">
        ✦ <b>{l.triples ?? 0}</b>
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ lobby

function Minion({ m, names }: { m: VisibleMinion; names: Names }): React.JSX.Element {
  return (
    <li className={`minion ${m.golden ? 'minion--golden' : ''}`} title={nameOf(names, m.cardId)}>
      <span className="minion__name">{nameOf(names, m.cardId)}</span>
      <span className="minion__stats">
        <b className="atk">{m.attack ?? '?'}</b>/<b className="hp">{m.health ?? '?'}</b>
      </span>
      {m.keywords.length > 0 && (
        <span className="minion__kw">
          {m.keywords.map((k) => (
            <abbr key={k} title={KEYWORD_LABELS[k].long}>
              {KEYWORD_LABELS[k].short}
            </abbr>
          ))}
        </span>
      )}
    </li>
  );
}

function PlayerRow({
  pl,
  names,
  compact,
}: {
  pl: VisiblePlayer;
  names: Names;
  compact: boolean;
}): React.JSX.Element {
  const cls = [
    'row',
    pl.isLocal ? 'row--local' : '',
    pl.isNextOpponent ? 'row--next' : '',
    pl.isCurrentOpponent ? 'row--current' : '',
    pl.health !== undefined && pl.health <= 0 ? 'row--dead' : '',
  ].join(' ');
  return (
    <li className={cls}>
      <span className="row__place">{pl.place ?? '·'}</span>
      <span className="row__hero">
        {nameOf(names, pl.heroCardId)}
        {!compact && pl.name !== undefined && !pl.isLocal && <small> · {pl.name}</small>}
        {pl.isLocal && <small> · toi</small>}
      </span>
      <span className="row__tier" title="Niveau de taverne">
        {pl.techLevel ?? '–'}
      </span>
      <span className="row__hp" title="Points de vie">
        {pl.health ?? '–'}
      </span>
      {!compact && (
        <span className="row__triples" title="Triples">
          {pl.triples ? `✦${pl.triples}` : ''}
        </span>
      )}
      <span className="row__mark">{pl.isCurrentOpponent ? '⚔' : pl.isNextOpponent ? '▶' : ''}</span>
    </li>
  );
}

function Lobby({ p }: { p: OverlayPayload }): React.JSX.Element {
  const { view, names, settings } = p;
  const focus =
    view.players.find((x) => x.isCurrentOpponent) ?? view.players.find((x) => x.isNextOpponent);
  return (
    <div className="lobby">
      <ol className="rows">
        {view.players.map((pl) => (
          <PlayerRow key={pl.playerId} pl={pl} names={names} compact={settings.compact} />
        ))}
      </ol>
      {!settings.compact && <Tribes view={view} />}
      {!settings.compact && <PoolSummary p={p} />}
      {focus !== undefined && (
        <section className="board">
          <h3>
            {focus.isCurrentOpponent ? 'Adversaire' : 'Prochain adversaire'} :{' '}
            {nameOf(names, focus.heroCardId)}
          </h3>
          {focus.lastBoard === undefined ? (
            <p className="muted">Plateau jamais vu</p>
          ) : (
            <>
              <p className="muted">Plateau vu au tour {focus.lastBoard.round}</p>
              <ol className="minions">
                {focus.lastBoard.minions.map((m, i) => (
                  <Minion key={`${m.cardId}-${i}`} m={m} names={names} />
                ))}
              </ol>
            </>
          )}
        </section>
      )}
    </div>
  );
}

/** Restants du pool aux niveaux accessibles (estimation : cartes vues uniquement). */
function PoolSummary({ p }: { p: OverlayPayload }): React.JSX.Element | null {
  const pool = p.pool;
  if (pool === undefined) return null;
  const maxTier = Math.min(7, (p.view.local.techLevel ?? 1) + 1);
  const tiers = pool.tiers.filter((t) => t.tier <= maxTier && t.cards > 0);
  return (
    <p
      className="pool"
      title="Exemplaires restants au plus (cartes vues retirées) · Ctrl+Maj+B : navigateur"
    >
      Pool{!pool.lobbyComplete && ' (lobby incertain)'} :{' '}
      {tiers.map((t) => (
        <span key={t.tier} className={t.verified ? '' : 'pool--unverified'}>
          N{t.tier} <b>{Math.round((t.remaining / Math.max(1, t.total)) * 100)}%</b>{' '}
        </span>
      ))}
    </p>
  );
}

function Tribes({ view }: { view: VisibleView }): React.JSX.Element {
  const t = view.tribes;
  return (
    <p className="tribes" title="Tribus déduites des serviteurs vus (le jeu ne les annonce pas)">
      Tribus {t.identified.length}/{t.expected} :{' '}
      {t.identified.length === 0 ? '…' : t.identified.map((x) => TRIBE_LABELS[x] ?? x).join(', ')}
    </p>
  );
}

// ------------------------------------------------------------------ messages

function Notices({ p }: { p: OverlayPayload }): React.JSX.Element | null {
  const msgs: string[] = [];
  const hs = HS_WINDOW_MESSAGES[p.status.hsWindow];
  if (p.status.source === 'live' && hs !== undefined) msgs.push(hs);
  if (p.status.configProblems.length > 0) {
    msgs.push(`Configuration du jeu incomplète : ${p.status.configProblems.join(', ')}`);
  }
  if (p.view.isBattlegrounds && p.view.mode === 'duos') {
    msgs.push(
      'Mode Duos détecté : pas encore pris en charge (il faut d’abord un log Duos anonymisé). Rien n’est affiché pour éviter des infos fausses.',
    );
  } else if (p.view.isBattlegrounds && p.view.mode === 'unknown') {
    msgs.push('Mode Battlegrounds non reconnu : rien n’est affiché pour éviter des infos fausses.');
  }
  if (p.view.warnings.includes('truncated')) {
    msgs.push('Log tronqué par le jeu : état possiblement incomplet.');
  }
  if (p.view.warnings.includes('interrupted'))
    msgs.push('Partie interrompue : aucune fin de partie dans le log.');
  if (p.view.warnings.includes('abandoned')) msgs.push('Partie abandonnée : pas de place finale.');
  if (p.status.cardData === 'stale')
    msgs.push('Données de cartes d’un autre patch : noms possiblement inexacts.');
  if (p.status.cardData === 'error') msgs.push('Données de cartes indisponibles (hors ligne ?).');
  if (!p.settings.locked)
    msgs.push('Mode déplacement : glissez les panneaux, Ctrl+Maj+U pour verrouiller.');
  if (msgs.length === 0) return null;
  return (
    <ul className="notices">
      {msgs.map((m) => (
        <li key={m}>{m}</li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ application

export function App({ bridge }: { bridge: BgtBridge }): React.JSX.Element | null {
  const [payload, setPayload] = useState<OverlayPayload | undefined>();
  useEffect(() => {
    const off = bridge.onUpdate(setPayload);
    bridge.ready();
    return off;
  }, [bridge]);
  useEffect(() => {
    if (payload !== undefined)
      requestAnimationFrame(() => {
        bridge.rendered();
      });
  }, [bridge, payload]);
  const now = useNow(payload?.timerEndsAt !== undefined);

  if (payload === undefined) return null;
  const { settings, view } = payload;
  // Seul le mode solo est vérifié : en Duos (ou mode inconnu), rien d'autre qu'un avertissement.
  const solo = view.isBattlegrounds && view.mode === 'solo';
  const onMove = (id: keyof OverlaySettings['panels'], pos: PanelPosition): void => {
    bridge.saveLayout({ ...settings.panels, [id]: pos });
  };
  const rootStyle = {
    '--opacity': settings.opacity,
    '--scale': settings.scale,
  } as CSSProperties;

  return (
    <div
      className={`overlay theme-${settings.theme} ${settings.backdrop ? 'overlay--backdrop' : ''}`}
      style={rootStyle}
      hidden={settings.hidden}
    >
      <Notices p={payload} />
      {solo && view.outcome !== 'finished' && (
        <>
          <Panel id="bar" position={settings.panels.bar} locked={settings.locked} onMove={onMove}>
            <TopBar p={payload} now={now} />
          </Panel>
          <Panel
            id="lobby"
            position={settings.panels.lobby}
            locked={settings.locked}
            onMove={onMove}
          >
            <Lobby p={payload} />
          </Panel>
        </>
      )}
      {solo && view.outcome === 'finished' && (
        <Panel id="lobby" position={settings.panels.lobby} locked={settings.locked} onMove={onMove}>
          <div className="final">
            Place finale <b>{view.finalPlace ?? '?'}</b>
          </div>
          <Lobby p={payload} />
        </Panel>
      )}
    </div>
  );
}
