export type Regime = 'circular_133' | 'circular_88' | 'circular_132' | 'circular_200';

export interface AccountSeed {
  code: string;
  name: string;            // Vietnamese
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  parentCode?: string;     // for sub-accounts
}

/**
 * A single line in a financial statement template.
 *
 * Leaf lines (with `accounts`) map to account prefixes and pull the balance
 * from the specified side (debit or credit).
 * Subtotal lines (with `subtotalOf`) aggregate the listed line codes.
 */
export interface StatementLine {
  code: string;            // e.g. BS line code '100', '110'
  label_vi: string;
  level: number;           // indentation depth (0 = top section header)
  accounts?: { prefixes: string[]; nature: 'debit' | 'credit' }; // leaf: net balance of matching accounts on this side
  subtotalOf?: string[];   // subtotal: sum of these StatementLine codes
}

export interface StatementTemplate {
  id: 'B01-DNN' | 'B02-DNN';
  title_vi: string;
  lines: StatementLine[];
}

export interface RegimeConfig {
  regime: Regime;
  label: string;                          // Vietnamese label
  chartOfAccounts: AccountSeed[];         // filled in Phase 1
  statementTemplates: StatementTemplate[]; // filled in Phase 1
  declarationForms: unknown[];            // filled in Phase 1
}
