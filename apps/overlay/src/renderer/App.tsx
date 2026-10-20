import {
  createContext,
  useContext,
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
  PanelId,
  PanelPosition,
} from '../shared/payload.js';
import { useI18n, type Messages } from './i18n.js';
import { useAlerts } from './alerts.js';

type Names = OverlayPayload['names'];

/** Pont vers le processus principal et images des tribus, pour les composants profonds. */
const BridgeContext = createContext<BgtBridge | undefined>(undefined);
const TribeArtContext = createContext<Readonly<Record<string, string>>>({});

/**
 * Bouton de l'overlay. La fenêtre étant transparente aux clics, elle ne capte la souris que
 * pendant le survol d'un bouton (voir CHANNELS.setInteractive).
 */
function OverlayButton(props: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  pressed?: boolean;
}): React.JSX.Element {
  const bridge = useContext(BridgeContext);
  useEffect(
    () => () => {
      bridge?.setInteractive(false);
    },
    [bridge],
  );
  return (
    <button
      type="button"
      className={props.className ?? 'ov-button'}
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.pressed}
      onMouseEnter={() => {
        bridge?.setInteractive(true);
      }}
      onMouseLeave={() => {
        bridge?.setInteractive(false);
      }}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

/** Pictogrammes dessinés ici (SVG), aucun asset externe. */
const ICONS = {
  browser: 'M3 4h14v2H3zm0 5h14v2H3zm0 5h9v2H3z',
  dashboard: 'M3 16h3V9H3zm5 0h3V4H8zm5 0h3v-5h-3z',
  settings:
    'M10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM9 1h2l.4 2.2 1.6.7 1.9-1.3 1.4 1.4-1.3 1.9.7 1.6L18 9v2l-2.2.4-.7 1.6 1.3 1.9-1.4 1.4-1.9-1.3-1.6.7L11 19H9l-.4-2.2-1.6-.7-1.9 1.3-1.4-1.4 1.3-1.9-.7-1.6L2 11V9l2.2-.4.7-1.6-1.3-1.9 1.4-1.4 1.9 1.3 1.6-.7z',
  refresh: 'M10 3a7 7 0 0 1 6.3 4H18V2h-1.5v2.3A8.5 8.5 0 1 0 18.5 10H17a7 7 0 1 1-7-7z',
  gem: 'M5 3h10l3 5-8 10L2 8z',
  spell: 'M4 3h9l3 3v11H4zm2 4v2h8V7zm0 4v2h8v-2z',
  tavern: 'M3 8l7-5 7 5v1H3zm1 2h12v7H4zm3 2v5h2v-5zm4 0v5h2v-5z',
} as const;

function Icon({ name }: { name: keyof typeof ICONS }): React.JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

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

/** Heure locale (option Réglages › Afficher l'heure). */
function Clock({ locale }: { locale: string }): React.JSX.Element {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date());
    }, 10_000);
    return () => {
      clearInterval(id);
    };
  }, []);
  return (
    <span className="bar__item bar__clock">
      <b>{now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</b>
    </span>
  );
}

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
      {p.settings.showClock && <Clock locale={t.locale} />}
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
        {pl.health ?? '–'}
        {(pl.armor ?? 0) > 0 && <small className="row__armor">+{pl.armor}</small>}
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
  return (
    <div className="lobby">
      {s.tribes && <TribeIcons view={view} manual={p.manualTribes} />}
      {s.lobby && (
        <ol className="rows">
          {view.players.map((pl) => (
            <PlayerRow key={pl.playerId} pl={pl} names={names} compact={settings.compact} />
          ))}
        </ol>
      )}
      {!settings.compact && s.poolByTier && <PoolSummary p={p} />}
      {!settings.compact && s.season && <SeasonPanel p={p} />}
      {focus !== undefined && s.opponentBoard && (
        <section className="board">
          <h3>
            {focus.isCurrentOpponent ? t.opponent : t.nextOpponent}
            {t.colon}
            {nameOf(names, focus.heroCardId)}
          </h3>
          {focus.lastBoard === undefined ? (
            <p className="muted">{t.boardNeverSeen}</p>
          ) : (
            <OpponentBoard board={focus.lastBoard} names={names} />
          )}
        </section>
      )}
    </div>
  );
}

const pctOf = (x: number): string => `${Math.round(x * 100)} %`;

/**
 * Probabilités de combat (Monte Carlo sur les plateaux affichés), en haut au milieu :
 * létal (toi sur lui) · victoire · égalité · défaite · létal (lui sur toi).
 */
function CombatSim({ p }: { p: OverlayPayload }): React.JSX.Element | null {
  const sim = p.combatSim;
  const all = useI18n();
  const [revealed, setRevealed] = useState<string | undefined>();
  if (sim === undefined) return null;
  // Option « simulation au clic » : masquée jusqu'au clic, pour chaque nouveau plateau simulé.
  const key = `${sim.context}-${sim.opponentPlayerId}-${sim.boardRound}`;
  if (p.settings.simOnClick && revealed !== key) {
    return (
      <div className="sim">
        <OverlayButton
          className="ov-link sim__reveal"
          label={all.sim.reveal}
          onClick={() => {
            setRevealed(key);
          }}
        >
          {all.sim.reveal}
        </OverlayButton>
      </div>
    );
  }
  const s = sim.summary;
  const t = all.sim;
  const avg = (x: number): string => x.toLocaleString(all.locale, { maximumFractionDigits: 1 });
  const range = (d: typeof s.damageToA): string =>
    d === undefined ? '–' : `${d.min}–${d.max} (${t.avg} ${avg(d.avg)})`;
  const opponent = p.view.players.find((x) => x.playerId === sim.opponentPlayerId);
  const name = opponent === undefined ? '?' : nameOf(p.names, opponent.heroCardId);
  const cell = (label: string, value: number, cls: string): React.JSX.Element => (
    <div className={`simgrid__cell ${cls}`}>
      <span className="simgrid__label">{label}</span>
      <b className="simgrid__value">{pctOf(value)}</b>
    </div>
  );
  return (
    <div
      className="sim"
      title={`${t.hint(s.iterations, sim.final)} · ${t.damage(range(s.damageToB), range(s.damageToA))}`}
    >
      <div className="simgrid">
        {cell(t.lethal, s.lethalForA ?? 0, 'simgrid__cell--lethal')}
        {cell(t.winLong, s.win, 'simgrid__cell--win')}
        {cell(t.tieLong, s.tie, 'simgrid__cell--tie')}
        {cell(t.lossLong, s.loss, 'simgrid__cell--loss')}
        {cell(t.lethal, s.lethalForB ?? 0, 'simgrid__cell--lethal')}
      </div>
      <p className="sim__caption">
        {sim.context === 'combat' ? t.current(name) : t.next(name, sim.boardRound)}
        {s.approximate && <span className="sim__approx"> ≈</span>}
      </p>
      {s.approximate && <p className="sim__approx">{t.approximate(s.unsupportedCards.length)}</p>}
    </div>
  );
}

/** Dernier plateau vu d'un adversaire : replié par défaut, un clic l'affiche. */
function OpponentBoard({
  board,
  names,
}: {
  board: NonNullable<VisiblePlayer['lastBoard']>;
  names: Names;
}): React.JSX.Element {
  const t = useI18n().lobby;
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className="muted board__seen">
        {t.boardSeen(board.round)}{' '}
        <OverlayButton
          className="ov-link"
          label={open ? t.hideBoard : t.showBoard}
          pressed={open}
          onClick={() => {
            setOpen(!open);
          }}
        >
          {open ? t.hideBoard : t.showBoard}
        </OverlayButton>
      </p>
      {open && (
        <ol className="minions">
          {board.minions.map((m, i) => (
            <Minion key={`${m.cardId}-${i}`} m={m} names={names} />
          ))}
        </ol>
      )}
    </>
  );
}

/** Illustration recadrée (les images 256x de HearthstoneJSON ont des bandes blanches). */
function Art({ src, fallback }: { src: string | undefined; fallback: string }): React.JSX.Element {
  return src === undefined ? (
    <span className="tribe__badge">{fallback}</span>
  ) : (
    <span className="tribe__frame">
      <img className="tribe__art" src={src} alt="" />
    </span>
  );
}

/**
 * Icônes des tribus du lobby : identifiées, puis probables (pointillés, « ? »). Le jeu affiche
 * les tribus de la partie mais le log ne les contient pas : le joueur peut les cocher (✎).
 */
function TribeIcons({
  view,
  manual,
}: {
  view: VisibleView;
  manual: readonly string[] | undefined;
}): React.JSX.Element {
  const m = useI18n();
  const art = useContext(TribeArtContext);
  const bridge = useContext(BridgeContext);
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const t = view.tribes;
  const probable = t.tribes
    .filter((x) => !x.identified && x.distinctCards >= 2)
    .slice(0, Math.max(0, t.expected - t.identified.length));
  const items = [
    ...t.identified.map((tribe) => ({ tribe, sure: true })),
    ...probable.map((x) => ({ tribe: x.tribe, sure: false })),
  ];
  const label = (x: string): string => m.tribes[x] ?? x;
  // Tribus proposées : celles du pool (images chargées), sinon celles du dictionnaire.
  const fromArt = Object.keys(art).filter((k) => !k.startsWith('card:'));
  const all = (fromArt.length > 0 ? fromArt : Object.keys(m.tribes)).sort((a, b) =>
    label(a).localeCompare(label(b), m.locale),
  );
  const send = (tribes: readonly string[]): void => {
    bridge?.setLobbyTribes(view.gameIndex, tribes);
  };
  const toggle = (tribe: string): void => {
    const next = chosen.includes(tribe) ? chosen.filter((x) => x !== tribe) : [...chosen, tribe];
    setChosen(next);
    if (next.length >= 5) {
      send(next);
      setPicking(false);
    }
  };
  return (
    <section className="tribes" title={m.lobby.tribesHint}>
      <h3 className="tribes__title">
        {m.lobby.availableTribes}{' '}
        {manual === undefined ? `${t.identified.length}/${t.expected}` : '✔'}{' '}
        <OverlayButton
          className="ov-link"
          label={m.lobby.pickTribes}
          pressed={picking}
          onClick={() => {
            setChosen(manual ?? []);
            setPicking(!picking);
          }}
        >
          ✎
        </OverlayButton>
      </h3>
      {picking ? (
        <>
          <p className="tribes__help">{m.lobby.pickHelp}</p>
          <ul className="tribes__icons tribes__icons--pick">
            {all.map((tribe) => (
              <li key={tribe} className={`tribe ${chosen.includes(tribe) ? 'tribe--chosen' : ''}`}>
                <OverlayButton
                  className="tribe__pick"
                  label={label(tribe)}
                  pressed={chosen.includes(tribe)}
                  onClick={() => {
                    toggle(tribe);
                  }}
                >
                  <Art src={art[tribe]} fallback={label(tribe).slice(0, 2)} />
                </OverlayButton>
                <span className="tribe__name">{label(tribe)}</span>
              </li>
            ))}
          </ul>
          {manual !== undefined && (
            <OverlayButton
              className="ov-link"
              label={m.lobby.resetTribes}
              onClick={() => {
                send([]);
                setPicking(false);
              }}
            >
              {m.lobby.resetTribes}
            </OverlayButton>
          )}
        </>
      ) : (
        <ul className="tribes__icons">
          {items.map(({ tribe, sure }) => (
            <li
              key={tribe}
              className={`tribe ${sure ? '' : 'tribe--probable'}`}
              title={sure ? label(tribe) : `${label(tribe)} ?`}
            >
              <Art src={art[tribe]} fallback={label(tribe).slice(0, 2)} />
              <span className="tribe__name">
                {label(tribe)}
                {sure ? '' : ' ?'}
              </span>
            </li>
          ))}
          {items.length === 0 && <li className="muted">…</li>}
        </ul>
      )}
    </section>
  );
}

/** Compteurs à droite du pouvoir héroïque (recrutement uniquement). */
function Counters({ p }: { p: OverlayPayload }): React.JSX.Element | null {
  const m = useI18n();
  const c = m.counters;
  const l = p.view.local;
  const spells = p.view.season?.counters.tavernSpellBuff;
  const items: { key: string; icon: keyof typeof ICONS; value: string; hint: string }[] = [];
  // Toujours affiché pendant le recrutement (0 compris) : on voit que le compteur est suivi.
  if (l.freeRefreshes !== undefined) {
    items.push({
      key: 'r',
      icon: 'refresh',
      value: String(l.freeRefreshes),
      hint: c.freeRefresh(l.freeRefreshes),
    });
  }
  const gem = l.bloodGemBuff;
  if (gem !== undefined && (gem.attack > 0 || gem.health > 0)) {
    items.push({
      key: 'g',
      icon: 'gem',
      value: `+${gem.attack}/+${gem.health}`,
      hint: c.bloodGem(gem.attack, gem.health),
    });
  }
  if (spells !== undefined && (spells.attack > 0 || spells.health > 0)) {
    items.push({
      key: 's',
      icon: 'spell',
      value: `+${spells.attack}/+${spells.health}`,
      hint: c.spells(spells.attack, spells.health),
    });
  }
  for (const b of p.tavernBuffs) {
    const tribe = b.tribe === 'ALL' ? c.all : (m.tribes[b.tribe] ?? b.tribe);
    items.push({
      key: `t-${b.tribe}`,
      icon: 'tavern',
      value: `${b.tribe === 'ALL' ? '' : `${tribe.slice(0, 4)}. `}+${b.attack}/+${b.health}`,
      hint: c.tavern(tribe, b.attack, b.health),
    });
  }
  if (items.length === 0) return null;
  return (
    <ul className="counters">
      {items.map((x) => (
        <li key={x.key} className="counter" title={x.hint} aria-label={x.hint}>
          <Icon name={x.icon} />
          <b>{x.value}</b>
        </li>
      ))}
    </ul>
  );
}

/** Mécaniques de saison du joueur local (trinkets, Sombres dons, Activations, compteurs). */
function SeasonPanel({ p }: { p: OverlayPayload }): React.JSX.Element | null {
  const s = p.view.season;
  const t = useI18n().season;
  const art = useContext(TribeArtContext);
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

  if (c.extraGoldNextTurn !== undefined && c.extraGoldNextTurn > 0)
    counters.push(t.extraGold(c.extraGoldNextTurn));
  if (counters.length > 0) lines.push(<li key="c">{counters.join(' · ')}</li>);
  if (p.deityCardId !== undefined) {
    lines.push(
      <li key="g" className="deity">
        <Art src={art[`card:${p.deityCardId}`]} fallback="✦" />
        <span>
          <span className="season__label">{t.deityLabel}</span> <b>{n(p.deityCardId)}</b>
          {c.oldGod !== undefined && (
            <small>
              {' '}
              {c.oldGod.attack}/{c.oldGod.health}
            </small>
          )}
        </span>
      </li>,
    );
  }
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
  const [tribeArt, setTribeArt] = useState<Readonly<Record<string, string>>>({});
  useEffect(() => bridge.onTribeArt(setTribeArt), [bridge]);
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

  const s = settings.sections;
  const panel = (id: PanelId, children: React.ReactNode): React.JSX.Element => (
    <Panel id={id} position={settings.panels[id]} locked={settings.locked} onMove={onMove}>
      {children}
    </Panel>
  );
  const inProgress = view.outcome !== 'finished';
  const showCounters =
    s.counters && inProgress && view.phase === 'recruit' && view.local.techLevel !== undefined;

  return (
    <BridgeContext.Provider value={bridge}>
      <TribeArtContext.Provider value={tribeArt}>
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
          {/* Toujours affiché (même dans les menus) : on voit que l'overlay tourne, boutons compris. */}
          {panel(
            'status',
            <div className="status">
              {solo && s.bar && inProgress && <TopBar p={payload} now={now} />}
              {!view.isBattlegrounds && <span className="status__idle">{t.lobby.waiting}</span>}
              <div className="status__buttons">
                <OverlayButton
                  label={t.buttons.browser}
                  onClick={() => {
                    bridge.openBrowser();
                  }}
                >
                  <Icon name="browser" />
                </OverlayButton>
                <OverlayButton
                  label={t.buttons.dashboard}
                  onClick={() => {
                    bridge.openDashboard();
                  }}
                >
                  <Icon name="dashboard" />
                </OverlayButton>
                <OverlayButton
                  label={t.buttons.settings}
                  onClick={() => {
                    bridge.openSettings();
                  }}
                >
                  <Icon name="settings" />
                </OverlayButton>
              </div>
            </div>,
          )}
          {solo &&
            inProgress &&
            s.simulation &&
            payload.combatSim !== undefined &&
            panel('sim', <CombatSim p={payload} />)}
          {solo &&
            panel(
              'players',
              <>
                {!inProgress && (
                  <div className="final">
                    {t.lobby.finalPlace} <b>{view.finalPlace ?? '?'}</b>
                  </div>
                )}
                <Lobby p={payload} />
              </>,
            )}
          {solo && showCounters && panel('counters', <Counters p={payload} />)}
        </div>
      </TribeArtContext.Provider>
    </BridgeContext.Provider>
  );
}
