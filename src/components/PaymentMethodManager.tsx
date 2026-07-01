"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Method = { id: string; label: string; last4: string | null; kind: string };

export function PaymentMethodManager({ initial }: { initial: Method[] }) {
  const router = useRouter();
  const [methods, setMethods] = useState(initial);
  const [label, setLabel] = useState("");
  const [last4, setLast4] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/payment-methods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          last4: last4.trim() || undefined,
          kind: "CARD",
        }),
      });
      if (!res.ok) { setError(`Failed (${res.status})`); return; }
      const { id } = (await res.json()) as { id: string };
      setMethods((prev) => [
        ...prev,
        { id, label: label.trim(), last4: last4.trim() || null, kind: "CARD" },
      ]);
      setLabel("");
      setLast4("");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function archive(id: string) {
    await fetch(`/api/payment-methods/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    setMethods((prev) => prev.filter((m) => m.id !== id));
    router.refresh();
  }

  return (
    <div>
      {methods.length === 0 ? (
        <p className="muted" style={{ marginBottom: "16px" }}>No payment methods yet.</p>
      ) : (
        <ul className="feed" style={{ marginBottom: "16px" }}>
          {methods.map((m) => (
            <li key={m.id} className="feed-row">
              <div className="feed-main">
                <div className="feed-title">{m.label}</div>
                <div className="feed-sub muted">{m.kind.toLowerCase()}</div>
              </div>
              <button
                className="btn-ghost"
                type="button"
                style={{ fontSize: "0.82rem" }}
                onClick={() => archive(m.id)}
              >
                Archive
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <input
          className="text-input"
          placeholder="Label - e.g. Visa 4242"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          className="text-input"
          placeholder="Last 4 digits (optional)"
          value={last4}
          onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
          maxLength={4}
        />
        {error && <p className="error">{error}</p>}
        <button
          className="btn-primary"
          type="submit"
          disabled={busy || !label.trim()}
        >
          {busy ? "Adding..." : "Add payment method"}
        </button>
      </form>
    </div>
  );
}
