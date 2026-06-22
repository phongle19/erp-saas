import { describe, it, expect } from 'vitest';
import { getRegimeConfig, listRegimes } from './registry.js';
describe('regime registry', () => {
  it('lists the four supported regimes', () => {
    expect(listRegimes().sort()).toEqual(['circular_132','circular_133','circular_200','circular_88']);
  });
  it('returns a config object keyed by regime (no hardcoded branching at call sites)', () => {
    expect(getRegimeConfig('circular_133').regime).toBe('circular_133');
  });
  it('throws on unknown regime', () => {
    // @ts-expect-error testing runtime guard
    expect(() => getRegimeConfig('circular_999')).toThrow(/unknown regime/i);
  });
});
