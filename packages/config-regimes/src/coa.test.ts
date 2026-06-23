import { describe, it, expect } from 'vitest';
import { getChartOfAccounts } from './registry.js';
import type { AccountSeed } from './types.js';

const VALID_TYPES = new Set<AccountSeed['type']>(['asset', 'liability', 'equity', 'revenue', 'expense']);

describe('Chart of Accounts — Circular 133', () => {
  const accounts = getChartOfAccounts('circular_133');
  const codeSet = new Set(accounts.map(a => a.code));

  it('has accounts (non-empty)', () => {
    expect(accounts.length).toBeGreaterThan(0);
  });

  it('account codes are unique', () => {
    expect(codeSet.size).toBe(accounts.length);
  });

  it('every type is one of the five valid types', () => {
    for (const a of accounts) {
      expect(VALID_TYPES.has(a.type), `invalid type on ${a.code}: ${a.type}`).toBe(true);
    }
  });

  it('every parentCode refers to an existing code', () => {
    for (const a of accounts) {
      if (a.parentCode !== undefined) {
        expect(codeSet.has(a.parentCode), `parentCode ${a.parentCode} not found (child: ${a.code})`).toBe(true);
      }
    }
  });

  it('every account has a non-empty Vietnamese name', () => {
    for (const a of accounts) {
      expect(a.name.trim().length, `empty name on ${a.code}`).toBeGreaterThan(0);
    }
  });

  // Spot checks — key accounts that must be present
  it('contains core Class-1 accounts: 111, 112, 131, 133', () => {
    for (const code of ['111', '112', '131', '133']) {
      expect(codeSet.has(code), `missing account ${code}`).toBe(true);
    }
  });

  it('contains core Class-3 accounts: 331, 333, 334, 338', () => {
    for (const code of ['331', '333', '334', '338']) {
      expect(codeSet.has(code), `missing account ${code}`).toBe(true);
    }
  });

  it('contains core Class-4 accounts: 411, 421', () => {
    for (const code of ['411', '421']) {
      expect(codeSet.has(code), `missing account ${code}`).toBe(true);
    }
  });

  it('contains revenue account 511 and 515', () => {
    expect(codeSet.has('511')).toBe(true);
    expect(codeSet.has('515')).toBe(true);
  });

  it('contains expense account 632 (COGS) and 642 (G&A)', () => {
    expect(codeSet.has('632')).toBe(true);
    expect(codeSet.has('642')).toBe(true);
  });

  it('contains Class-9 profit-determination account 911', () => {
    expect(codeSet.has('911')).toBe(true);
  });

  it('Class-1/2 accounts are typed as asset', () => {
    const assets = accounts.filter(a => /^[12]/.test(a.code));
    expect(assets.length).toBeGreaterThan(0);
    for (const a of assets) {
      expect(a.type, `${a.code} should be asset`).toBe('asset');
    }
  });

  it('Class-3 accounts are typed as liability', () => {
    const liabs = accounts.filter(a => /^3/.test(a.code) && a.code.length >= 3);
    expect(liabs.length).toBeGreaterThan(0);
    for (const a of liabs) {
      expect(a.type, `${a.code} should be liability`).toBe('liability');
    }
  });

  it('Class-4 accounts are typed as equity', () => {
    const eq = accounts.filter(a => /^4/.test(a.code) && a.code.length >= 3);
    expect(eq.length).toBeGreaterThan(0);
    for (const a of eq) {
      expect(a.type, `${a.code} should be equity`).toBe('equity');
    }
  });

  it('Class-5/7 accounts are typed as revenue', () => {
    const rev = accounts.filter(a => /^[57]/.test(a.code) && a.code.length >= 3);
    expect(rev.length).toBeGreaterThan(0);
    for (const a of rev) {
      expect(a.type, `${a.code} should be revenue`).toBe('revenue');
    }
  });

  it('Class-6/8 accounts are typed as expense', () => {
    const exp = accounts.filter(a => /^[68]/.test(a.code) && a.code.length >= 3);
    expect(exp.length).toBeGreaterThan(0);
    for (const a of exp) {
      expect(a.type, `${a.code} should be expense`).toBe('expense');
    }
  });
});

describe('Chart of Accounts — Circular 88', () => {
  const accounts = getChartOfAccounts('circular_88');
  const codeSet = new Set(accounts.map(a => a.code));

  it('has accounts (non-empty)', () => {
    expect(accounts.length).toBeGreaterThan(0);
  });

  it('account codes are unique', () => {
    expect(codeSet.size).toBe(accounts.length);
  });

  it('every type is one of the five valid types', () => {
    for (const a of accounts) {
      expect(VALID_TYPES.has(a.type), `invalid type on ${a.code}: ${a.type}`).toBe(true);
    }
  });

  it('every parentCode refers to an existing code', () => {
    for (const a of accounts) {
      if (a.parentCode !== undefined) {
        expect(codeSet.has(a.parentCode), `parentCode ${a.parentCode} not found (child: ${a.code})`).toBe(true);
      }
    }
  });

  it('every account has a non-empty Vietnamese name', () => {
    for (const a of accounts) {
      expect(a.name.trim().length, `empty name on ${a.code}`).toBeGreaterThan(0);
    }
  });

  it('contains expected TT88 core accounts: 111, 331, 411, 511, 632, 911', () => {
    for (const code of ['111', '331', '411', '511', '632', '911']) {
      expect(codeSet.has(code), `missing account ${code}`).toBe(true);
    }
  });
});

describe('getChartOfAccounts — unknown regime', () => {
  it('throws on unknown regime', () => {
    // @ts-expect-error testing runtime guard
    expect(() => getChartOfAccounts('circular_999')).toThrow(/unknown regime/i);
  });
});
