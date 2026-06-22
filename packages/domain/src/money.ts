import type { CurrencyCode, Money } from './types.js';
export type { Money } from './types.js';

export const money = (minor: bigint, currency: CurrencyCode): Money => ({ minor, currency });

function assertSame(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSame(a, b);
  return money(a.minor + b.minor, a.currency);
}
export function subtract(a: Money, b: Money): Money {
  assertSame(a, b);
  return money(a.minor - b.minor, a.currency);
}
export const negate = (a: Money): Money => money(-a.minor, a.currency);
export const equals = (a: Money, b: Money): boolean => a.currency === b.currency && a.minor === b.minor;
export const isZero = (a: Money): boolean => a.minor === 0n;
export const isNegative = (a: Money): boolean => a.minor < 0n;

export const sumLines = (lines: readonly Money[], currency: CurrencyCode): Money =>
  lines.reduce((acc, l) => add(acc, l), money(0n, currency));

export enum Rounding { HALF_UP = 'HALF_UP', DOWN = 'DOWN' }

/**
 * Multiply a Money by a rational rate (numerator/denominator) using integer math only.
 * Used for VAT/PIT etc. Rounding is explicit and deterministic. HALF_UP rounds away
 * from zero on an exact .5 (matches BigDecimal.HALF_UP), so negatives round symmetrically.
 * The denominator must be positive — a non-positive denominator is a programming error
 * because the sign-correction below keys off the product's sign.
 */
export function applyRate(m: Money, numerator: bigint, denominator: bigint, rounding: Rounding): Money {
  if (denominator <= 0n) throw new Error('denominator must be positive');
  const product = m.minor * numerator;
  let q = product / denominator; // truncates toward zero
  const r = product % denominator;
  if (rounding === Rounding.HALF_UP && r !== 0n) {
    const twiceRem = (r < 0n ? -r : r) * 2n;
    if (twiceRem >= denominator) q += product < 0n ? -1n : 1n;
  }
  return money(q, m.currency);
}
