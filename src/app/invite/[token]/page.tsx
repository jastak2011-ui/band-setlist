"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Invite = {
  email: string;
  role: "admin" | "member";
  status: "pending" | "accepted" | "expired";
  expiresAt: string;
  acceptedAt: string | null;
  bands: Array<{ id: string; name: string }>;
};

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/invitations/${encodeURIComponent(token)}`);
      const data = await response.json().catch(() => null);
      if (cancelled) return;
      if (!response.ok) {
        setMsg(data?.error ?? "Invitation not found.");
        return;
      }
      setInvite(data);
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function accept(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMsg(null);
    const response = await fetch(`/api/invitations/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) {
      setMsg(data?.error ?? "Could not accept invitation.");
      return;
    }
    setMsg(data?.message ?? "Invitation accepted.");
    if (data?.signedIn) {
      router.replace("/");
      router.refresh();
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Accept invitation</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Create your Band Setlist login from this private invite.</p>
      </div>

      {msg && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">{msg}</div>}

      {invite && (
        <form className="card space-y-4" onSubmit={accept}>
          <div>
            <div className="text-sm text-[var(--muted)]">Invited email</div>
            <div className="font-medium">{invite.email}</div>
          </div>
          <div>
            <div className="text-sm text-[var(--muted)]">Access</div>
            <div className="font-medium">{invite.role === "admin" ? "Admin - all bands" : invite.bands.map((band) => band.name).join(", ") || "No bands assigned"}</div>
          </div>
          <div className="text-xs text-[var(--muted)]">Expires {new Date(invite.expiresAt).toLocaleString()}</div>

          {invite.status === "pending" ? (
            <>
              <label className="block text-sm text-[var(--muted)]">
                Password
                <input className="input mt-1" type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="new-password" />
              </label>
              <button type="submit" className="btn btn-primary w-full" disabled={busy}>{busy ? "Creating account..." : "Create account"}</button>
            </>
          ) : (
            <div className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
              This invitation is {invite.status}.
            </div>
          )}
        </form>
      )}
    </div>
  );
}

