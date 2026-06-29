"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SUPPORTED_CURRENCIES, symbolFor } from "@/lib/money";
import { CATEGORIES, CATEGORY_KEYS } from "@/lib/categories";

type Person = { id: string; name: string | null };
type Method = { id: string; label: string };

export function QuickAdd({
  tripId,
  people,
  methods,
}: {
  tripId: string;
  people: Person[];
  methods: Method[];
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<string>("USD");
  const [category, setCategory] = useState<string>("FOOD");
  const [merchant, setMerchant] = useState("");
  const [methodId, setMethodId] = useState<string | undefined>(methods[0]?.id);
  const [paidById, setPaidById] = useState<string>(people[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = parseFloat(amount);
    if (!(value > 0)) {
      setError("Enter an amount greater than 0");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tripId,
          amount: value,
          currency,
          category,
          paidById,
          paymentMethodId: methodId,
          merchant: merchant || undefined,
        }),
      });
      if (!res.ok) {
        setError(`Could not save (${res.status})`);
        return;
      }
      setAmount("");
      setMerchant("");
      router.refresh(); // re-render the server dashboard with the new expense
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2 className="card-title">Log a new expense</h2>
      <form onSubmit={submit} className="quickadd">
        <div className="amount-field">
          <span className="amount-symbol">{symbolFor(currency)}</span>
          <input
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="amount-input"
            aria-label="Amount"
          />
        </div>

        <div className="pillrow">
          {SUPPORTED_CURRENCIES.map((c) => (
            <button
              key={c}
              type="button"
              className={`pill ${currency === c ? "pill-on" : ""}`}
              onClick={() => setCurrency(c)}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="pillrow wrap">
          {CATEGORY_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              className={`pill ${category === k ? "pill-on" : ""}`}
              onClick={() => setCategory(k)}
            >
              {CATEGORIES[k].icon} {CATEGORIES[k].label}
            </button>
          ))}
        </div>

        <input
          className="text-input"
          placeholder="Add a note - e.g. Nobu Malibu"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
        />

        {methods.length > 0 && (
          <div className="pillrow wrap">
            <span className="muted small">Paid with</span>
            {methods.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`pill ${methodId === m.id ? "pill-on" : ""}`}
                onClick={() => setMethodId(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        <div className="pillrow">
          {people.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`pill ${paidById === p.id ? "pill-on" : ""}`}
              onClick={() => setPaidById(p.id)}
            >
              {p.name ?? "Member"}
            </button>
          ))}
        </div>

        {error && <p className="error">{error}</p>}

        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? "Adding..." : "Add expense"}
        </button>
      </form>
    </section>
  );
}
