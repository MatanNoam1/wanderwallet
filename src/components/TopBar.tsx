// Top bar: brand + trip account label + export action (export lands in P4).
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
      <button className="btn-ghost" type="button" disabled title="Coming in P4">
        ↧ Export
      </button>
    </header>
  );
}
