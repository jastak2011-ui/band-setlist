"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { readArrayResponse } from "@/app/client-fetch";

type Venue = { id: string; name: string; createdAt: string };

export default function VenuesPage() {
  const router = useRouter();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/venues");
      setVenues(await readArrayResponse<Venue>(r, router, "Venues"));
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Failed to load venues.");
      setVenues([]);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const r = await fetch("/api/venues", {
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
        <h1 className="text-2xl font-semibold">Venues</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Used when saving setlists and for rotation hints.</p>
      </div>
      <form onSubmit={add} className="card flex gap-2">
        <input
          className="input"
          placeholder="Venue name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button type="submit" className="btn btn-primary shrink-0">
          Add
        </button>
      </form>
      {err && <p className="text-sm text-rose-300">{err}</p>}
      <ul className="card divide-y divide-[var(--border)]">
        {venues.map((v) => (
          <li key={v.id} className="py-2 text-sm">
            {v.name}
          </li>
        ))}
        {venues.length === 0 && <li className="py-2 text-sm text-[var(--muted)]">No venues yet.</li>}
      </ul>
    </div>
  );
}
