"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type User = { id: string; email: string; role: "admin" | "member"; lastSeenAt: string | null };
type Band = { id: string; name: string };
type Membership = { userId: string; bandId: string };
type Invitation = {
  id: string;
  email: string;
  role: "admin" | "member";
  inviteUrl: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  status: "pending" | "accepted" | "expired";
  bands: Band[];
};

export default function AdminPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [bands, setBands] = useState<Band[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviteBandIds, setInviteBandIds] = useState<Set<string>>(new Set());
  const [pendingBandByUser, setPendingBandByUser] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [response, inviteResponse] = await Promise.all([fetch("/api/admin/users"), fetch("/api/admin/invitations")]);
    const data = await response.json();
    if (!response.ok) {
      setMsg(data?.error ?? "Admin access required.");
      return;
    }
    const inviteData = await inviteResponse.json().catch(() => null);
    setUsers(data.users ?? []);
    setBands(data.bands ?? []);
    setMemberships(data.memberships ?? []);
    setInvitations(Array.isArray(inviteData?.invitations) ? inviteData.invitations : []);
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

  async function createInvite(event: React.FormEvent) {
    event.preventDefault();
    setMsg(null);
    const response = await fetch("/api/admin/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole, bandIds: Array.from(inviteBandIds) }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      setMsg(data?.error ? JSON.stringify(data.error) : "Could not create invitation.");
      return;
    }
    setInviteEmail("");
    setInviteRole("member");
    setInviteBandIds(new Set());
    setInvitations(Array.isArray(data?.invitations) ? data.invitations : []);
    setMsg(`Invitation created: ${data?.inviteUrl ?? "copy the pending link below"}`);
  }

  function toggleInviteBand(bandId: string) {
    setInviteBandIds((current) => {
      const next = new Set(current);
      if (next.has(bandId)) next.delete(bandId);
      else next.add(bandId);
      return next;
    });
  }

  async function copyInvite(link: string) {
    await navigator.clipboard.writeText(link);
    setMsg("Invite link copied.");
  }

  async function refreshInvite(id: string) {
    const response = await fetch("/api/admin/invitations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      setMsg(data?.error ? JSON.stringify(data.error) : "Could not refresh invite.");
      return;
    }
    setInvitations(Array.isArray(data?.invitations) ? data.invitations : []);
    setMsg(`New invite link ready: ${data?.inviteUrl ?? "copy it below"}`);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Manage which users can access each band.</p>
      </div>

      {msg && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">{msg}</div>}

      <section className="card space-y-4">
        <div>
          <h2 className="font-medium text-[var(--accent)]">Invite tester</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Create a private signup link and grant band access before they join.</p>
        </div>
        <form className="grid gap-3 lg:grid-cols-[1.2fr_.7fr_1.4fr_auto]" onSubmit={createInvite}>
          <label className="block text-sm text-[var(--muted)]">
            Email
            <input className="input mt-1" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} required />
          </label>
          <label className="block text-sm text-[var(--muted)]">
            Role
            <select className="input mt-1" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "member" | "admin")}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <div className="text-sm text-[var(--muted)]">
            Bands
            <div className="mt-1 flex min-h-10 flex-wrap gap-2 rounded-lg border border-[var(--border)] bg-[#0f131a] px-2 py-2">
              {bands.map((band) => (
                <label key={band.id} className="flex items-center gap-1 text-xs text-[var(--text)]">
                  <input type="checkbox" checked={inviteBandIds.has(band.id)} onChange={() => toggleInviteBand(band.id)} />
                  {band.name}
                </label>
              ))}
              {bands.length === 0 && <span className="text-xs">No bands yet.</span>}
            </div>
          </div>
          <button type="submit" className="btn btn-primary self-end">Create invite</button>
        </form>
      </section>

      <section className="card space-y-3">
        <h2 className="font-medium text-[var(--accent)]">Invitations</h2>
        {invitations.map((invite) => (
          <div key={invite.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2">
            <div>
              <div className="font-medium">{invite.email}</div>
              <div className="text-xs text-[var(--muted)]">
                {invite.role} - {invite.status} - expires {new Date(invite.expiresAt).toLocaleDateString()}
              </div>
              <div className="mt-1 text-xs text-[var(--muted)]">
                {invite.role === "admin" ? "All bands" : invite.bands.map((band) => band.name).join(", ") || "No bands"}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-ghost px-3 py-1 text-xs" onClick={() => void copyInvite(invite.inviteUrl)}>Copy link</button>
              <button type="button" className="btn btn-ghost px-3 py-1 text-xs" onClick={() => void refreshInvite(invite.id)}>Resend link</button>
            </div>
          </div>
        ))}
        {invitations.length === 0 && <div className="text-sm text-[var(--muted)]">No invitations yet.</div>}
      </section>

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
