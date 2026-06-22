export type Regime = 'circular_133' | 'circular_88' | 'circular_132' | 'circular_200';
export interface AccountSeed { code: string; name: string; type: 'asset'|'liability'|'equity'|'revenue'|'expense'; }
export interface RegimeConfig {
  regime: Regime;
  label: string;          // Vietnamese label
  chartOfAccounts: AccountSeed[];   // filled in Phase 1
  statementTemplates: unknown[];    // filled in Phase 1
  declarationForms: unknown[];      // filled in Phase 1
}
