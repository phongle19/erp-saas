import { describe, it, expect } from 'vitest';
import { findEffectiveRule, type Rule } from './rules.js';

// NOTE: effectiveTo is EXCLUSIVE — contiguous windows share the same boundary date.
// Bug-fixes from original spec: old noncash threshold effectiveTo '2025-06-30' → '2025-07-01'
// (now contiguous with the new rule's effectiveFrom '2025-07-01'); and vat_rate_reduced
// effectiveTo '2026-12-31' → '2027-01-01' so the last day of 2026 falls inside the window.
const rules: Rule[] = [
  { ruleType: 'vat_rate', value: '10', effectiveFrom: '2014-01-01', effectiveTo: null, sourceRegulation: 'Law 13/2008' },
  { ruleType: 'vat_rate_reduced', value: '8', effectiveFrom: '2025-01-01', effectiveTo: '2027-01-01', sourceRegulation: 'Resolution 204/2025/QH15' },
  { ruleType: 'input_vat_noncash_threshold', value: '20000000', effectiveFrom: '2014-01-01', effectiveTo: '2025-07-01', sourceRegulation: 'old' },
  { ruleType: 'input_vat_noncash_threshold', value: '5000000', effectiveFrom: '2025-07-01', effectiveTo: null, sourceRegulation: 'Law 48/2024/QH15' },
];

describe('findEffectiveRule', () => {
  it('picks the row whose [from,to) window contains the date', () => {
    expect(findEffectiveRule(rules, 'input_vat_noncash_threshold', '2025-08-15')?.value).toBe('5000000');
    expect(findEffectiveRule(rules, 'input_vat_noncash_threshold', '2025-06-30')?.value).toBe('20000000');
  });
  it('treats effectiveTo as exclusive upper bound', () => {
    expect(findEffectiveRule(rules, 'input_vat_noncash_threshold', '2025-07-01')?.value).toBe('5000000');
  });
  it('treats null effectiveTo as open-ended', () => {
    expect(findEffectiveRule(rules, 'vat_rate', '2099-01-01')?.value).toBe('10');
  });
  it('returns the reduced 8% rate only inside its window', () => {
    expect(findEffectiveRule(rules, 'vat_rate_reduced', '2026-12-31')?.value).toBe('8');
    expect(findEffectiveRule(rules, 'vat_rate_reduced', '2027-01-01')).toBeUndefined();
  });
  it('returns undefined when no rule matches', () => {
    expect(findEffectiveRule(rules, 'vat_rate', '2000-01-01')).toBeUndefined();
  });
});
