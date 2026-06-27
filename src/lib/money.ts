// Money is stored as INTEGER minor units of its own currency, never as a float.
// The number of minor units in one major unit depends on the currency:
// USD/EUR have 2 decimals (100 cents = $1), JPY has 0 (1 yen IS the minor unit).
// Storing "cents" blindly corrupts zero-decimal currencies, so every conversion
// goes through decimalsFor().

export const CURRENCY_DECIMALS: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  THB: 2,
  JPY: 0,
  KRW: 0,
};

export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  THB: "฿",
  KRW: "₩",
};

/** Currencies offered in the quick-add form. */
export const SUPPORTED_CURRENCIES = ["USD", "EUR", "JPY", "GBP", "THB"] as const;

/** Decimal places for a currency. Unknown currencies default to 2. */
export function decimalsFor(currency: string): number {
  return CURRENCY_DECIMALS[currency.toUpperCase()] ?? 2;
}

export function symbolFor(currency: string): string {
  return CURRENCY_SYMBOLS[currency.toUpperCase()] ?? "";
}

/** Major amount (e.g. 12.5) -> integer minor units (e.g. 1250 for USD, 13 for JPY). */
export function toMinor(amount: number, currency: string): number {
  return Math.round(amount * 10 ** decimalsFor(currency));
}

/** Integer minor units -> major amount as a float (for display/math only). */
export function fromMinor(minor: number, currency: string): number {
  return minor / 10 ** decimalsFor(currency);
}

/** Format minor units as a human string, e.g. fmt(524000, "USD") -> "$5,240.00". */
export function fmt(minor: number, currency: string): string {
  const decimals = decimalsFor(currency);
  const value = fromMinor(minor, currency);
  const num = value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${symbolFor(currency)}${num}`;
}

/**
 * Convert a minor-unit amount from one currency to another using a known rate
 * (1 unit of `from` = `rate` units of `to`). Returns integer minor units in `to`.
 */
export function convertMinor(
  minorFrom: number,
  from: string,
  to: string,
  rate: number,
): number {
  if (from.toUpperCase() === to.toUpperCase()) return minorFrom;
  const majorFrom = fromMinor(minorFrom, from);
  return toMinor(majorFrom * rate, to);
}

/** "#a855f7" + 0.2 -> "rgba(168,85,247,0.2)". Used for chart/segment tinting. */
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
