import { pgEnum } from 'drizzle-orm/pg-core';

export const accountingRegime = pgEnum('accounting_regime', [
  'circular_133', 'circular_88', 'circular_132', 'circular_200',
]);
export const householdTier = pgEnum('household_tier', ['lt_200m', '200m_1b', 'gt_1b', 'gt_3b']);
export const groupType = pgEnum('group_type', ['STATUTORY', 'MANAGEMENT']);
export const controlType = pgEnum('control_type', ['subsidiary', 'associate', 'joint_venture']);
export const accountType = pgEnum('account_type', ['asset', 'liability', 'equity', 'revenue', 'expense']);
