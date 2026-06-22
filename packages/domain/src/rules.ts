/** A versioned, effective-dated rule. `value` kept as string to preserve bigint/decimal precision. */
export interface Rule {
  ruleType: string;
  value: string;
  effectiveFrom: string; // ISO date 'YYYY-MM-DD' (inclusive)
  effectiveTo: string | null; // ISO date (exclusive) or null = open-ended
  sourceRegulation: string;
}

/** Returns the single rule of `ruleType` whose [effectiveFrom, effectiveTo) contains `onDate`. */
export function findEffectiveRule(rules: readonly Rule[], ruleType: string, onDate: string): Rule | undefined {
  return rules.find(
    (r) =>
      r.ruleType === ruleType &&
      r.effectiveFrom <= onDate &&
      (r.effectiveTo === null || onDate < r.effectiveTo),
  );
}
