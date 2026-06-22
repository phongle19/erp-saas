/** A versioned, effective-dated rule. `value` kept as string to preserve bigint/decimal precision. */
export interface Rule {
  ruleType: string;
  value: string;
  effectiveFrom: string; // ISO date 'YYYY-MM-DD' (inclusive)
  effectiveTo: string | null; // ISO date (exclusive) or null = open-ended
  sourceRegulation: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns the single rule of `ruleType` whose [effectiveFrom, effectiveTo) window contains `onDate`.
 *
 * Correctness relies on lexicographic comparison of zero-padded ISO `YYYY-MM-DD` strings, so
 * `onDate` MUST be in that exact format — a non-ISO string (e.g. '2025-7-1' or a locale date)
 * would silently compare wrong and yield an incorrect tax rule. We therefore reject malformed
 * dates loudly rather than guess.
 *
 * PRECONDITION: windows for a given `ruleType` must NOT overlap. The rules table is the source of
 * truth and is maintained so that adjacent windows are contiguous (old.effectiveTo == new.effectiveFrom).
 * If two rows for the same `ruleType` did overlap, the first in array order is returned — callers
 * loading from the DB should order deterministically and validate non-overlap at write time.
 */
export function findEffectiveRule(rules: readonly Rule[], ruleType: string, onDate: string): Rule | undefined {
  if (!ISO_DATE.test(onDate)) throw new Error(`onDate must be 'YYYY-MM-DD', got '${onDate}'`);
  return rules.find(
    (r) =>
      r.ruleType === ruleType &&
      r.effectiveFrom <= onDate &&
      (r.effectiveTo === null || onDate < r.effectiveTo),
  );
}
