import { describe, expect, it } from 'vitest';
import {
  checkClientConfig,
  checkLogConfig,
  parseIni,
  patchClientConfig,
  patchLogConfig,
} from './gameConfig.js';

describe('client.config', () => {
  it('accepte la forme indentée trouvée sur la machine de l’utilisateur', () => {
    expect(checkClientConfig('   [Log]\r\n   FileSizeLimit.Int=-1').ok).toBe(true);
  });

  it('signale un fichier absent ou sans la limite levée', () => {
    expect(checkClientConfig(undefined).ok).toBe(false);
    expect(checkClientConfig('[Log]\nFileSizeLimit.Int=10000').ok).toBe(false);
  });

  it('crée la section si besoin et conserve le reste', () => {
    const patched = patchClientConfig('[Other]\r\nX=1\r\n');
    expect(checkClientConfig(patched).ok).toBe(true);
    expect(parseIni(patched).find((s) => s.name === 'Other')?.values.X).toBe('1');
  });
});

describe('log.config', () => {
  it('détecte une section [Power] incomplète', () => {
    const check = checkLogConfig('[Power]\nLogLevel=1\nFilePrinting=false');
    expect(check.ok).toBe(false);
    expect(check.problems).toContain('[Power] FilePrinting=true');
    expect(check.problems).toContain('[Power] Verbose=true');
  });

  it('corrige [Power] sans toucher aux autres sections', () => {
    const before = '[Achievements]\nLogLevel=1\n[Power]\nLogLevel=0';
    const patched = patchLogConfig(before);
    expect(checkLogConfig(patched).ok).toBe(true);
    expect(parseIni(patched).find((s) => s.name === 'Achievements')?.values.LogLevel).toBe('1');
  });
});
