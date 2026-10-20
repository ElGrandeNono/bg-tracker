import { useEffect, useState } from 'react';
import type {
  AlertSettings,
  BgtBridge,
  Language,
  OverlaySettings,
  SectionVisibility,
  SettingsPatch,
  Theme,
} from '../shared/payload.js';
import { useI18n } from './i18n.js';

/**
 * Fenêtre Réglages : apparence et accessibilité, sections affichées, alertes, mode streamer et
 * mises à jour. Chaque changement part au processus principal, qui valide, enregistre et renvoie
 * les réglages à toutes les fenêtres. Tout accès réseau est désactivé par défaut.
 */

const THEMES: readonly Theme[] = ['dark', 'light', 'contrast'];
const LANGUAGES: readonly [Language, string][] = [
  ['fr', 'Français'],
  ['en', 'English'],
];
const SECTIONS: readonly (keyof SectionVisibility)[] = [
  'bar',
  'lobby',
  'tribes',
  'poolByTier',
  'season',
  'simulation',
  'opponentBoard',
  'counters',
];
const ALERTS: readonly (keyof AlertSettings)[] = [
  'turnStart',
  'timerLow',
  'triple',
  'tribesFound',
  'sound',
];

export function Settings({ bridge }: { bridge: BgtBridge }): React.JSX.Element {
  const [s, setS] = useState<OverlaySettings | undefined>();
  const [port, setPort] = useState('');
  const t = useI18n();
  const m = t.settings;
  useEffect(() => {
    const off = bridge.onUpdate((p) => {
      setS(p.settings);
    });
    bridge.ready();
    return off;
  }, [bridge]);
  const savedPort = s?.streamer.port;
  useEffect(() => {
    if (savedPort !== undefined) setPort(String(savedPort));
  }, [savedPort]);

  if (s === undefined) return <div className="browser settings" />;
  const patch = (p: SettingsPatch): void => {
    bridge.updateSettings(p);
  };
  const check = (
    label: string,
    checked: boolean,
    onChange: (v: boolean) => void,
    hint?: string,
  ) => (
    <label className="settings__check" key={label}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
      />
      <span>
        {label}
        {hint !== undefined && <small className="muted"> — {hint}</small>}
      </span>
    </label>
  );
  const url = `http://127.0.0.1:${s.streamer.port}/?obs`;

  return (
    <div className="browser settings">
      <header className="browser__head">
        <h1>{m.title}</h1>
      </header>
      <main className="settings__body">
        <section>
          <h2>{m.display}</h2>
          <label className="settings__row">
            <span>{m.language}</span>
            <select
              value={s.language}
              onChange={(e) => {
                patch({ language: e.target.value === 'en' ? 'en' : 'fr' });
              }}
            >
              {LANGUAGES.map(([code, name]) => (
                <option key={code} value={code} lang={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="settings__row">
            <legend>{m.theme}</legend>
            {THEMES.map((th) => (
              <label key={th} className="settings__radio">
                <input
                  type="radio"
                  name="theme"
                  checked={s.theme === th}
                  onChange={() => {
                    patch({ theme: th });
                  }}
                />
                {m.themes[th]}
              </label>
            ))}
          </fieldset>
          <label className="settings__row">
            <span>
              {m.opacity} <output>{Math.round(s.opacity * 100)} %</output>
            </span>
            <input
              type="range"
              min={30}
              max={100}
              step={5}
              value={Math.round(s.opacity * 100)}
              onChange={(e) => {
                patch({ opacity: Number(e.target.value) / 100 });
              }}
            />
          </label>
          <label className="settings__row">
            <span>
              {m.scale} <output>{Math.round(s.scale * 100)} %</output>
            </span>
            <input
              type="range"
              min={60}
              max={200}
              step={10}
              value={Math.round(s.scale * 100)}
              onChange={(e) => {
                patch({ scale: Number(e.target.value) / 100 });
              }}
            />
          </label>
          {check(m.compact, s.compact, (v) => {
            patch({ compact: v });
          })}
          {check(m.showClock, s.showClock, (v) => {
            patch({ showClock: v });
          })}
          {check(m.simOnClick, s.simOnClick, (v) => {
            patch({ simOnClick: v });
          })}
          <button
            onClick={() => {
              patch({ resetPanels: true });
            }}
          >
            {m.resetPanels}
          </button>
        </section>

        <section>
          <h2>{m.sections}</h2>
          {SECTIONS.map((k) =>
            check(m.sectionNames[k], s.sections[k], (v) => {
              patch({ sections: { [k]: v } });
            }),
          )}
        </section>

        <section>
          <h2>{m.alerts}</h2>
          {ALERTS.map((k) =>
            check(m.alertNames[k], s.alerts[k], (v) => {
              patch({ alerts: { [k]: v } });
            }),
          )}
        </section>

        <section>
          <h2>{m.streamer}</h2>
          {check(m.streamerEnabled, s.streamer.enabled, (v) => {
            patch({ streamer: { enabled: v } });
          })}
          {s.streamer.enabled && <p className="settings__hint">{m.streamerHint(url)}</p>}
          <label className="settings__row">
            <span>{m.port}</span>
            <input
              inputMode="numeric"
              value={port}
              onChange={(e) => {
                setPort(e.target.value);
              }}
              onBlur={() => {
                const n = Number(port);
                if (Number.isInteger(n)) patch({ streamer: { port: n } });
                else setPort(String(s.streamer.port));
              }}
            />
          </label>
          {check(m.hideOpponentNames, s.streamer.hideOpponentNames, (v) => {
            patch({ streamer: { hideOpponentNames: v } });
          })}
          {check(m.hideSimulation, s.streamer.hideSimulation, (v) => {
            patch({ streamer: { hideSimulation: v } });
          })}
          {check(m.hidePool, s.streamer.hidePool, (v) => {
            patch({ streamer: { hidePool: v } });
          })}
        </section>

        <section>
          <h2>{m.updates}</h2>
          {check(m.autoUpdate, s.autoUpdate, (v) => {
            patch({ autoUpdate: v });
          })}
        </section>

        <section>
          <h2>{m.shortcuts}</h2>
          <table className="browser__table settings__keys">
            <tbody>
              {m.shortcutList.map(([k, label]) => (
                <tr key={k}>
                  <td>
                    <kbd>{k}</kbd>
                  </td>
                  <td>{label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2>{m.about}</h2>
          <p className="settings__about">{m.disclaimer}</p>
        </section>
      </main>
    </div>
  );
}
