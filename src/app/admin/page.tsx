"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type User = { id: string; email: string; role: "admin" | "member"; lastSeenAt: string | null };
type Band = { id: string; name: string };
type Membership = { userId: string; bandId: string };

export default function AdminPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [bands, setBands] = useState<Band[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [pendingBandByUser, setPendingBandByUser] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/users");
    const data = await response.json();
    if (!response.ok) {
      setMsg(data?.error ?? "Admin access required.");
      return;
    }
    setUsers(data.users ?? []);
    setBands(data.bands ?? []);
    setMemberships(data.memberships ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const bandMap = useMemo(() => new Map(bands.map((band) => [band.id, band])), [bands]);
  const membershipMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const membership of memberships) {
      if (!map.has(membership.userId)) map.set(membership.userId, new Set());
      map.get(membership.userId)?.add(membership.bandId);
    }
    return map;
  }, [memberships]);

  async function addMembership(userId: string) {
    const bandId = pendingBandByUser[userId];
    if (!bandId) return;
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, bandId }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      setMsg(data?.error ?? "Could not assign band.");
      return;
    }
    setPendingBandByUser((current) => ({ ...current, [userId]: "" }));
    await load();
  }

  async function removeMembership(userId: string, bandId: string) {
    const response = await fetch(`/api/admin/users?userId=${encodeURIComponent(userId)}&bandId=${encodeURIComponent(bandId)}`, { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      setMsg(data?.error ?? "Could not remove band access.");
      return;
    }
    await load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Manage which users can access each band.</p>
      </div>

      {msg && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">{msg}</div>}

      <div className="space-y-3">
        {users.map((user) => {
          const assigned = membershipMap.get(user.id) ?? new Set<string>();
          const availableBands = bands.filter((band) => !assigned.has(band.id));
          return (
            <section key={user.id} className="card space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{user.email}</div>
                  <div className="text-xs text-[var(--muted)]">{user.role}{user.lastSeenAt ? ` - last seen ${new Date(user.lastSeenAt).toLocaleString()}` : ""}</div>
                </div>
                {user.role === "admin" && <span className="rounded border border-emerald-500/30 px-2 py-1 text-xs text-emerald-200">All bands</span>}
              </div>

              {user.role !== "admin" && (
                <>
                  <div className="flex flex-wrap gap-2">
                    {Array.from(assigned).map((bandId) => (
                      <button key={bandId} type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => void removeMembership(user.id, bandId)}>
                        {bandMap.get(bandId)?.name ?? bandId} x
                      </button>
                    ))}
                    {assigned.size === 0 && <span className="text-xs text-[var(--muted)]">No band access yet.</span>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <select className="input max-w-xs" value={pendingBandByUser[user.id] ?? ""} onChange={(event) => setPendingBandByUser((current) => ({ ...current, [user.id]: event.target.value }))}>
                      <option value="">Choose band</option>
                      {availableBands.map((band) => <option key={band.id} value={band.id}>{band.name}</option>)}
                    </select>
                    <button type="button" className="btn btn-primary" disabled={!pendingBandByUser[user.id]} onClick={() => void addMembership(user.id)}>Grant access</button>
                  </div>
                </>
              )}
            </section>
          );
        })}
        {users.length === 0 && <div className="text-sm text-[var(--muted)]">No users have logged in yet.</div>}
      </div>
    </div>
  );
}

