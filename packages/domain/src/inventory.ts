import { money, applyRate, Rounding } from './money.js';

export interface InventoryBalance {
  qty: bigint;
  value: bigint;
}

export interface IssueResult {
  costOut: bigint;
  qty: bigint;
  value: bigint;
}

/**
 * Receipt: add q units at total cost `cost`.
 *
 * The weighted-average (moving-average) unit cost is DERIVED (value / qty) — it is never
 * stored as a fraction, keeping everything integer-exact and reconcilable to the GL.
 *
 * Accounting basis: VAS 02 / Circular 133/2016/TT-BTC — periodic or perpetual weighted
 * average method for inventory valuation.
 */
export function receiptBalance(
  prevQty: bigint,
  prevValue: bigint,
  q: bigint,
  cost: bigint,
): InventoryBalance {
  if (q <= 0n) throw new Error('receipt quantity must be positive');
  if (cost < 0n) throw new Error('receipt cost must be non-negative');
  if (prevQty < 0n || prevValue < 0n) throw new Error('balances must be non-negative');
  return { qty: prevQty + q, value: prevValue + cost };
}

/**
 * Issue: remove q units at the current weighted-average cost.
 *
 * `costOut` is integer-exact: the residual stays in `value` so future issues reconcile.
 * Issuing the entire remaining qty takes the whole remaining value, clearing it to
 * exactly 0n — this prevents penny-rounding drift accumulating across many issues.
 *
 * Accounting basis: VAS 02 / Circular 133/2016/TT-BTC — moving-average COGS recognition.
 */
export function issueCost(
  prevQty: bigint,
  prevValue: bigint,
  q: bigint,
): IssueResult {
  if (q <= 0n) throw new Error('issue quantity must be positive');
  if (q > prevQty) throw new Error('cannot issue more than on-hand quantity');

  // Issuing everything → take the whole remaining value (no residual drift).
  // Otherwise derive cost via integer multiply-then-divide with HALF_UP rounding.
  const costOut =
    q === prevQty
      ? prevValue
      : applyRate(money(prevValue, 'VND'), q, prevQty, Rounding.HALF_UP).minor;

  return { costOut, qty: prevQty - q, value: prevValue - costOut };
}
