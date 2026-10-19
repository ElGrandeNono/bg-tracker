import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Pipeline } from '../pipeline.js';
import { readLogLines } from '../replay/readLogLines.js';
import { buildVisibleView } from './view.js';

const FIXTURE = join(
  import.meta.dirname,
  '../../../../fixtures/bg-solo-2026-10-18-complete.Power.log.gz',
);

describe('compteurs du joueur local et boutique affichée (partie complète du 18/10)', () => {
  it('rafraîchissements gratuits 2 → 0, boutique visible au recrutement seulement', async () => {
    const pipeline = new Pipeline();
    const refreshes = new Set<number>();
    let shopSeen = false;
    let shopInCombat = false;
    let last = -1;
    pipeline.subscribe(() => {
      const { bg, state } = pipeline.displayed;
      if (bg.timeline.length === last) return;
      last = bg.timeline.length;
      const v = buildVisibleView(bg, state);
      if (v.local.freeRefreshes !== undefined) refreshes.add(v.local.freeRefreshes);
      if (v.shop.length > 0) {
        shopSeen = true;
        if (v.phase !== 'recruit') shopInCombat = true;
      }
    });
    for await (const line of readLogLines(FIXTURE)) pipeline.feedLine(line);
    pipeline.end();
    expect(refreshes.has(0)).toBe(true);
    expect(shopSeen).toBe(true);
    expect(shopInCombat).toBe(false);
  }, 120_000);
});
