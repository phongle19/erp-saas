import { describe, it, expect } from 'vitest';
import { money } from './money.js';
import { validateBalanced, buildReversal } from './journal.js';
import type { JournalLineInput } from './journal.js';

const VND = 'VND';
const USD = 'USD';

// Helpers
const line = (accountCode: string, debitMinor: bigint, creditMinor: bigint, memo?: string): JournalLineInput => ({
  accountCode,
  debit: money(debitMinor, VND),
  credit: money(creditMinor, VND),
  ...(memo !== undefined ? { memo } : {}),
});

describe('validateBalanced', () => {
  it('returns null for a balanced 2-line entry (debit 100 / credit 100 VND)', () => {
    const lines: JournalLineInput[] = [
      line('1111', 100n, 0n),
      line('3311', 0n, 100n),
    ];
    expect(validateBalanced(lines, VND)).toBeNull();
  });

  it('returns UNBALANCED for debit 100 / credit 90', () => {
    const lines: JournalLineInput[] = [
      line('1111', 100n, 0n),
      line('3311', 0n, 90n),
    ];
    const err = validateBalanced(lines, VND);
    expect(err).not.toBeNull();
    expect(err!.code).toBe('UNBALANCED');
  });

  it('returns LINE_BOTH_SIDES when a line has both debit > 0 and credit > 0', () => {
    const lines: JournalLineInput[] = [
      { accountCode: 'BAD', debit: money(50n, VND), credit: money(50n, VND) },
      line('3311', 0n, 100n),
    ];
    const err = validateBalanced(lines, VND);
    expect(err).not.toBeNull();
    expect(err!.code).toBe('LINE_BOTH_SIDES');
    expect(err!.detail).toContain('BAD');
  });

  it('returns LINE_NEITHER_SIDE when a line has debit == 0 and credit == 0', () => {
    const lines: JournalLineInput[] = [
      line('1111', 100n, 0n),
      { accountCode: 'ZERO', debit: money(0n, VND), credit: money(0n, VND) },
      line('3311', 0n, 100n),
    ];
    const err = validateBalanced(lines, VND);
    expect(err).not.toBeNull();
    expect(err!.code).toBe('LINE_NEITHER_SIDE');
    expect(err!.detail).toContain('ZERO');
  });

  it('returns CURRENCY_MISMATCH when a line debit currency differs from journal currency', () => {
    const lines: JournalLineInput[] = [
      { accountCode: 'FX', debit: money(100n, USD), credit: money(0n, VND) },
      line('3311', 0n, 100n),
    ];
    const err = validateBalanced(lines, VND);
    expect(err).not.toBeNull();
    expect(err!.code).toBe('CURRENCY_MISMATCH');
  });

  it('returns CURRENCY_MISMATCH when a line credit currency differs from journal currency', () => {
    const lines: JournalLineInput[] = [
      line('1111', 100n, 0n),
      { accountCode: 'FX2', debit: money(0n, VND), credit: money(100n, USD) },
    ];
    const err = validateBalanced(lines, VND);
    expect(err).not.toBeNull();
    expect(err!.code).toBe('CURRENCY_MISMATCH');
  });

  it('returns EMPTY for an empty array', () => {
    const err = validateBalanced([], VND);
    expect(err).not.toBeNull();
    expect(err!.code).toBe('EMPTY');
  });

  it('returns null for a multi-line balanced entry (debit 70+30 / credit 100)', () => {
    const lines: JournalLineInput[] = [
      line('1111', 70n, 0n),
      line('1112', 30n, 0n),
      line('3311', 0n, 100n),
    ];
    expect(validateBalanced(lines, VND)).toBeNull();
  });

  it('returns LINE_BOTH_SIDES for a line with a negative debit amount', () => {
    const lines: JournalLineInput[] = [
      { accountCode: 'NEG', debit: money(-10n, VND), credit: money(0n, VND) },
      line('3311', 0n, 100n),
    ];
    const err = validateBalanced(lines, VND);
    expect(err).not.toBeNull();
    expect(err!.code).toBe('LINE_BOTH_SIDES');
    expect(err!.detail).toContain('NEG');
  });

  it('returns LINE_BOTH_SIDES for a line with a negative credit amount', () => {
    const lines: JournalLineInput[] = [
      line('1111', 100n, 0n),
      { accountCode: 'NEGCR', debit: money(0n, VND), credit: money(-50n, VND) },
    ];
    const err = validateBalanced(lines, VND);
    expect(err).not.toBeNull();
    expect(err!.code).toBe('LINE_BOTH_SIDES');
    expect(err!.detail).toContain('NEGCR');
  });

  it('checks EMPTY before CURRENCY_MISMATCH', () => {
    expect(validateBalanced([], USD)!.code).toBe('EMPTY');
  });

  it('checks CURRENCY_MISMATCH before LINE_BOTH_SIDES', () => {
    // First line has wrong currency AND would be LINE_BOTH_SIDES — CURRENCY_MISMATCH wins
    const lines: JournalLineInput[] = [
      { accountCode: 'BAD', debit: money(50n, USD), credit: money(50n, USD) },
    ];
    expect(validateBalanced(lines, VND)!.code).toBe('CURRENCY_MISMATCH');
  });
});

describe('buildReversal', () => {
  const validLines: JournalLineInput[] = [
    { accountCode: '1111', debit: money(100n, VND), credit: money(0n, VND), memo: 'original debit' },
    { accountCode: '3311', debit: money(0n, VND), credit: money(100n, VND), memo: 'original credit' },
  ];

  it('swaps debit and credit for each line', () => {
    const reversed = buildReversal(validLines);
    expect(reversed[0].debit).toEqual(money(0n, VND));
    expect(reversed[0].credit).toEqual(money(100n, VND));
    expect(reversed[1].debit).toEqual(money(100n, VND));
    expect(reversed[1].credit).toEqual(money(0n, VND));
  });

  it('preserves accountCode and memo', () => {
    const reversed = buildReversal(validLines);
    expect(reversed[0].accountCode).toBe('1111');
    expect(reversed[0].memo).toBe('original debit');
    expect(reversed[1].accountCode).toBe('3311');
    expect(reversed[1].memo).toBe('original credit');
  });

  it('the reversal is itself valid (passes validateBalanced)', () => {
    const reversed = buildReversal(validLines);
    expect(validateBalanced(reversed, VND)).toBeNull();
  });

  it('original + reversal net to zero per account (Σdebit − Σcredit = 0 for each accountCode)', () => {
    const reversed = buildReversal(validLines);
    const all = [...validLines, ...reversed];

    // Group by accountCode and verify net is zero
    const accounts = [...new Set(all.map(l => l.accountCode))];
    for (const code of accounts) {
      const linesForAccount = all.filter(l => l.accountCode === code);
      let net = 0n;
      for (const l of linesForAccount) {
        net += l.debit.minor - l.credit.minor;
      }
      expect(net).toBe(0n);
    }
  });

  it('is a pure function — does not mutate the original lines', () => {
    const originalDebitMinor = validLines[0].debit.minor;
    buildReversal(validLines);
    expect(validLines[0].debit.minor).toBe(originalDebitMinor);
  });

  it('works for a multi-line balanced entry', () => {
    const multiLines: JournalLineInput[] = [
      line('1111', 70n, 0n),
      line('1112', 30n, 0n),
      line('3311', 0n, 100n),
    ];
    const reversed = buildReversal(multiLines);
    expect(validateBalanced(reversed, VND)).toBeNull();
  });
});
