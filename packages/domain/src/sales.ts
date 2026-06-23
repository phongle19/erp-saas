import { money, applyRate, Rounding } from './money.js';

/** Whole-number percentages supported by VAT rule types (the effective value comes from tax_rules). */
export const VAT_RULE_TYPES = ['vat_rate', 'vat_rate_reduced', 'vat_rate_5', 'vat_zero', 'vat_exempt'] as const;
export type VatRuleType = (typeof VAT_RULE_TYPES)[number];

/** Integer-exact line net = quantity * unit price (both bigint minor units / whole units). */
export function lineNet(quantity: bigint, unitPriceMinor: bigint): bigint {
  if (quantity < 0n || unitPriceMinor < 0n) throw new Error('quantity and unit price must be non-negative');
  return quantity * unitPriceMinor;
}

/** VAT amount for a net base at a whole-number percent, HALF_UP, integer-exact (no float). */
export function vatFor(netMinor: bigint, ratePercent: bigint): bigint {
  if (netMinor < 0n) throw new Error('net must be non-negative');
  if (ratePercent < 0n) throw new Error('rate must be non-negative');
  return applyRate(money(netMinor, 'VND'), ratePercent, 100n, Rounding.HALF_UP).minor;
}
