/** ISO-4217 code; VND has minor_unit_scale 0 (no subunit). */
export type CurrencyCode = string;

/** Money is always integer minor units. Never use number for money. */
export interface Money {
  readonly minor: bigint;
  readonly currency: CurrencyCode;
}
