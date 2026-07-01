"use client";

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      style={{
        padding: "10px 18px",
        cursor: "pointer",
        borderRadius: "10px",
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.035)",
        color: "inherit",
        fontSize: "1rem",
        textAlign: "center",
        width: "100%",
      }}
    >
      Print / Save as PDF
    </button>
  );
}
