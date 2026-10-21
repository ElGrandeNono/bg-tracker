import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildVisibleView, Pipeline, readLogLines, type PoolSighting } from '@bgt/core';
import { DEFAULT_SETTINGS, type OverlayPayload } from '../shared/payload.js';
import { dueAlerts, tripleCandidates } from './alerts.js';
import { MESSAGES } from './i18n.js';

// Vues synthétiques minimales pour les cas ciblés (synthetic), et une vue réelle de fixture.
const sight = (cardId: string, source: PoolSighting['source'], golden = false): PoolSighting => ({
  cardId,
  golden,
  source,
});

describe('alertes : triple réalisable (synthetic)', () => {
  it('deux exemplaires au joueur et le troisième en boutique', () => {
    expect(
      tripleCandidates([sight('A', 'local'), sight('A', 'local'), sight('A', 'shop')]),
    ).toEqual(['A']);
  });

  it('ignore les dorés, un seul exemplaire et les plateaux adverses', () => {
    expect(
      tripleCandidates([
        sight('A', 'local'),
        sight('A', 'local', true),
        sight('A', 'shop'),
        sight('B', 'local'),
        sight('B', 'opponent'),
        sight('B', 'shop'),
      ]),
    ).toEqual([]);
  });
});

describe('alertes : déclenchement unique', () => {
  it('début de tour et minuteur bas une seule fois par tour ; rien hors partie en cours', async () => {
    const pipeline = new Pipeline();
    let recruit: OverlayPayload['view'] | undefined;
    pipeline.subscribe(() => {
      // Vue construite une seule fois : au premier recrutement affiché à partir du tour 3.
      const { bg, state } = pipeline.displayed;
      const last = bg.timeline.at(-1);
      if (recruit !== undefined || last?.kind !== 'recruit' || last.round < 3) return;
      recruit = buildVisibleView(bg, state);
    });
    for await (const line of readLogLines(
      join(import.meta.dirname, '../../../../fixtures/bg-solo-2026-10-18-complete.Power.log.gz'),
    )) {
      pipeline.feedLine(line);
    }
    expect(recruit).toBeDefined();
    if (recruit === undefined) return;
    const now = 1_000_000;
    const p: OverlayPayload = {
      view: { ...recruit, season: undefined },
      names: {},
      status: {
        source: 'live',
        configProblems: [],
        hsWindow: 'ok',
        cardData: 'ok',
        replayDone: false,
        stale: false,
      },
      settings: {
        ...DEFAULT_SETTINGS,
        alerts: { ...DEFAULT_SETTINGS.alerts, turnStart: true, timerLow: true },
      },
      timerEndsAt: now + 8000,
      pool: undefined,
      combatSim: undefined,
      tavernBuffs: [],
      manualTribes: undefined,
      deityCardId: undefined,
      appVersion: '0.0.0',
      updateStatus: { state: 'idle' },
    };
    const fired = new Set<string>();
    const first = dueAlerts(p, now, MESSAGES.fr, fired);
    expect(first).toContain(MESSAGES.fr.alerts.turnStart(recruit.round));
    expect(first).toContain(MESSAGES.fr.alerts.timerLow);
    expect(dueAlerts(p, now + 500, MESSAGES.fr, fired)).toEqual([]);

    const finished = { ...p, view: { ...p.view, outcome: 'finished' as const } };
    expect(dueAlerts(finished, now, MESSAGES.en, new Set())).toEqual([]);
  }, 120_000);
});
