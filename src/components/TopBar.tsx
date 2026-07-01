import Link from "next/link";

export function TopBar({ subtitle }: { subtitle: string }) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">W</div>
        <div>
          <div className="brand-name">Wanderwallet</div>
          <div className="brand-sub">{subtitle}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
        <Link href="/settings" className="btn-ghost">
          Settings
        </Link>
        <Link href="/export" className="btn-ghost">
          ↧ Export
        </Link>
      </div>
    </header>
  );
}
