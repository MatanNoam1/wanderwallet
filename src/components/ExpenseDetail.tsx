"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fmt } from "@/lib/money";
import { categoryMeta, CATEGORY_KEYS } from "@/lib/categories";

type ExpenseProps = {
  id: string;
  merchant: string | null;
  category: string;
  note: string | null;
  paidById: string;
  paidByName: string | null;
  paymentMethodId: string | null;
  paymentMethodLabel: string | null;
  originalAmountMinor: number;
  originalCurrency: string;
  baseAmountMinor: number;
  baseCurrency: string;
  occurredAt: string;
  items: { id: string; description: string; amountMinor: number; currency: string }[];
};

type Person = { id: string; name: string | null };
type Method = { id: string; label: string };

export function ExpenseDetail({
  expense,
  people,
  methods,
}: {
  expense: ExpenseProps;
  people: Person[];
  methods: Method[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [merchant, setMerchant] = useState(expense.merchant ?? "");
  const [category, setCategory] = useState(expense.category);
  const [note, setNote] = useState(expense.note ?? "");
  const [paidById, setPaidById] = useState(expense.paidById);
  const [methodId, setMethodId] = useState(expense.paymentMethodId ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cat = categoryMeta(expense.category);
  const date = new Date(expense.occurredAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/expenses/${expense.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant: merchant.trim(),
          category,
          note: note.trim(),
          paidById,
          paymentMethodId: methodId || null,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      setEditing(false);
      router.refresh();
    } catch {
      setError("Save failed. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this expense? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/expenses/${expense.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      router.push("/");
    } catch {
      setError("Delete failed.");
      setDeleting(false);
    }
  }

  return (
    <section className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span className="feed-icon" style={{ background: cat.color + "22" }}>{cat.icon}</span>
            <span className="feed-title" style={{ fontSize: "1.1rem" }}>
              {expense.merchant ?? cat.label}
            </span>
          </div>
          <div className="muted small">{date}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="feed-amount" style={{ fontSize: "1.2rem" }}>
            {fmt(expense.originalAmountMinor, expense.originalCurrency)}
          </div>
          {expense.originalCurrency !== expense.baseCurrency && (
            <div className="muted small">
              = {fmt(expense.baseAmountMinor, expense.baseCurrency)}
            </div>
          )}
        </div>
      </div>

      {!editing ? (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "16px" }}>
            <div className="feed-row">
              <span className="muted small">Category</span>
              <span>{cat.label}</span>
            </div>
            <div className="feed-row">
              <span className="muted small">Paid by</span>
              <span>{expense.paidByName ?? "-"}</span>
            </div>
            {expense.paymentMethodLabel && (
              <div className="feed-row">
                <span className="muted small">Method</span>
                <span>{expense.paymentMethodLabel}</span>
              </div>
            )}
            {expense.note && (
              <div className="feed-row">
                <span className="muted small">Note</span>
                <span>{expense.note}</span>
              </div>
            )}
          </div>

          {expense.items.length > 0 && (
            <div style={{ marginTop: "16px" }}>
              <div className="card-title" style={{ fontSize: "0.85rem", marginBottom: "8px" }}>Line items</div>
              <ul className="feed">
                {expense.items.map((li) => (
                  <li key={li.id} className="feed-row">
                    <span className="feed-main">{li.description}</span>
                    <span className="feed-amount">{fmt(li.amountMinor, li.currency)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ display: "flex", gap: "8px", marginTop: "20px" }}>
            <button className="btn-ghost" onClick={() => setEditing(true)} style={{ flex: 1 }}>
              Edit
            </button>
            <button
              className="btn-ghost"
              onClick={handleDelete}
              disabled={deleting}
              style={{ flex: 1, color: "#f87171" }}
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "16px" }}>
          <input
            className="text-input"
            placeholder="Merchant"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
          />
          <select
            className="text-input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORY_KEYS.map((k) => (
              <option key={k} value={k}>{categoryMeta(k).label}</option>
            ))}
          </select>
          <select
            className="text-input"
            value={paidById}
            onChange={(e) => setPaidById(e.target.value)}
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.name ?? p.id}</option>
            ))}
          </select>
          <select
            className="text-input"
            value={methodId}
            onChange={(e) => setMethodId(e.target.value)}
          >
            <option value="">No method</option>
            {methods.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <input
            className="text-input"
            placeholder="Note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && <p style={{ color: "#f87171", fontSize: "0.85rem" }}>{error}</p>}
          <div style={{ display: "flex", gap: "8px" }}>
            <button className="btn-ghost" onClick={() => setEditing(false)} style={{ flex: 1 }}>
              Cancel
            </button>
            <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ flex: 1 }}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
