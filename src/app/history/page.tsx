"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { readArrayResponse } from "@/app/client-fetch";

type Band = { id: string; name: string };
type Venue = { id: string; name: string };
type Setlist = {
  id: string;
  venueId: string;
  bandId: string | null;
  title: string | null;
  performedAt: string | null;
  startTime: string | null;
  endTime: string | null;
  venueType?: string | null;
  crowdSetup?: string | null;
  createdAt: string;
  updatedAt: string;
  notes: string | null;
  setCount?: number;
  songCount?: number;
};

function formatHistoryDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function dateInputValue(value: string | null) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function formatTitleDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function formatTime(value: string | null | undefined) {
  if (!value) return null;
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function timeInputValue(value: string | null | undefined) {
  return value ? value.slice(0, 5) : "";
}

function timesAreValid(startTime: string, endTime: string) {
  return !startTime || !endTime || endTime > startTime;
}

function sortHistoryLists(lists: Setlist[]) {
  const time = (value: string | null | undefined) => value ? new Date(value).getTime() : Number.NEGATIVE_INFINITY;
  return [...lists].sort((a, b) => (
    time(b.performedAt) - time(a.performedAt)
    || time(b.updatedAt) - time(a.updatedAt)
    || time(b.createdAt) - time(a.createdAt)
  ));
}

function plural(value: number, label: string) {
  return `${value} ${label}${value === 1 ? "" : "s"}`;
}

async function readErrorMessage(response: Response) {
  const text = await response.text();
  if (!text) return `Request failed (${response.status})`;
  try { return JSON.stringify(JSON.parse(text)); } catch { return text; }
}

export default function HistoryPage() {
  const router = useRouter();
  const [bands, setBands] = useState<Band[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueId, setVenueId] = useState("");
  const [filterBandId, setFilterBandId] = useState("");
  const [lists, setLists] = useState<Setlist[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [timeDrafts, setTimeDrafts] = useState<Record<string, { startTime: string; endTime: string }>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const bandMap = useMemo(() => new Map(bands.map((band) => [band.id, band])), [bands]);
  const venueMap = useMemo(() => new Map(venues.map((venue) => [venue.id, venue])), [venues]);

  const loadLookups = useCallback(async () => {
    try {
      const [br, vr] = await Promise.all([
        fetch("/api/bands", { cache: "no-store" }),
        fetch("/api/venues", { cache: "no-store" }),
      ]);
      setBands(await readArrayResponse<Band>(br, router, "Bands"));
      setVenues(await readArrayResponse<Venue>(vr, router, "Venues"));
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Failed to load filters.");
      setBands([]);
      setVenues([]);
    }
  }, [router]);

  const loadLists = useCallback(async () => {
    const params = new URLSearchParams();
    if (venueId) params.set("venueId", venueId);
    if (filterBandId) params.set("bandId", filterBandId);
    const query = params.toString();
    try {
      const r = await fetch(`/api/setlists${query ? `?${query}` : ""}`, { cache: "no-store" });
      setLists(sortHistoryLists(await readArrayResponse<Setlist>(r, router, "Setlists")));
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Failed to load history.");
      setLists([]);
    }
  }, [filterBandId, router, venueId]);

  useEffect(() => { void loadLookups(); }, [loadLookups]);
  useEffect(() => { void loadLists(); }, [loadLists]);

  function displayTitle(list: Setlist) {
    if (list.title) return list.title;
    const bandName = list.bandId ? bandMap.get(list.bandId)?.name : null;
    const venueName = venueMap.get(list.venueId)?.name ?? `Venue ${list.venueId.slice(0, 6)}`;
    return `${bandName ? `${bandName} - ` : ""}${venueName} - ${formatHistoryDate(list.performedAt ?? list.createdAt)}`;
  }

  async function updateBand(list: Setlist, bandId: string) {
    setBusyId(list.id);
    setMsg(null);
    const r = await fetch(`/api/setlists/${list.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bandId: bandId || null }),
    });
    setBusyId(null);
    if (!r.ok) {
      setMsg(await readErrorMessage(r));
      return;
    }
    setLists((current) => sortHistoryLists(current.map((row) => (row.id === list.id ? { ...row, bandId: bandId || null } : row))));
    setMsg("Band assignment updated.");
  }
  async function updatePerformanceDate(list: Setlist, value: string) {
    if (!value) return;
    const bandName = list.bandId ? (bandMap.get(list.bandId)?.name ?? "") : "";
    const venueName = venueMap.get(list.venueId)?.name ?? "";
    const nextTitle = bandName && venueName ? `${bandName} - ${venueName} - ${formatTitleDate(value)}` : list.title;
    const nextPerformedAt = `${value}T12:00:00`;

    setBusyId(list.id);
    setMsg(null);
    const r = await fetch(`/api/setlists/${list.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ performedAt: nextPerformedAt, title: nextTitle }),
    });
    setBusyId(null);
    if (!r.ok) {
      setMsg(await readErrorMessage(r));
      return;
    }
    const detail = await r.json().catch(() => null);
    const updated = detail?.setlist;
    setLists((current) => sortHistoryLists(current.map((row) => (row.id === list.id ? {
      ...row,
      title: updated?.title ?? nextTitle,
      performedAt: updated?.performedAt ?? new Date(nextPerformedAt).toISOString(),
      updatedAt: updated?.updatedAt ?? new Date().toISOString(),
    } : row))));
    setMsg("Performance date updated.");
  }

  async function updateSetlistTimes(list: Setlist) {
    const draft = timeDrafts[list.id] ?? { startTime: timeInputValue(list.startTime), endTime: timeInputValue(list.endTime) };
    if (!timesAreValid(draft.startTime, draft.endTime)) {
      setMsg("End Time must be after Start Time.");
      return;
    }

    setBusyId(list.id);
    setMsg(null);
    const r = await fetch(`/api/setlists/${list.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startTime: draft.startTime || null,
        endTime: draft.endTime || null,
      }),
    });
    setBusyId(null);
    if (!r.ok) {
      setMsg(await readErrorMessage(r));
      return;
    }
    const detail = await r.json().catch(() => null);
    const updated = detail?.setlist;
    const nextStartTime = updated?.startTime ?? (draft.startTime || null);
    const nextEndTime = updated?.endTime ?? (draft.endTime || null);
    setLists((current) => sortHistoryLists(current.map((row) => (row.id === list.id ? {
      ...row,
      startTime: nextStartTime,
      endTime: nextEndTime,
      updatedAt: updated?.updatedAt ?? new Date().toISOString(),
    } : row))));
    setTimeDrafts((current) => {
      const next = { ...current };
      delete next[list.id];
      return next;
    });
    setMsg("Setlist times updated.");
  }

  async function duplicateList(list: Setlist) {
    setBusyId(list.id);
    setMsg(null);
    const r = await fetch(`/api/setlists/${list.id}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bandId: list.bandId }),
    });
    setBusyId(null);
    if (!r.ok) {
      setMsg(await readErrorMessage(r));
      return;
    }
    await loadLists();
    setMsg("Setlist duplicated.");
  }

  async function deleteList(list: Setlist) {
    if (!confirm(`Delete ${displayTitle(list)}?`)) return;
    setBusyId(list.id);
    setMsg(null);
    const r = await fetch(`/api/setlists/${list.id}`, { method: "DELETE" });
    setBusyId(null);
    if (!r.ok) {
      setMsg(await readErrorMessage(r));
      return;
    }
    setLists((current) => current.filter((row) => row.id !== list.id));
    setMsg("Setlist deleted.");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Set History</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Saved setlists, newest first.</p>
      </div>

      {msg && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">{msg}</div>}

      <div className="card flex max-w-2xl flex-wrap gap-3">
        <label className="block min-w-56 flex-1 text-sm text-[var(--muted)]">
          Filter by venue
          <select className="input mt-1" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
            <option value="">All venues</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label className="block min-w-56 flex-1 text-sm text-[var(--muted)]">
          Filter by band
          <select className="input mt-1" value={filterBandId} onChange={(e) => setFilterBandId(e.target.value)}>
            <option value="">All bands</option>
            {bands.map((band) => <option key={band.id} value={band.id}>{band.name}</option>)}
          </select>
        </label>
      </div>

      <ul className="space-y-2">
        {lists.map((l) => {
          const bandName = l.bandId ? (bandMap.get(l.bandId)?.name ?? `band id ${l.bandId.slice(0, 6)}`) : "No band";
          const venueName = venueMap.get(l.venueId)?.name ?? `venue id ${l.venueId.slice(0, 6)}`;
          const draft = timeDrafts[l.id] ?? { startTime: timeInputValue(l.startTime), endTime: timeInputValue(l.endTime) };
          const timesChanged = draft.startTime !== timeInputValue(l.startTime) || draft.endTime !== timeInputValue(l.endTime);
          return (
            <li key={l.id} className="card flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-64 flex-1">
                <div className="font-medium">{displayTitle(l)}</div>
                <div className="text-xs text-[var(--muted)]">
                  Performance date: {l.performedAt ? formatHistoryDate(l.performedAt) : "Not set"} &ndash; {bandName} &ndash; {venueName}
                </div>
                <div className="mt-1 text-xs text-[var(--muted)]">
                  Venue Type: {l.venueType ?? "Not set"} &bull; Crowd Setup: {l.crowdSetup ?? "Mixed"}
                </div>
                <div className="mt-1 text-xs text-[var(--muted)]">
                  Start: {formatTime(l.startTime) ?? "Not set"} &bull; End: {formatTime(l.endTime) ?? "Not set"}
                </div>
                <div className="mt-1 text-xs text-[var(--muted)]">
                  {plural(l.setCount ?? (l.songCount ? 1 : 0), "set")} &bull; {plural(l.songCount ?? 0, "song")}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {editingId === l.id && (
                  <input className="input w-36 px-2 py-1 text-xs" type="date" value={dateInputValue(l.performedAt)} disabled={busyId === l.id} onChange={(e) => void updatePerformanceDate(l, e.target.value)} />
                )}
                <label className="text-xs text-[var(--muted)]">
                  Start
                  <input
                    className="input ml-1 w-28 px-2 py-1 text-xs"
                    type="time"
                    value={draft.startTime}
                    disabled={busyId === l.id}
                    onChange={(e) => setTimeDrafts((current) => ({ ...current, [l.id]: { ...draft, startTime: e.target.value } }))}
                  />
                </label>
                <label className="text-xs text-[var(--muted)]">
                  End
                  <input
                    className="input ml-1 w-28 px-2 py-1 text-xs"
                    type="time"
                    value={draft.endTime}
                    disabled={busyId === l.id}
                    onChange={(e) => setTimeDrafts((current) => ({ ...current, [l.id]: { ...draft, endTime: e.target.value } }))}
                  />
                </label>
                {timesChanged && (
                  <button type="button" className="btn btn-primary px-3 py-1 text-xs" disabled={busyId === l.id} onClick={() => void updateSetlistTimes(l)}>
                    Save Times
                  </button>
                )}
                <select className="input w-44 px-2 py-1 text-xs" value={l.bandId ?? ""} disabled={busyId === l.id} onChange={(e) => void updateBand(l, e.target.value)}>
                  <option value="">No band</option>
                  {bands.map((band) => <option key={band.id} value={band.id}>{band.name}</option>)}
                </select>
                <button type="button" className="btn btn-ghost px-3 py-1 text-xs" disabled={busyId === l.id} onClick={() => void duplicateList(l)}>
                  Duplicate
                </button>
                <button type="button" className="btn btn-ghost px-3 py-1 text-xs text-rose-300" disabled={busyId === l.id} onClick={() => void deleteList(l)}>
                  Delete
                </button>
                <button type="button" className="btn btn-ghost px-3 py-1 text-xs" disabled={busyId === l.id} onClick={() => setEditingId((current) => current === l.id ? null : l.id)}>{editingId === l.id ? "Cancel" : "Edit"}</button>
                <Link href={`/history/${l.id}`} className="btn btn-ghost px-3 py-1 text-xs">Open</Link>
              </div>
            </li>
          );
        })}
        {lists.length === 0 && <li className="text-sm text-[var(--muted)]">No saved setlists yet.</li>}
      </ul>
    </div>
  );
}
