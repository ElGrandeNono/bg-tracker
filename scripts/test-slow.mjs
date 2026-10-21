// Tests « slow » (rejeu des grosses fixtures) : BGT_SLOW=1 vitest run [filtres…]
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const vitest = join(import.meta.dirname, '..', 'node_modules', 'vitest', 'vitest.mjs');
const r = spawnSync(process.execPath, [vitest, 'run', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, BGT_SLOW: '1' },
});
process.exit(r.status ?? 1);
