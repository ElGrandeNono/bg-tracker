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
import { useI18n, type Messages } from './i18n.js';
import { useAlerts } from './alerts.js';

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
  const t = useI18n();
  const b = t.bar;
  return (
    <div className="bar">
      <span className="bar__item bar__round">
        {b.round} <b>{view.round || '–'}</b>
        <small>{t.phases[view.phase]}</small>
      </span>
      <span className="bar__item" title={b.tavernHint}>
        {b.tavern} <b>{l.techLevel ?? '–'}</b>
        {l.upgradeCost !== undefined && l.techLevel !== 6 && (
          <small className="bar__upgrade">↑ {l.upgradeCost}</small>
        )}
      </span>
      <span className="bar__item bar__gold" title={b.goldHint}>
        <b>{l.gold ?? '–'}</b>
        <small>
          / {l.maxGold ?? '–'} {b.gold}
        </small>
      </span>
      {remaining !== undefined && (
        <span
          className={`bar__item bar__timer ${remaining < 10_000 ? 'bar__timer--low' : ''}`}
          title={b.timerHint}
        >
          ⏱ <b>{formatTimer(remaining)}</b>
        </span>
      )}
      <span className="bar__item" title={b.healthHint}>
        ♥ <b>{l.health ?? '–'}</b>
        {l.armor !== undefined && l.armor > 0 && <small>+{l.armor}</small>}
      </span>
      <span className="bar__item" title={b.triplesHint}>
        ✦ <b>{l.triples ?? 0}</b>
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ lobby

function Minion({ m, names }: { m: VisibleMinion; names: Names }): React.JSX.Element {
  const t = useI18n();
  return (
    <li className={`minion ${m.golden ? 'minion--golden' : ''}`} title={nameOf(names, m.cardId)}>
      <span className="minion__name">{nameOf(names, m.cardId)}</span>
      <span className="minion__stats">
        <b className="atk">{m.attack ?? '?'}</b>/<b className="hp">{m.health ?? '?'}</b>
      </span>
      {m.keywords.length > 0 && (
        <span className="minion__kw">
          {m.keywords.map((k) => (
            <abbr key={k} title={t.keywords[k].long}>
              {t.keywords[k].short}
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
  const t = useI18n().lobby;
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
        {pl.isLocal && <small> · {t.you}</small>}
      </span>
      <span className="row__tier" title={t.tierHint}>
        {pl.techLevel ?? '–'}
      </span>
      <span
        className="row__hp"
        title={
          pl.health !== undefined && (pl.armor ?? 0) > 0
            ? t.healthArmor(pl.health, pl.armor ?? 0)
            : t.healthHint
        }
      >
        {pl.health === undefined ? '–' : pl.health + (pl.armor ?? 0)}
      </span>
      {!compact && (
        <span className="row__triples" title={t.triplesHint}>
          {pl.triples ? `✦${pl.triples}` : ''}
        </span>
      )}
      <span className="row__mark">{pl.isCurrentOpponent ? '⚔' : pl.isNextOpponent ? '▶' : ''}</span>
    </li>
  );
}

function Lobby({ p }: { p: OverlayPayload }): React.JSX.Element {
  const { view, names, settings } = p;
  const s = settings.sections;
  const t = useI18n().lobby;
  const focus =
    view.players.find((x) => x.isCurrentOpponent) ?? view.players.find((x) => x.isNextOpponent);
  const showSim =
    s.simulation && p.combatSim !== undefined && p.combatSim.opponentPlayerId === focus?.playerId;
  return (
    <div className="lobby">
      {s.lobby && (
        <ol className="rows">
          {view.players.map((pl) => (
            <PlayerRow key={pl.playerId} pl={pl} names={names} compact={settings.compact} />
          ))}
        </ol>
      )}
      {!settings.compact && s.tribes && <Tribes view={view} />}
      {!settings.compact && s.pool && <PoolSummary p={p} />}
      {!settings.compact && s.season && <SeasonPanel p={p} />}
      {focus !== undefined && (s.opponentBoard || showSim) && (
        <section className="board">
          <h3>
            {focus.isCurrentOpponent ? t.opponent : t.nextOpponent}
            {t.colon}
            {nameOf(names, focus.heroCardId)}
          </h3>
          {showSim && <CombatSim sim={p.combatSim} />}
          {!s.opponentBoard ? null : focus.lastBoard === undefined ? (
            <p className="muted">{t.boardNeverSeen}</p>
          ) : (
            <>
              <p className="muted">{t.boardSeen(focus.lastBoard.round)}</p>
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

const pctOf = (x: number): string => `${Math.round(x * 100)} %`;

/** Probabilités de combat (Monte Carlo sur les plateaux affichés). */
function CombatSim({ sim }: { sim: NonNullable<OverlayPayload['combatSim']> }): React.JSX.Element {
  const s = sim.summary;
  const all = useI18n();
  const t = all.sim;
  const avg = (x: number): string => x.toLocaleString(all.locale, { maximumFractionDigits: 1 });
  const range = (d: typeof s.damageToA): string =>
    d === undefined ? '–' : `${d.min}–${d.max} (${t.avg} ${avg(d.avg)})`;
  return (
    <div className="sim" title={t.hint(s.iterations, sim.final)}>
      <div className="sim__bar" aria-hidden="true">
        <span className="sim__win" style={{ width: pctOf(s.win) }} />
        <span className="sim__tie" style={{ width: pctOf(s.tie) }} />
        <span className="sim__loss" style={{ width: pctOf(s.loss) }} />
      </div>
      <p className="sim__line">
        <b className="sim__w">
          {t.win} {pctOf(s.win)}
        </b>{' '}
        · {t.tie} {pctOf(s.tie)} ·{' '}
        <b className="sim__l">
          {t.loss} {pctOf(s.loss)}
        </b>
        {(s.lethalForA ?? 0) > 0 && (
          <>
            {' '}
            · {t.lethalThem} {pctOf(s.lethalForA ?? 0)}
          </>
        )}
        {(s.lethalForB ?? 0) > 0 && (
          <>
            {' '}
            ·{' '}
            <b className="sim__l">
              {t.lethalYou} {pctOf(s.lethalForB ?? 0)}
            </b>
          </>
        )}
      </p>
      <p className="muted">{t.damage(range(s.damageToB), range(s.damageToA))}</p>
      {sim.context === 'nextOpponent' && <p className="muted">{t.fromBoard(sim.boardRound)}</p>}
      {s.approximate && <p className="sim__approx">{t.approximate(s.unsupportedCards.length)}</p>}
    </div>
  );
}

/** Mécaniques de saison du joueur local (trinkets, Sombres dons, Activations, compteurs). */
function SeasonPanel({ p }: { p: OverlayPayload }): React.JSX.Element | null {
  const s = p.view.season;
  const t = useI18n().season;
  if (s === undefined) return null;
  const n = (id: string): string => nameOf(p.names, id);
  const lines: React.ReactNode[] = [];
  if (s.trinkets.length > 0) {
    lines.push(
      <li key="t">
        <span className="season__label">{t.trinkets}</span>{' '}
        {s.trinkets
          .map((x) =>
            x.kind === 'chosen'
              ? n(x.cardId)
              : `${x.slot === 'lesser' ? t.lesser : t.greater} ${x.turnsLeft === undefined || x.turnsLeft <= 0 ? t.toChoose : t.inTurns(x.turnsLeft)}`,
          )
          .join(' · ')}
      </li>,
    );
  }
  if (s.darkGifts !== undefined) {
    const dg = s.darkGifts;
    lines.push(
      <li
        key="d"
        title={dg.gifts.map((g) => `${n(g.giftCardId)} → ${n(g.minionCardId)}`).join(' · ')}
      >
        <span className="season__label">{t.darkGifts}</span> <b>{dg.used}</b>/{dg.max} {t.used}
        {p.view.outcome === 'inProgress' &&
          dg.used < dg.max &&
          (dg.available ? (
            <small className="season__ok">{t.available(String(dg.cost ?? '?'))}</small>
          ) : (
            <small>{t.unavailable}</small>
          ))}
        {dg.gifts.length > 0 && <small> · {dg.gifts.map((g) => n(g.giftCardId)).join(', ')}</small>}
      </li>,
    );
  }
  if (s.activationsThisTurn.length > 0) {
    lines.push(
      <li key="a">
        <span className="season__label">{t.activations}</span>{' '}
        {s.activationsThisTurn.map(n).join(', ')}
      </li>,
    );
  }
  const c = s.counters;
  const counters: string[] = [];
  if (
    c.tavernSpellBuff !== undefined &&
    (c.tavernSpellBuff.attack > 0 || c.tavernSpellBuff.health > 0)
  ) {
    counters.push(t.spells(c.tavernSpellBuff.attack, c.tavernSpellBuff.health));
  }
  if (c.extraGoldNextTurn !== undefined && c.extraGoldNextTurn > 0)
    counters.push(t.extraGold(c.extraGoldNextTurn));
  if (c.oldGod !== undefined) counters.push(t.deity(c.oldGod.attack, c.oldGod.health));
  if (counters.length > 0) lines.push(<li key="c">{counters.join(' · ')}</li>);
  if (lines.length === 0) return null;
  return <ul className="season">{lines}</ul>;
}

/** Restants du pool aux niveaux accessibles (estimation : cartes vues uniquement). */
function PoolSummary({ p }: { p: OverlayPayload }): React.JSX.Element | null {
  const pool = p.pool;
  const t = useI18n().lobby;
  if (pool === undefined) return null;
  const maxTier = Math.min(7, (p.view.local.techLevel ?? 1) + 1);
  const tiers = pool.tiers.filter((x) => x.tier <= maxTier && x.cards > 0);
  return (
    <p className="pool" title={t.poolHint}>
      {t.pool}
      {!pool.lobbyComplete && t.poolUncertain}
      {t.colon}
      {tiers.map((x) => (
        <span key={x.tier} className={x.verified ? '' : 'pool--unverified'}>
          {t.tierShort}
          {x.tier} <b>{Math.round((x.remaining / Math.max(1, x.total)) * 100)}%</b>{' '}
        </span>
      ))}
    </p>
  );
}

function Tribes({ view }: { view: VisibleView }): React.JSX.Element {
  const t = view.tribes;
  const m = useI18n();
  // Tribus identifiées, puis les plus vues (au moins 2 cartes distinctes) marquées « ? ».
  const probable = t.tribes
    .filter((x) => !x.identified && x.distinctCards >= 2)
    .slice(0, Math.max(0, t.expected - t.identified.length));
  const label = (x: string): string => m.tribes[x] ?? x;
  return (
    <p className="tribes" title={m.lobby.tribesHint}>
      {m.lobby.tribes} {t.identified.length}/{t.expected}
      {m.lobby.colon}
      {t.identified.length + probable.length === 0
        ? '…'
        : [...t.identified.map(label), ...probable.map((x) => `${label(x.tribe)} ?`)].join(', ')}
    </p>
  );
}

// ------------------------------------------------------------------ messages

function noticesOf(p: OverlayPayload, m: Messages): string[] {
  const t = m.notices;
  const msgs: string[] = [];
  const hs = m.hsWindow[p.status.hsWindow];
  if (p.status.source === 'live' && hs !== undefined) msgs.push(hs);
  if (p.status.configProblems.length > 0) msgs.push(t.config(p.status.configProblems.join(', ')));
  if (p.view.isBattlegrounds && p.view.mode === 'duos') msgs.push(t.duos);
  else if (p.view.isBattlegrounds && p.view.mode === 'unknown') msgs.push(t.unknownMode);
  if (p.view.warnings.includes('truncated')) msgs.push(t.truncated);
  if (p.view.warnings.includes('interrupted')) msgs.push(t.interrupted);
  if (p.view.warnings.includes('abandoned')) msgs.push(t.abandoned);
  if (p.status.cardData === 'stale') msgs.push(t.staleCards);
  if (p.status.cardData === 'error') msgs.push(t.noCards);
  if (!p.settings.locked) msgs.push(t.unlocked);
  return msgs;
}

function Notices({ p }: { p: OverlayPayload }): React.JSX.Element | null {
  const msgs = noticesOf(p, useI18n());
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
  const t = useI18n();
  const toasts = useAlerts(payload, now, t);

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
      {toasts.length > 0 && (
        <ul className="toasts" role="status" aria-live="polite">
          {toasts.map((x) => (
            <li key={x.id}>{x.text}</li>
          ))}
        </ul>
      )}
      {solo && view.outcome !== 'finished' && (
        <>
          {settings.sections.bar && (
            <Panel id="bar" position={settings.panels.bar} locked={settings.locked} onMove={onMove}>
              <TopBar p={payload} now={now} />
            </Panel>
          )}
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
            {t.lobby.finalPlace} <b>{view.finalPlace ?? '?'}</b>
          </div>
          <Lobby p={payload} />
        </Panel>
      )}
    </div>
  );
}
