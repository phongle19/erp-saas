import { type Money, money, sumLines } from './money.js';

export interface JournalLineInput {
  accountCode: string;
  debit: Money;
  credit: Money;
  memo?: string;
}

export type BalanceErrorCode =
  | 'EMPTY'
  | 'CURRENCY_MISMATCH'
  | 'LINE_BOTH_SIDES'
  | 'LINE_NEITHER_SIDE'
  | 'UNBALANCED';

export interface BalanceError {
  code: BalanceErrorCode;
  detail?: string;
}

/**
 * Validates that a set of journal lines satisfies double-entry accounting invariants.
 *
 * Returns null when valid; otherwise returns the FIRST error encountered (checked in order):
 *   1. EMPTY            — no lines provided
 *   2. CURRENCY_MISMATCH — any line's debit or credit currency !== the journal currency
 *   3. LINE_BOTH_SIDES  — a line has both debit > 0 AND credit > 0,
 *                         OR either side is negative (negative amounts are invalid)
 *   4. LINE_NEITHER_SIDE — a line has debit == 0 AND credit == 0
 *   5. UNBALANCED       — Σ debit.minor !== Σ credit.minor
 */
export function validateBalanced(
  lines: readonly JournalLineInput[],
  currency: string,
): BalanceError | null {
  // 1. EMPTY
  if (lines.length === 0) {
    return { code: 'EMPTY' };
  }

  // 2. CURRENCY_MISMATCH — scan all lines first
  for (const l of lines) {
    if (l.debit.currency !== currency || l.credit.currency !== currency) {
      return { code: 'CURRENCY_MISMATCH', detail: l.accountCode };
    }
  }

  // 3 & 4. Per-line side checks
  for (const l of lines) {
    const dNeg = l.debit.minor < 0n;
    const cNeg = l.credit.minor < 0n;
    const dPos = l.debit.minor > 0n;
    const cPos = l.credit.minor > 0n;

    // Negative amounts, or both sides positive → LINE_BOTH_SIDES
    if (dNeg || cNeg || (dPos && cPos)) {
      return {
        code: 'LINE_BOTH_SIDES',
        detail: l.accountCode,
      };
    }

    // Both sides are zero → LINE_NEITHER_SIDE
    if (!dPos && !cPos) {
      return {
        code: 'LINE_NEITHER_SIDE',
        detail: l.accountCode,
      };
    }
  }

  // 5. UNBALANCED — Σ debit must equal Σ credit
  const totalDebit = sumLines(
    lines.map(l => l.debit),
    currency,
  );
  const totalCredit = sumLines(
    lines.map(l => l.credit),
    currency,
  );

  if (totalDebit.minor !== totalCredit.minor) {
    return { code: 'UNBALANCED' };
  }

  return null;
}

/**
 * Returns a new array of lines with debit and credit swapped on each line.
 * Pure — does not mutate the original array or its elements.
 */
export function buildReversal(lines: readonly JournalLineInput[]): JournalLineInput[] {
  return lines.map(l => ({
    accountCode: l.accountCode,
    debit: l.credit,
    credit: l.debit,
    ...(l.memo !== undefined ? { memo: l.memo } : {}),
  }));
}
