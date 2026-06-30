"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORY_KEYS, CATEGORIES } from "@/lib/categories";
import { SUPPORTED_CURRENCIES, fromMinor } from "@/lib/money";
import type { Expense, LineItem } from "@prisma/client";

type ExpenseWithItems = Expense & { items: LineItem[] };

export function ReviewForm({
  expense,
  baseCurrency,
}: {
  expense: ExpenseWithItems;
  baseCurrency: string;
}) {
  const router = useRouter();
  void baseCurrency; // available for future FX display

  const [amount, setAmount] = useState(
    expense.originalAmountMinor > 0
      ? String(fromMinor(expense.originalAmountMinor, expense.originalCurrency))
      : ""
  );
  const [currency, setCurrency] = useState(expense.originalCurrency);
  const [merchant, setMerchant] = useState(expense.merchant ?? "");
  const [category, setCategory] = useState<string>(expense.category);
  const [note, setNote] = useState(expense.note ?? "");
  const [items, setItems] = useState(
    expense.items.map((it) => ({
      name: it.name,
      qty: String(it.qty),
      unitPrice: String(fromMinor(it.unitPriceMinor, expense.originalCurrency)),
      total: String(fromMinor(it.lineTotalMinor, expense.originalCurrency)),
      category: it.category ?? "",
    }))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(discard: boolean) {
    setError(null);
    setBusy(true);
    try {
      const body = discard
        ? { discard: true }
        : {
            discard: false,
            amount: parseFloat(amount),
            currency,
            merchant: merchant || undefined,
            category,
            note: note || undefined,
            items: items.map((it) => ({
              name: it.name,
              qty: parseFloat(it.qty),
              unitPrice: parseFloat(it.unitPrice),
              total: parseFloat(it.total),
              category: it.category || null,
            })),
          };

      const res = await fetch(`/api/expenses/${expense.id}/confirm`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        setError(`Failed (${res.status})`);
        return;
      }
      router.push("/");
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="quickadd">
        <div>
          <label className="muted small">Amount</label>
          <input
            className="text-input"
            style={{ marginTop: 4, display: "block", width: "100%" }}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
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

        <input
          className="text-input"
          placeholder="Merchant"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
        />

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
          placeholder="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        {items.length > 0 && (
          <div>
            <p className="muted small" style={{ marginBottom: 8 }}>Line items</p>
            <table className="items-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        value={it.name}
                        onChange={(e) => {
                          const next = [...items];
                          next[i] = { ...next[i], name: e.target.value };
                          setItems(next);
                        }}
                      />
                    </td>
                    <td>
                      <input
                        value={it.qty}
                        style={{ width: 40 }}
                        onChange={(e) => {
                          const next = [...items];
                          next[i] = { ...next[i], qty: e.target.value };
                          setItems(next);
                        }}
                      />
                    </td>
                    <td>
                      <input
                        value={it.unitPrice}
                        style={{ width: 60 }}
                        onChange={(e) => {
                          const next = [...items];
                          next[i] = { ...next[i], unitPrice: e.target.value };
                          setItems(next);
                        }}
                      />
                    </td>
                    <td>
                      <input
                        value={it.total}
                        style={{ width: 60 }}
                        onChange={(e) => {
                          const next = [...items];
                          next[i] = { ...next[i], total: e.target.value };
                          setItems(next);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <div className="review-actions">
          <button className="btn-primary" onClick={() => submit(false)} disabled={busy}>
            {busy ? "Saving..." : "Confirm"}
          </button>
          <button className="btn-danger" onClick={() => submit(true)} disabled={busy}>
            Discard
          </button>
        </div>
      </div>
    </section>
  );
}
