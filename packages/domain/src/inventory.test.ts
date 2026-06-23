import { describe, it, expect } from 'vitest';
import { receiptBalance, issueCost } from './inventory.js';

describe('receiptBalance', () => {
  it('adds first receipt to empty balance', () => {
    const result = receiptBalance(0n, 0n, 10n, 1_000_000n);
    expect(result).toEqual({ qty: 10n, value: 1_000_000n });
  });

  it('adds second receipt — moving average updates via value accumulation', () => {
    // Start: 10 units @ 1,000,000 total
    const after1 = receiptBalance(0n, 0n, 10n, 1_000_000n);
    // Add: 10 units @ 1,200,000 total
    const after2 = receiptBalance(after1.qty, after1.value, 10n, 1_200_000n);
    expect(after2).toEqual({ qty: 20n, value: 2_200_000n });
    // avg = 2,200,000 / 20 = 110,000 per unit
  });

  it('throws when receipt quantity is zero or negative', () => {
    expect(() => receiptBalance(0n, 0n, 0n, 1_000_000n)).toThrow('receipt quantity must be positive');
    expect(() => receiptBalance(0n, 0n, -1n, 1_000_000n)).toThrow('receipt quantity must be positive');
  });

  it('throws when receipt cost is negative', () => {
    expect(() => receiptBalance(0n, 0n, 10n, -1n)).toThrow('receipt cost must be non-negative');
  });

  it('throws when previous balances are negative', () => {
    expect(() => receiptBalance(-1n, 0n, 10n, 0n)).toThrow('balances must be non-negative');
    expect(() => receiptBalance(0n, -1n, 10n, 0n)).toThrow('balances must be non-negative');
  });

  it('allows zero cost (e.g. donated goods)', () => {
    const result = receiptBalance(5n, 500n, 10n, 0n);
    expect(result).toEqual({ qty: 15n, value: 500n });
  });
});

describe('issueCost', () => {
  it('issues 5 from {qty 20, value 2,200,000} at weighted average', () => {
    // avg = 2,200,000 / 20 = 110,000 per unit; costOut = 110,000 * 5 = 550,000
    // Using applyRate: 2,200,000 * 5 / 20 = 550,000 exactly
    const result = issueCost(20n, 2_200_000n, 5n);
    expect(result).toEqual({ costOut: 550_000n, qty: 15n, value: 1_650_000n });
  });

  it('issuing entire remaining qty clears value to exactly 0 — no residual drift', () => {
    // From prior state: {qty 15, value 1,650,000}
    const result = issueCost(15n, 1_650_000n, 15n);
    expect(result).toEqual({ costOut: 1_650_000n, qty: 0n, value: 0n });
  });

  it('non-divisible: issue 1 from {qty 3, value 10} → costOut 3 (HALF_UP rounds 3.33→3)', () => {
    // 10 * 1 / 3 = 3.33... → HALF_UP = 3 (since 0.33 < 0.5)
    const result = issueCost(3n, 10n, 1n);
    expect(result).toEqual({ costOut: 3n, qty: 2n, value: 7n });
  });

  it('non-divisible: issue remaining 2 from {qty 2, value 7} → clears value to 0', () => {
    // Issuing all remaining → costOut = whole remaining value = 7, value = 0
    const result = issueCost(2n, 7n, 2n);
    expect(result).toEqual({ costOut: 7n, qty: 0n, value: 0n });
  });

  it('non-divisible full sequence: {3,10} → issue 1 → issue 2 → value = 0', () => {
    const after1 = issueCost(3n, 10n, 1n);
    expect(after1.value).toBe(7n);
    const after2 = issueCost(after1.qty, after1.value, 2n);
    expect(after2).toEqual({ costOut: 7n, qty: 0n, value: 0n });
  });

  it('two-receipt scenario full flow', () => {
    // receipt 10 @ 1,000,000 then receipt 10 @ 1,200,000 → {20, 2,200,000}
    // issue 5 → costOut 550,000, {15, 1,650,000}
    // issue 15 (all) → costOut 1,650,000, {0, 0}
    const issue1 = issueCost(20n, 2_200_000n, 5n);
    expect(issue1.costOut).toBe(550_000n);
    expect(issue1.qty).toBe(15n);
    expect(issue1.value).toBe(1_650_000n);

    const issue2 = issueCost(issue1.qty, issue1.value, 15n);
    expect(issue2.costOut).toBe(1_650_000n);
    expect(issue2.qty).toBe(0n);
    expect(issue2.value).toBe(0n);
  });

  it('throws when issuing more than on-hand quantity', () => {
    expect(() => issueCost(5n, 500n, 6n)).toThrow('cannot issue more than on-hand quantity');
  });

  it('throws when issue quantity is zero or negative', () => {
    expect(() => issueCost(5n, 500n, 0n)).toThrow('issue quantity must be positive');
    expect(() => issueCost(5n, 500n, -1n)).toThrow('issue quantity must be positive');
  });
});
