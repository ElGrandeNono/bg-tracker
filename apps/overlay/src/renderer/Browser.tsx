import { useEffect, useMemo, useState } from 'react';
import type { BgtBridge, CatalogCard, OverlayPayload } from '../shared/payload.js';
import { useI18n } from './i18n.js';

/**
 * Navigateur de serviteurs : recherche par nom, tribu, niveau et mot-clé ; par défaut limité aux
 * tribus du lobby déjà identifiées. Exemplaires restants et probabilité à la prochaine
 * actualisation : estimations fondées sur les seules cartes vues (le pool réel est plus petit).
 */

/** `lobby` (pool de la partie), `all`, ou une tribu canonique. */
type TribeFilter = string;

const pct = (p: number): string => (p <= 0 ? '–' : p < 0.01 ? '< 1 %' : `${Math.round(p * 100)} %`);

export function Browser({ bridge }: { bridge: BgtBridge }): React.JSX.Element {
  const [catalog, setCatalog] = useState<readonly CatalogCard[]>([]);
  const [payload, setPayload] = useState<OverlayPayload | undefined>();
  const [query, setQuery] = useState('');
  const [tribe, setTribe] = useState<TribeFilter>('lobby');
  const [tier, setTier] = useState<number | 'all'>('all');
  const [mechanic, setMechanic] = useState<string>('all');
  const t = useI18n();
  const b = t.browser;
  const tribeLabel = (x: string): string => t.tribes[x] ?? x;

  useEffect(() => {
    const offU = bridge.onUpdate(setPayload);
    const offC = bridge.onCatalog(setCatalog);
    bridge.ready();
    return () => {
      offU();
      offC();
    };
  }, [bridge]);

  const lobby = payload?.view.tribes.identified ?? [];
  const pool = payload?.pool;
  const allTribes = useMemo(
    () =>
      [...new Set(catalog.flatMap((c) => c.tribes))].sort((a, b) =>
        (t.tribes[a] ?? a).localeCompare(t.tribes[b] ?? b, t.locale),
      ),
    [catalog, t],
  );
  const mechanics = useMemo(
    () => [...new Set(catalog.flatMap((c) => c.mechanics))].filter((m) => m in t.mechanics).sort(),
    [catalog, t],
  );

  const q = query.trim().toLocaleLowerCase(t.locale);
  const rows = catalog
    .filter((c) =>
      q === ''
        ? true
        : c.name.toLocaleLowerCase(t.locale).includes(q) ||
          c.text.toLocaleLowerCase(t.locale).includes(q),
    )
    .filter((c) => (tier === 'all' ? true : c.tier === tier))
    .filter((c) => (mechanic === 'all' ? true : c.mechanics.includes(mechanic)))
    .filter((c) => {
      if (tribe === 'all') return true;
      if (tribe === 'lobby') return pool?.cards[c.id]?.membership !== 'out';
      return c.tribes.includes(tribe) || c.allTribes;
    })
    .sort((x, y) => x.tier - y.tier || x.name.localeCompare(y.name, t.locale));

  return (
    <div className="browser">
      <header className="browser__head">
        <h1>{b.title}</h1>
        <input
          type="search"
          placeholder={b.search}
          aria-label={b.search}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          autoFocus
        />
        <select
          value={tribe}
          onChange={(e) => {
            setTribe(e.target.value);
          }}
          aria-label={b.tribe}
        >
          <option value="lobby">{b.lobbyPool}</option>
          <option value="all">{b.allTribes}</option>
          {allTribes.map((x) => (
            <option key={x} value={x}>
              {tribeLabel(x)}
            </option>
          ))}
        </select>
        <select
          value={String(tier)}
          onChange={(e) => {
            setTier(e.target.value === 'all' ? 'all' : Number(e.target.value));
          }}
          aria-label={b.tier}
        >
          <option value="all">{b.allTiers}</option>
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <option key={n} value={n}>
              {b.tierN(n)}
            </option>
          ))}
        </select>
        <select
          value={mechanic}
          onChange={(e) => {
            setMechanic(e.target.value);
          }}
          aria-label={b.keyword}
        >
          <option value="all">{b.allKeywords}</option>
          {mechanics.map((m) => (
            <option key={m} value={m}>
              {t.mechanics[m]}
            </option>
          ))}
        </select>
      </header>

      <p className="browser__info">
        {b.identified(lobby.length, payload?.view.tribes.expected ?? 5)}
        {lobby.length > 0 && ` (${lobby.map(tribeLabel).join(', ')})`}
        {pool !== undefined && !pool.lobbyComplete && b.uncertain}
        {' · '}
        {b.estimates}
        {pool !== undefined &&
          pool.unverifiedRules.length > 0 &&
          b.unverified(
            pool.unverifiedRules
              .map((r) =>
                r.kind === 'copies' ? b.ruleCopies(r.copies, r.tier) : b.ruleEliminatedReturn,
              )
              .join(' ; '),
          )}
      </p>

      {catalog.length === 0 ? (
        <p className="browser__empty">{b.loading}</p>
      ) : (
        <table className="browser__table">
          <thead>
            <tr>
              <th>{b.colTier}</th>
              <th>{b.colMinion}</th>
              <th>{b.colTribes}</th>
              <th>{b.colStats}</th>
              <th>{b.colText}</th>
              <th title={b.colLeftHint}>{b.colLeft}</th>
              <th title={b.colProbHint}>{b.colProb}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const s = pool?.cards[c.id];
              return (
                <tr
                  key={c.id}
                  className={
                    s?.membership === 'out'
                      ? 'is-out'
                      : s?.membership === 'possible'
                        ? 'is-possible'
                        : ''
                  }
                >
                  <td className="num">{c.tier}</td>
                  <td>{c.name}</td>
                  <td className="muted">
                    {c.allTribes ? b.all : c.tribes.map(tribeLabel).join(' / ') || b.neutral}
                  </td>
                  <td className="num">
                    {c.attack ?? '?'}/{c.health ?? '?'}
                  </td>
                  <td className="browser__text">{c.text}</td>
                  <td className="num">
                    {s === undefined || s.membership === 'out' ? '–' : `${s.remaining}/${c.copies}`}
                  </td>
                  <td className="num">{s === undefined ? '–' : pct(s.probability)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <footer className="browser__foot">{b.footer}</footer>
    </div>
  );
}
