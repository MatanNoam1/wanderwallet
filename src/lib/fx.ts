import { prisma } from "./prisma";

// Foreign-exchange rates from Frankfurter (ECB data, free, no API key).
// We cache one rate per (base, quote, day) in the FxRate table so a trip's
// history is reproducible and we don't hammer the API. getRate returns
// "1 unit of `base` = N units of `quote`".

const FX_API_BASE = process.env.FX_API_BASE ?? "https://api.frankfurter.app";

/** Midnight UTC for `date` - the granularity we cache rates at. */
function dayUtc(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function fetchRate(base: string, quote: string): Promise<number> {
  const url = `${FX_API_BASE}/latest?from=${base}&to=${quote}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`FX fetch failed: ${res.status}`);
  const data = (await res.json()) as { rates?: Record<string, number> };
  const rate = data.rates?.[quote];
  if (typeof rate !== "number") throw new Error(`FX response missing ${quote}`);
  return rate;
}

/**
 * Rate to convert `base` -> `quote` (1 base = N quote). Same currency = 1.
 * Reads today's cached rate; otherwise fetches, caches, and returns it.
 * If the network fails, falls back to the most recent cached rate; throws only
 * when there is no cached rate at all.
 */
export async function getRate(base: string, quote: string): Promise<number> {
  base = base.toUpperCase();
  quote = quote.toUpperCase();
  if (base === quote) return 1;

  const today = dayUtc();
  const cached = await prisma.fxRate.findUnique({
    where: { base_quote_date: { base, quote, date: today } },
  });
  if (cached) return cached.rate;

  try {
    const rate = await fetchRate(base, quote);
    await prisma.fxRate.upsert({
      where: { base_quote_date: { base, quote, date: today } },
      create: { base, quote, rate, date: today },
      update: { rate },
    });
    return rate;
  } catch (err) {
    // ponytail: degrade to last known rate instead of failing a capture.
    const last = await prisma.fxRate.findFirst({
      where: { base, quote },
      orderBy: { date: "desc" },
    });
    if (last) return last.rate;
    throw err;
  }
}
