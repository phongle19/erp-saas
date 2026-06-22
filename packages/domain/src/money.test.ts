import { describe, it, expect } from 'vitest';
import { money, add, subtract, negate, sumLines, equals, isZero, applyRate, Rounding } from './money.js';

const VND = 'VND';

describe('money', () => {
  it('constructs from bigint minor units', () => {
    expect(money(1000n, VND)).toEqual({ minor: 1000n, currency: VND });
  });
  it('adds same-currency amounts', () => {
    expect(add(money(1000n, VND), money(250n, VND))).toEqual(money(1250n, VND));
  });
  it('subtracts and can go negative', () => {
    expect(subtract(money(100n, VND), money(150n, VND))).toEqual(money(-50n, VND));
  });
  it('negates', () => {
    expect(negate(money(100n, VND))).toEqual(money(-100n, VND));
  });
  it('throws on currency mismatch', () => {
    expect(() => add(money(1n, VND), money(1n, 'USD'))).toThrow(/currency/i);
  });
  it('sums an array of lines, zero for empty', () => {
    expect(sumLines([money(10n, VND), money(20n, VND)], VND)).toEqual(money(30n, VND));
    expect(sumLines([], VND)).toEqual(money(0n, VND));
  });
  it('detects equality and zero', () => {
    expect(equals(money(5n, VND), money(5n, VND))).toBe(true);
    expect(isZero(money(0n, VND))).toBe(true);
  });
  it('applies a rate with explicit rounding (10% VAT on 1005 -> 101 half-up, 100 down)', () => {
    expect(applyRate(money(1005n, VND), 10n, 100n, Rounding.HALF_UP)).toEqual(money(101n, VND));
    expect(applyRate(money(1005n, VND), 10n, 100n, Rounding.DOWN)).toEqual(money(100n, VND));
  });
  it('applies 8% rate deterministically', () => {
    expect(applyRate(money(1_000_000n, VND), 8n, 100n, Rounding.HALF_UP)).toEqual(money(80_000n, VND));
  });
});
