import { describe, it, expect } from 'vitest';
import { lineNet, vatFor, VAT_RULE_TYPES } from './sales.js';

describe('lineNet', () => {
  it('returns quantity * unitPriceMinor', () => {
    expect(lineNet(3n, 100_000n)).toBe(300_000n);
  });

  it('returns 0 when quantity is 0', () => {
    expect(lineNet(0n, 5n)).toBe(0n);
  });

  it('throws on negative quantity', () => {
    expect(() => lineNet(-1n, 100_000n)).toThrow('quantity and unit price must be non-negative');
  });

  it('throws on negative unit price', () => {
    expect(() => lineNet(3n, -1n)).toThrow('quantity and unit price must be non-negative');
  });
});

describe('vatFor', () => {
  it('computes 10% VAT correctly', () => {
    expect(vatFor(1_000_000n, 10n)).toBe(100_000n);
  });

  it('computes 8% VAT correctly', () => {
    expect(vatFor(1_000_000n, 8n)).toBe(80_000n);
  });

  it('rounds HALF_UP: 1005 * 10% = 100.5 → 101', () => {
    expect(vatFor(1_005n, 10n)).toBe(101n);
  });

  it('returns 0 when rate is 0', () => {
    expect(vatFor(1_000_000n, 0n)).toBe(0n);
  });

  it('throws on negative net', () => {
    expect(() => vatFor(-1n, 10n)).toThrow('net must be non-negative');
  });

  it('throws on negative rate', () => {
    expect(() => vatFor(1_000_000n, -1n)).toThrow('rate must be non-negative');
  });
});

describe('VAT_RULE_TYPES', () => {
  it('contains exactly the 5 expected types', () => {
    expect(VAT_RULE_TYPES).toEqual(['vat_rate', 'vat_rate_reduced', 'vat_rate_5', 'vat_zero', 'vat_exempt']);
  });
});
