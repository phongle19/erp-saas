import type { Regime, RegimeConfig } from './types.js';

// Map keyed by Regime — no hardcoded if/switch at call sites.
const regimeMap: Record<Regime, RegimeConfig> = {
  // Thông tư 133/2016/TT-BTC — chế độ kế toán doanh nghiệp nhỏ và vừa (DNNVV)
  circular_133: {
    regime: 'circular_133',
    label: 'Thông tư 133/2016/TT-BTC (DNNVV)',
    chartOfAccounts: [],    // Phase 1
    statementTemplates: [], // Phase 1
    declarationForms: [],   // Phase 1
  },
  // Thông tư 88/2021/TT-BTC — chế độ kế toán hộ kinh doanh, cá nhân kinh doanh
  circular_88: {
    regime: 'circular_88',
    label: 'Thông tư 88/2021/TT-BTC (Hộ kinh doanh)',
    chartOfAccounts: [],    // Phase 1
    statementTemplates: [], // Phase 1
    declarationForms: [],   // Phase 1
  },
  // Thông tư 132/2018/TT-BTC — chế độ kế toán doanh nghiệp siêu nhỏ
  circular_132: {
    regime: 'circular_132',
    label: 'Thông tư 132/2018/TT-BTC (Doanh nghiệp siêu nhỏ)',
    chartOfAccounts: [],    // Phase 1
    statementTemplates: [], // Phase 1
    declarationForms: [],   // Phase 1
  },
  // Thông tư 200/2014/TT-BTC — chế độ kế toán doanh nghiệp (tiêu chuẩn)
  circular_200: {
    regime: 'circular_200',
    label: 'Thông tư 200/2014/TT-BTC',
    chartOfAccounts: [],    // Phase 1
    statementTemplates: [], // Phase 1
    declarationForms: [],   // Phase 1
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
