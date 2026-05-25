"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { readArrayResponse } from "@/app/client-fetch";

type Band = { id: string; name: string; createdAt: string };

export default function BandsPage() {
  const router = useRouter();
  const [bands, setBands] = useState<Band[]>([]);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/bands", { cache: "no-store" });
      setBands(await readArrayResponse<Band>(r, router, "Bands"));
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Failed to load bands.");
      setBands([]);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const r = await fetch("/api/bands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    setName("");
    await load();
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Bands</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Used to keep setlists and venue rotation separate by band.</p>
      </div>
      <form onSubmit={add} className="card flex gap-2">
        <input className="input" placeholder="Band name" value={name} onChange={(e) => setName(e.target.value)} required />
        <button type="submit" className="btn btn-primary shrink-0">Add</button>
      </form>
      {err && <p className="text-sm text-rose-300">{err}</p>}
      <ul className="card divide-y divide-[var(--border)]">
        {bands.map((band) => <li key={band.id} className="py-2 text-sm">{band.name}</li>)}
        {bands.length === 0 && <li className="py-2 text-sm text-[var(--muted)]">No bands yet.</li>}
      </ul>
    </div>
  );
}
