import { describe, it, expect } from 'vitest';
import { money, add, subtract, negate, sumLines, equals, isZero, isNegative, applyRate, Rounding } from './money.js';

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
  it('detects equality and zero (both branches)', () => {
    expect(equals(money(5n, VND), money(5n, VND))).toBe(true);
    expect(equals(money(5n, VND), money(6n, VND))).toBe(false);
    expect(equals(money(5n, VND), money(5n, 'USD'))).toBe(false);
    expect(isZero(money(0n, VND))).toBe(true);
    expect(isZero(money(1n, VND))).toBe(false);
  });
  it('detects negative amounts (both branches)', () => {
    expect(isNegative(money(-1n, VND))).toBe(true);
    expect(isNegative(money(0n, VND))).toBe(false);
    expect(isNegative(money(1n, VND))).toBe(false);
  });
  it('applies a rate with explicit rounding (10% VAT on 1005 -> 101 half-up, 100 down)', () => {
    expect(applyRate(money(1005n, VND), 10n, 100n, Rounding.HALF_UP)).toEqual(money(101n, VND));
    expect(applyRate(money(1005n, VND), 10n, 100n, Rounding.DOWN)).toEqual(money(100n, VND));
  });
  it('rounds negatives symmetrically — HALF_UP is away from zero, DOWN is toward zero', () => {
    // -1005 * 10% = -100.5 -> HALF_UP (away from zero) = -101; DOWN (toward zero) = -100
    expect(applyRate(money(-1005n, VND), 10n, 100n, Rounding.HALF_UP)).toEqual(money(-101n, VND));
    expect(applyRate(money(-1005n, VND), 10n, 100n, Rounding.DOWN)).toEqual(money(-100n, VND));
  });
  it('applies 8% rate deterministically', () => {
    expect(applyRate(money(1_000_000n, VND), 8n, 100n, Rounding.HALF_UP)).toEqual(money(80_000n, VND));
  });
  it('rejects a non-positive denominator', () => {
    expect(() => applyRate(money(100n, VND), 10n, 0n, Rounding.HALF_UP)).toThrow(/denominator/i);
    expect(() => applyRate(money(100n, VND), 10n, -100n, Rounding.HALF_UP)).toThrow(/denominator/i);
  });
});
