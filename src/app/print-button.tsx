"use client";

export function PrintButton({ className = "" }: { className?: string }) {
  return (
    <button type="button" className={`btn btn-ghost no-print ${className}`} onClick={() => window.print()}>
      Print / Save PDF
    </button>
  );
}
