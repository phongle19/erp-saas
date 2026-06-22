import type { Regime, RegimeConfig, AccountSeed, StatementTemplate } from './types.js';
import { circular133Accounts } from './coa/circular-133.js';
import { circular88Accounts } from './coa/circular-88.js';
import { circular133Statements } from './statements/circular-133.js';

// Map keyed by Regime — no hardcoded if/switch at call sites.
const regimeMap: Record<Regime, RegimeConfig> = {
  // Thông tư 133/2016/TT-BTC — chế độ kế toán doanh nghiệp nhỏ và vừa (DNNVV)
  circular_133: {
    regime: 'circular_133',
    label: 'Thông tư 133/2016/TT-BTC (DNNVV)',
    chartOfAccounts: circular133Accounts,
    statementTemplates: circular133Statements,
    declarationForms: [],
  },
  // Thông tư 88/2021/TT-BTC — chế độ kế toán hộ kinh doanh, cá nhân kinh doanh
  circular_88: {
    regime: 'circular_88',
    label: 'Thông tư 88/2021/TT-BTC (Hộ kinh doanh)',
    chartOfAccounts: circular88Accounts,
    statementTemplates: [], // TT88 does not mandate BS/IS in the same B0x-DNN format
    declarationForms: [],
  },
  // Thông tư 132/2018/TT-BTC — chế độ kế toán doanh nghiệp siêu nhỏ
  circular_132: {
    regime: 'circular_132',
    label: 'Thông tư 132/2018/TT-BTC (Doanh nghiệp siêu nhỏ)',
    chartOfAccounts: [],    // not in scope for this task
    statementTemplates: [],
    declarationForms: [],
  },
  // Thông tư 200/2014/TT-BTC — chế độ kế toán doanh nghiệp (tiêu chuẩn)
  circular_200: {
    regime: 'circular_200',
    label: 'Thông tư 200/2014/TT-BTC',
    chartOfAccounts: [],    // not in scope for this task
    statementTemplates: [],
    declarationForms: [],
  },
};

export function getRegimeConfig(regime: Regime): RegimeConfig {
  const config = regimeMap[regime];
  if (!config) throw new Error('unknown regime: ' + (regime as string));
  return config;
}

export function listRegimes(): Regime[] {
  return Object.keys(regimeMap) as Regime[];
}

/**
 * Returns the chart of accounts for the given regime.
 * Throws on unknown regime (consistent with getRegimeConfig).
 */
export function getChartOfAccounts(regime: Regime): AccountSeed[] {
  return getRegimeConfig(regime).chartOfAccounts;
}

/**
 * Returns the financial statement templates for the given regime.
 * Throws on unknown regime (consistent with getRegimeConfig).
 */
export function getStatementTemplates(regime: Regime): StatementTemplate[] {
  return getRegimeConfig(regime).statementTemplates;
}
