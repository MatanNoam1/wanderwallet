"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { CATEGORIES } from "@/lib/categories";

type Person = { id: string; name: string | null };

export function ExpenseFilters({ people }: { people: Person[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "8px" }}>
      <select
        className="text-input"
        value={params.get("category") ?? ""}
        onChange={(e) => update("category", e.target.value)}
        style={{ flex: 1, minWidth: "120px" }}
      >
        <option value="">All categories</option>
        {Object.entries(CATEGORIES).map(([key, meta]) => (
          <option key={key} value={key}>{meta.label}</option>
        ))}
      </select>
      <select
        className="text-input"
        value={params.get("paidBy") ?? ""}
        onChange={(e) => update("paidBy", e.target.value)}
        style={{ flex: 1, minWidth: "120px" }}
      >
        <option value="">All people</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>{p.name ?? p.id}</option>
        ))}
      </select>
    </div>
  );
}
