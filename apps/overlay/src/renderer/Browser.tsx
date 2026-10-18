import { useEffect, useMemo, useState } from 'react';
import type { BgtBridge, CatalogCard, OverlayPayload } from '../shared/payload.js';
import { MECHANIC_LABELS, TRIBE_LABELS } from './strings.js';

/**
 * Navigateur de serviteurs : recherche par nom, tribu, niveau et mot-clé ; par défaut limité aux
 * tribus du lobby déjà identifiées. Exemplaires restants et probabilité à la prochaine
 * actualisation : estimations fondées sur les seules cartes vues (le pool réel est plus petit).
 */

/** `lobby` (pool de la partie), `all`, ou une tribu canonique. */
type TribeFilter = string;

const tribeLabel = (t: string): string => TRIBE_LABELS[t] ?? t;
const pct = (p: number): string => (p <= 0 ? '–' : p < 0.01 ? '< 1 %' : `${Math.round(p * 100)} %`);

export function Browser({ bridge }: { bridge: BgtBridge }): React.JSX.Element {
  const [catalog, setCatalog] = useState<readonly CatalogCard[]>([]);
  const [payload, setPayload] = useState<OverlayPayload | undefined>();
  const [query, setQuery] = useState('');
  const [tribe, setTribe] = useState<TribeFilter>('lobby');
  const [tier, setTier] = useState<number | 'all'>('all');
  const [mechanic, setMechanic] = useState<string>('all');

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
        tribeLabel(a).localeCompare(tribeLabel(b)),
      ),
    [catalog],
  );
  const mechanics = useMemo(
    () =>
      [...new Set(catalog.flatMap((c) => c.mechanics))].filter((m) => m in MECHANIC_LABELS).sort(),
    [catalog],
  );

  const q = query.trim().toLocaleLowerCase('fr');
  const rows = catalog
    .filter((c) =>
      q === ''
        ? true
        : c.name.toLocaleLowerCase('fr').includes(q) || c.text.toLocaleLowerCase('fr').includes(q),
    )
    .filter((c) => (tier === 'all' ? true : c.tier === tier))
    .filter((c) => (mechanic === 'all' ? true : c.mechanics.includes(mechanic)))
    .filter((c) => {
      if (tribe === 'all') return true;
      if (tribe === 'lobby') return pool?.cards[c.id]?.membership !== 'out';
      return c.tribes.includes(tribe) || c.allTribes;
    })
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name, 'fr'));

  return (
    <div className="browser theme-dark">
      <header className="browser__head">
        <h1>Serviteurs</h1>
        <input
          type="search"
          placeholder="Nom ou texte…"
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
          aria-label="Tribu"
        >
          <option value="lobby">Pool de la partie</option>
          <option value="all">Toutes les tribus</option>
          {allTribes.map((t) => (
            <option key={t} value={t}>
              {tribeLabel(t)}
            </option>
          ))}
        </select>
        <select
          value={String(tier)}
          onChange={(e) => {
            setTier(e.target.value === 'all' ? 'all' : Number(e.target.value));
          }}
          aria-label="Niveau"
        >
          <option value="all">Tous niveaux</option>
          {[1, 2, 3, 4, 5, 6, 7].map((t) => (
            <option key={t} value={t}>
              Niveau {t}
            </option>
          ))}
        </select>
        <select
          value={mechanic}
          onChange={(e) => {
            setMechanic(e.target.value);
          }}
          aria-label="Mot-clé"
        >
          <option value="all">Tous mots-clés</option>
          {mechanics.map((m) => (
            <option key={m} value={m}>
              {MECHANIC_LABELS[m]}
            </option>
          ))}
        </select>
      </header>

      <p className="browser__info">
        Tribus identifiées : {lobby.length}/{payload?.view.tribes.expected ?? 5}
        {lobby.length > 0 && ` (${lobby.map(tribeLabel).join(', ')})`}
        {pool !== undefined && !pool.lobbyComplete && ' — composition du lobby encore incertaine'}
        {' · '}Restants et probabilités : estimations d’après les cartes vues.
        {pool !== undefined && pool.unverifiedRules.length > 0 && (
          <> Règles non confirmées : {pool.unverifiedRules.join(' ; ')}.</>
        )}
      </p>

      {catalog.length === 0 ? (
        <p className="browser__empty">Données de cartes en cours de chargement…</p>
      ) : (
        <table className="browser__table">
          <thead>
            <tr>
              <th>Niv.</th>
              <th>Serviteur</th>
              <th>Tribus</th>
              <th>Stats</th>
              <th>Texte</th>
              <th title="Exemplaires restants (maximum) / total">Restants</th>
              <th title="Probabilité d’en voir au moins un à la prochaine actualisation, à votre niveau">
                Proba.
              </th>
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
                    {c.allTribes ? 'Toutes' : c.tribes.map(tribeLabel).join(' / ') || 'Neutre'}
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
      <footer className="browser__foot">
        BG Tracker — non affilié à Blizzard Entertainment. Données : HearthstoneJSON.
      </footer>
    </div>
  );
}
