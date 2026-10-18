import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VisibleMinion } from '@bgt/core';
import type { GameRecord, ReplayRound } from '@bgt/history';
// Sous-chemin pur : le renderer n'embarque pas le stockage SQLite (Node).
import { computeStats } from '@bgt/history/stats';
import type { BgtBridge, HistoryGame, ImportProgress } from '../shared/payload.js';
import { useI18n, type Messages } from './i18n.js';

/**
 * Tableau de bord : statistiques de l'historique local, liste des parties (MMR, notes, tags
 * modifiables) et replay tour par tour de ce qui était visible. Les parties abandonnées ou
 * interrompues sont listées mais exclues des moyennes.
 */

type Names = Readonly<Record<string, string>>;
const nameOf = (names: Names, id: string): string => names[id] ?? id;
const tribe = (t: Messages, x: string): string => t.tribes[x] ?? x;
const pct = (x: number | undefined): string => (x === undefined ? '–' : `${Math.round(x * 100)} %`);
const num = (t: Messages, x: number | undefined, d = 2): string =>
  x === undefined
    ? '–'
    : x.toLocaleString(t.locale, { minimumFractionDigits: d, maximumFractionDigits: d });
const date = (t: Messages, iso: string | undefined): string =>
  iso === undefined
    ? '–'
    : new Date(iso).toLocaleString(t.locale, { dateStyle: 'short', timeStyle: 'short' });
const duration = (t: Messages, ms: number | undefined): string =>
  ms === undefined
    ? '–'
    : t.dashboard.minutes(
        Math.floor(ms / 60_000),
        String(Math.round((ms % 60_000) / 1000)).padStart(2, '0'),
      );

export function Dashboard({ bridge }: { bridge: BgtBridge }): React.JSX.Element {
  const [games, setGames] = useState<readonly GameRecord[]>([]);
  const [names, setNames] = useState<Names>({});
  const [tab, setTab] = useState<'stats' | 'games'>('stats');
  const [selected, setSelected] = useState<number | undefined>();
  const [progress, setProgress] = useState<ImportProgress | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const t = useI18n();
  const d = t.dashboard;

  const reload = useCallback(() => {
    void bridge.history.list().then((l) => {
      setGames(l.games);
      setNames(l.names);
    });
  }, [bridge]);

  useEffect(() => {
    reload();
    const offC = bridge.history.onChanged(reload);
    const offP = bridge.history.onImportProgress(setProgress);
    return () => {
      offC();
      offP();
    };
  }, [bridge, reload]);

  const stats = useMemo(() => computeStats(games), [games]);

  const importLogs = (): void => {
    setMessage(undefined);
    void bridge.history.importLogs().then((n) => {
      setProgress(undefined);
      setMessage(n === 0 ? d.noNew : d.added(n));
      reload();
    });
  };
  const exportAs = (format: 'csv' | 'json'): void => {
    void bridge.history.exportGames(format).then((path) => {
      if (path !== undefined) setMessage(d.exported(path));
    });
  };

  return (
    <div className="browser dash">
      <header className="browser__head">
        <h1>{d.title}</h1>
        <nav className="dash__tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'stats'}
            onClick={() => {
              setTab('stats');
            }}
          >
            {d.stats}
          </button>
          <button
            role="tab"
            aria-selected={tab === 'games'}
            onClick={() => {
              setTab('games');
            }}
          >
            {d.games(games.length)}
          </button>
        </nav>
        <span className="dash__spacer" />
        <button onClick={importLogs} disabled={progress !== undefined}>
          {d.import}
        </button>
        <button
          onClick={() => {
            exportAs('csv');
          }}
        >
          {d.exportCsv}
        </button>
        <button
          onClick={() => {
            exportAs('json');
          }}
        >
          {d.exportJson}
        </button>
      </header>
      {progress !== undefined && (
        <p className="browser__info">
          {d.importProgress(progress.done, progress.total, progress.current ?? '', progress.added)}
        </p>
      )}
      {message !== undefined && <p className="browser__info">{message}</p>}

      {tab === 'stats' ? (
        <StatsView stats={stats} names={names} />
      ) : (
        <GamesView
          games={games}
          names={names}
          selected={selected}
          onSelect={setSelected}
          bridge={bridge}
        />
      )}
      <footer className="browser__foot">{d.footer}</footer>
    </div>
  );
}

// ------------------------------------------------------------------ statistiques

function StatsView({
  stats,
  names,
}: {
  stats: ReturnType<typeof computeStats>;
  names: Names;
}): React.JSX.Element {
  const t = useI18n();
  const d = t.dashboard;
  if (stats.games === 0 && stats.unranked === 0) {
    return <p className="browser__empty">{d.empty}</p>;
  }
  return (
    <div className="dash__stats">
      <section className="tiles">
        <Tile label={d.ranked} value={String(stats.games)} />
        <Tile label={d.avgPlace} value={num(t, stats.averagePlace)} />
        <Tile label={d.top4} value={pct(stats.top4Rate)} />
        <Tile label={d.wins} value={pct(stats.winRate)} />
        <Tile
          label={d.streak}
          value={d.streakValue(stats.streaks.currentTop4, stats.streaks.bestTop4)}
        />
        <Tile label={d.unranked} value={String(stats.unranked)} hint={d.unrankedHint} />
      </section>
      <section className="dash__charts">
        <figure className="chart">
          <figcaption>{d.placeChart}</figcaption>
          <PlaceChart series={stats.series} />
        </figure>
        <figure className="chart">
          <figcaption>{d.distChart}</figcaption>
          <DistributionChart counts={stats.distribution} />
        </figure>
      </section>
      <section className="dash__tables">
        <AggTable title={d.byHero} rows={stats.byHero} label={(k) => nameOf(names, k)} />
        <AggTable title={d.byTribe} rows={stats.byTribe} label={(k) => tribe(t, k)} />
        <AggTable title={d.byBuild} rows={stats.byBuild} label={(k) => k} />
      </section>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}): React.JSX.Element {
  return (
    <div className="tile" title={hint}>
      <span className="tile__value">{value}</span>
      <span className="tile__label">{label}</span>
    </div>
  );
}

function AggTable({
  title,
  rows,
  label,
}: {
  title: string;
  rows: ReturnType<typeof computeStats>['byHero'];
  label: (k: string) => string;
}): React.JSX.Element {
  const t = useI18n();
  const d = t.dashboard;
  return (
    <table className="browser__table">
      <caption>{title}</caption>
      <thead>
        <tr>
          <th />
          <th>{d.colGames}</th>
          <th>{d.colAvg}</th>
          <th>{d.top4}</th>
          <th>{d.colFirst}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{label(r.key)}</td>
            <td className="num">{r.games}</td>
            <td className="num">{num(t, r.averagePlace)}</td>
            <td className="num">{pct(r.top4Rate)}</td>
            <td className="num">{pct(r.winRate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Graphiques en SVG : une seule série (pas de légende), traits de 2 px, marqueurs de 8 px,
// grille discrète, info-bulle au survol (guide dataviz).

const W = 520;
const H = 220;
const PAD = { l: 34, r: 12, t: 12, b: 26 };

function PlaceChart({
  series,
}: {
  series: ReturnType<typeof computeStats>['series'];
}): React.JSX.Element {
  const [hover, setHover] = useState<number | undefined>();
  const svg = useRef<SVGSVGElement>(null);
  const t = useI18n();
  if (series.length === 0) return <p className="muted">{t.dashboard.noRanked}</p>;
  const x = (i: number): number =>
    series.length === 1
      ? (PAD.l + W - PAD.r) / 2
      : PAD.l + (i * (W - PAD.l - PAD.r)) / (series.length - 1);
  const y = (place: number): number => PAD.t + ((place - 1) * (H - PAD.t - PAD.b)) / 7;
  const path = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.place)}`).join(' ');
  const onMove = (e: React.MouseEvent<SVGSVGElement>): void => {
    const rect = svg.current?.getBoundingClientRect();
    if (rect === undefined) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    series.forEach((_, i) => {
      if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    });
    setHover(best);
  };
  const h = hover === undefined ? undefined : series[hover];
  return (
    <div className="chart__box">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={t.dashboard.placeChartLabel}
        onMouseMove={onMove}
        onMouseLeave={() => {
          setHover(undefined);
        }}
      >
        {[1, 2, 3, 4, 5, 6, 7, 8].map((p) => (
          <g key={p}>
            <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(p)} y2={y(p)} />
            <text className="axis" x={PAD.l - 8} y={y(p) + 4} textAnchor="end">
              {p}
            </text>
          </g>
        ))}
        {/* Seuil du top 4 */}
        <line className="grid grid--top4" x1={PAD.l} x2={W - PAD.r} y1={y(4.5)} y2={y(4.5)} />
        <path className="line" d={path} />
        {series.map((p, i) => (
          <circle key={i} className="dot" cx={x(i)} cy={y(p.place)} r={hover === i ? 5.5 : 4} />
        ))}
        {hover !== undefined && (
          <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} />
        )}
      </svg>
      {h !== undefined && hover !== undefined && (
        <div className="tooltip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <b>{t.dashboard.place(h.place)}</b> · {date(t, h.startedAt)}
        </div>
      )}
    </div>
  );
}

function DistributionChart({ counts }: { counts: readonly number[] }): React.JSX.Element {
  const [hover, setHover] = useState<number | undefined>();
  const t = useI18n();
  const max = Math.max(1, ...counts);
  const bw = (W - PAD.l - PAD.r) / 8;
  const y = (n: number): number => H - PAD.b - (n / max) * (H - PAD.t - PAD.b);
  const total = counts.reduce((s, n) => s + n, 0);
  return (
    <div className="chart__box">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t.dashboard.distChartLabel}>
        <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} />
        {counts.map((n, i) => {
          const x0 = PAD.l + i * bw + 1;
          const top = y(n);
          const r = Math.min(4, (bw - 2) / 2, H - PAD.b - top);
          const w = bw - 2; // 2 px d'écart entre barres
          const d =
            n === 0
              ? ''
              : `M${x0},${H - PAD.b} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + w - r} Q${x0 + w},${top} ${x0 + w},${top + r} V${H - PAD.b} Z`;
          return (
            <g
              key={i}
              onMouseEnter={() => {
                setHover(i);
              }}
              onMouseLeave={() => {
                setHover(undefined);
              }}
            >
              <rect className="hit" x={x0} y={PAD.t} width={w} height={H - PAD.t - PAD.b} />
              {n > 0 && <path className={hover === i ? 'bar bar--hover' : 'bar'} d={d} />}
              <text className="axis" x={x0 + w / 2} y={H - 8} textAnchor="middle">
                {i + 1}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== undefined && (
        <div className="tooltip" style={{ left: `${((PAD.l + (hover + 0.5) * bw) / W) * 100}%` }}>
          {t.dashboard.placeGames(
            hover + 1,
            counts[hover] ?? 0,
            pct(total === 0 ? undefined : (counts[hover] ?? 0) / total),
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ parties

function GamesView({
  games,
  names,
  selected,
  onSelect,
  bridge,
}: {
  games: readonly GameRecord[];
  names: Names;
  selected: number | undefined;
  onSelect: (id: number | undefined) => void;
  bridge: BgtBridge;
}): React.JSX.Element {
  const t = useI18n();
  const d = t.dashboard;
  return (
    <div className="dash__games">
      <table className="browser__table dash__list">
        <thead>
          <tr>
            <th>{d.colDate}</th>
            <th>{d.colHero}</th>
            <th>{d.colPlace}</th>
            <th>{t.browser.colTribes}</th>
            <th>{d.colRounds}</th>
            <th>{d.colDuration}</th>
            <th>{d.colMmr}</th>
          </tr>
        </thead>
        <tbody>
          {games.map((g) => (
            <tr
              key={g.id}
              className={g.id === selected ? 'is-selected' : ''}
              onClick={() => {
                onSelect(g.id);
              }}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSelect(g.id);
              }}
            >
              <td>{date(t, g.startedAt)}</td>
              <td>{nameOf(names, g.heroBaseCardId)}</td>
              <td className="num">
                {g.finalPlace ?? <span className="muted">{d.outcome[g.outcome]}</span>}
              </td>
              <td className="muted">{g.tribes.map((x) => tribe(t, x)).join(', ') || '–'}</td>
              <td className="num">{g.rounds}</td>
              <td className="num">{duration(t, g.durationMs)}</td>
              <td className="num">{g.mmr ?? '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {selected !== undefined && <GameDetail id={selected} bridge={bridge} />}
    </div>
  );
}

function GameDetail({ id, bridge }: { id: number; bridge: BgtBridge }): React.JSX.Element | null {
  const [data, setData] = useState<HistoryGame | undefined>();
  const [round, setRound] = useState(0);
  const [mmr, setMmr] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const t = useI18n();
  const d = t.dashboard;
  useEffect(() => {
    void bridge.history.get(id).then((d) => {
      setData(d);
      setRound(0);
      setMmr(d?.game.mmr?.toString() ?? '');
      setNotes(d?.game.notes ?? '');
      setTags(d?.game.tags.join(', ') ?? '');
    });
  }, [bridge, id]);
  if (data === undefined) return null;
  const { game, names } = data;
  const r = game.replay[round];
  const save = (): void => {
    const value = mmr.trim() === '' ? undefined : Number(mmr);
    void bridge.history.update(id, {
      mmr: value !== undefined && Number.isFinite(value) ? Math.round(value) : undefined,
      notes,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t !== ''),
    });
  };
  return (
    <section className="dash__detail">
      <h2>
        {nameOf(names, game.heroCardId)} —{' '}
        {game.finalPlace === undefined ? d.outcome[game.outcome] : d.place(game.finalPlace)}
        <small>
          {' '}
          · build {game.build ?? '?'} · {date(t, game.startedAt)}
        </small>
      </h2>
      <div className="dash__edit">
        <label>
          {d.mmr}
          <input
            inputMode="numeric"
            value={mmr}
            onChange={(e) => {
              setMmr(e.target.value);
            }}
            placeholder={d.mmrPlaceholder}
          />
        </label>
        <label>
          {d.tags}
          <input
            value={tags}
            onChange={(e) => {
              setTags(e.target.value);
            }}
            placeholder={d.tagsPlaceholder}
          />
        </label>
        <label className="dash__notes">
          {d.notes}
          <textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
            }}
            rows={2}
          />
        </label>
        <button onClick={save}>{d.save}</button>
      </div>
      {game.replay.length === 0 ? (
        <p className="muted">{d.noReplay}</p>
      ) : (
        <>
          <div className="dash__rounds" role="tablist" aria-label={d.rounds}>
            {game.replay.map((x, i) => (
              <button
                key={x.round}
                role="tab"
                aria-selected={i === round}
                onClick={() => {
                  setRound(i);
                }}
              >
                {x.round}
              </button>
            ))}
          </div>
          {r !== undefined && <RoundView r={r} names={names} />}
        </>
      )}
    </section>
  );
}

function RoundView({ r, names }: { r: ReplayRound; names: Names }): React.JSX.Element {
  const d = useI18n().dashboard;
  return (
    <div className="dash__round">
      <p>
        {d.roundLine(r.round, String(r.techLevel ?? '?'), String(r.health ?? '?'))}
        {r.armor !== undefined && r.armor > 0 && ` +${r.armor}`}
        {d.triples(r.triples ?? 0)}
      </p>
      <div className="dash__boards">
        <Board title={d.yourBoard} minions={r.localBoard} names={names} />
        <Board
          title={
            r.opponent === undefined
              ? d.opponent
              : `${nameOf(names, r.opponent.heroCardId)}${r.opponent.name === undefined ? '' : ` (${r.opponent.name})`}`
          }
          minions={r.opponent?.board ?? []}
          names={names}
        />
      </div>
    </div>
  );
}

function Board({
  title,
  minions,
  names,
}: {
  title: string;
  minions: readonly VisibleMinion[];
  names: Names;
}): React.JSX.Element {
  const t = useI18n();
  return (
    <div className="board">
      <h3>{title}</h3>
      <ol className="minions">
        {minions.map((m, i) => (
          <li key={i} className={`minion ${m.golden ? 'minion--golden' : ''}`}>
            <span className="minion__name">{nameOf(names, m.cardId)}</span>
            <span className="minion__stats">
              <b className="atk">{m.attack ?? '?'}</b>/<b className="hp">{m.health ?? '?'}</b>
            </span>
            <span className="minion__kw">
              {m.keywords.map((k) => (
                <abbr key={k} title={t.keywords[k].long}>
                  {t.keywords[k].short}
                </abbr>
              ))}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
