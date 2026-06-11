"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { readArrayResponse } from "@/app/client-fetch";

type Venue = { id: string; name: string; venueType: string | null; crowdSetup: string | null; createdAt: string };

const venueTypeOptions = ["Bar Crowd", "Brewery", "Private Party", "Wedding", "Corporate Event"];
const crowdSetupOptions = ["Seated", "Standing", "Mixed"];

export default function VenuesPage() {
  const router = useRouter();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [name, setName] = useState("");
  const [venueType, setVenueType] = useState("");
  const [crowdSetup, setCrowdSetup] = useState("Mixed");
  const [editing, setEditing] = useState<Record<string, { name: string; venueType: string; crowdSetup: string }>>({});
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/venues", { cache: "no-store" });
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
      body: JSON.stringify({ name, venueType: venueType || null, crowdSetup: crowdSetup || "Mixed" }),
    });
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    setName("");
    setVenueType("");
    setCrowdSetup("Mixed");
    await load();
  }

  async function saveVenue(id: string) {
    const draft = editing[id];
    if (!draft) return;
    setErr(null);
    const r = await fetch("/api/venues", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name: draft.name, venueType: draft.venueType || null, crowdSetup: draft.crowdSetup || "Mixed" }),
    });
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    const updated = await r.json();
    setVenues((current) => current.map((venue) => venue.id === id ? updated : venue));
    setEditing((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Venues</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Used when saving setlists and for rotation hints.</p>
      </div>
      <form onSubmit={add} className="card grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
        <input className="input" placeholder="Venue name" value={name} onChange={(e) => setName(e.target.value)} required />
        <select className="input" value={venueType} onChange={(e) => setVenueType(e.target.value)} title="Venue type">
          <option value="">Venue type</option>
          {venueTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <select className="input" value={crowdSetup} onChange={(e) => setCrowdSetup(e.target.value)} title="Crowd setup">
          {crowdSetupOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <button type="submit" className="btn btn-primary shrink-0">Add</button>
      </form>
      {err && <p className="text-sm text-rose-300">{err}</p>}
      <ul className="card divide-y divide-[var(--border)]">
        {venues.map((v) => {
          const draft = editing[v.id] ?? { name: v.name, venueType: v.venueType ?? "", crowdSetup: v.crowdSetup ?? "Mixed" };
          const isEditing = Boolean(editing[v.id]);
          return (
            <li key={v.id} className="grid gap-2 py-3 text-sm md:grid-cols-[1fr_auto_auto_auto] md:items-center">
              {isEditing ? (
                <>
                  <input className="input px-2 py-1 text-sm" value={draft.name} onChange={(e) => setEditing((current) => ({ ...current, [v.id]: { ...draft, name: e.target.value } }))} />
                  <select className="input px-2 py-1 text-sm" value={draft.venueType} onChange={(e) => setEditing((current) => ({ ...current, [v.id]: { ...draft, venueType: e.target.value } }))}>
                    <option value="">Venue type</option>
                    {venueTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <select className="input px-2 py-1 text-sm" value={draft.crowdSetup} onChange={(e) => setEditing((current) => ({ ...current, [v.id]: { ...draft, crowdSetup: e.target.value } }))}>
                    {crowdSetupOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <button type="button" className="btn btn-primary px-3 py-1 text-xs" onClick={() => void saveVenue(v.id)}>Save</button>
                    <button type="button" className="btn btn-ghost px-3 py-1 text-xs" onClick={() => setEditing((current) => {
                      const next = { ...current };
                      delete next[v.id];
                      return next;
                    })}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <div className="font-medium">{v.name}</div>
                    <div className="text-xs text-[var(--muted)]">{v.venueType ?? "No venue type"} - {v.crowdSetup ?? "Mixed"}</div>
                  </div>
                  <span className="text-xs text-[var(--muted)]">{v.venueType ?? "-"}</span>
                  <span className="text-xs text-[var(--muted)]">{v.crowdSetup ?? "Mixed"}</span>
                  <button type="button" className="btn btn-ghost px-3 py-1 text-xs" onClick={() => setEditing((current) => ({ ...current, [v.id]: draft }))}>Edit</button>
                </>
              )}
            </li>
          );
        })}
        {venues.length === 0 && <li className="py-2 text-sm text-[var(--muted)]">No venues yet.</li>}
      </ul>
    </div>
  );
}
