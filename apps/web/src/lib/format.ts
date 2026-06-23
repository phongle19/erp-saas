/**
 * Format a VND amount expressed as a bigint string (minor units = đồng, scale 0).
 * Uses Intl.NumberFormat with BigInt — exact, no float rounding.
 * Presentation-only; no accounting logic.
 */
export function formatVnd(minorString: string): string {
  try {
    return new Intl.NumberFormat("vi-VN").format(BigInt(minorString)) + " ₫";
  } catch {
    return minorString + " ₫";
  }
}
