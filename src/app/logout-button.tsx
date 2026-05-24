"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <button type="button" className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]" disabled={busy} onClick={() => void logout()}>
      {busy ? "Logging out..." : "Log out"}
    </button>
  );
}

