import { pgEnum } from 'drizzle-orm/pg-core';

export const accountingRegime = pgEnum('accounting_regime', [
  'circular_133', 'circular_88', 'circular_132', 'circular_200',
]);
export const householdTier = pgEnum('household_tier', ['lt_200m', '200m_1b', 'gt_1b', 'gt_3b']);
export const groupType = pgEnum('group_type', ['STATUTORY', 'MANAGEMENT']);
export const controlType = pgEnum('control_type', ['subsidiary', 'associate', 'joint_venture']);
export const accountType = pgEnum('account_type', ['asset', 'liability', 'equity', 'revenue', 'expense']);
export const periodType = pgEnum('period_type', ['regular', 'special']);
export const periodStatus = pgEnum('period_status', ['open', 'closed', 'locked']);
export const journalStatus = pgEnum('journal_status', ['draft', 'posted', 'reversed']);
export const partnerType = pgEnum('partner_type', ['customer', 'vendor', 'both']);
export const salesDocStatus = pgEnum('sales_doc_status', ['draft', 'posted', 'cancelled']);
export const einvoiceStatus = pgEnum('einvoice_status', ['pending', 'issued', 'failed', 'cancelled']);
export const einvoiceProvider = pgEnum('einvoice_provider', ['viettel', 'vnpt', 'misa']);
export const movementType = pgEnum('movement_type', ['receipt', 'issue']);
export const goodsIssueReason = pgEnum('goods_issue_reason', ['sale', 'consumption', 'adjustment']);
