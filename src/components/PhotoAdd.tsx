"use client";
import { useRef, useState } from "react";
import Link from "next/link";

type State =
  | { type: "idle" }
  | { type: "uploading" }
  | { type: "queued"; expenseId: string }
  | { type: "error"; msg: string };

export function PhotoAdd({ tripId }: { tripId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ type: "idle" });

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setState({ type: "uploading" });

    try {
      const form = new FormData();
      form.append("photo", file);
      form.append("tripId", tripId);

      const res = await fetch("/api/expenses/photo", { method: "POST", body: form });

      if (!res.ok) {
        setState({ type: "error", msg: `Upload failed (${res.status})` });
        return;
      }

      const { expenseId } = (await res.json()) as { expenseId: string };
      setState({ type: "queued", expenseId });
    } catch {
      setState({ type: "error", msg: "Network error" });
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="card">
      <h2 className="card-title">Scan a receipt</h2>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={handleFile}
      />

      {state.type === "idle" && (
        <button className="btn-primary" onClick={() => inputRef.current?.click()}>
          Take photo
        </button>
      )}

      {state.type === "uploading" && <p className="muted">Uploading...</p>}

      {state.type === "queued" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p className="muted small">
            Receipt sent for processing. We will update the feed when ready.
          </p>
          <Link
            href={`/expenses/${state.expenseId}/review`}
            className="btn-ghost"
            style={{ textAlign: "center" }}
          >
            Check status
          </Link>
          <button
            className="btn-primary"
            onClick={() => setState({ type: "idle" })}
          >
            Scan another
          </button>
        </div>
      )}

      {state.type === "error" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p className="error">{state.msg}</p>
          <button
            className="btn-primary"
            onClick={() => setState({ type: "idle" })}
          >
            Try again
          </button>
        </div>
      )}
    </section>
  );
}
