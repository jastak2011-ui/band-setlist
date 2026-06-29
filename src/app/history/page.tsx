"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { readArrayResponse } from "@/app/client-fetch";

type Band = { id: string; name: string };
type Venue = { id: string; name: string; venueType?: string | null; crowdSetup?: string | null };
type Setlist = {
  id: string;
  venueId: string | null;
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
type OnSongSetImportDetail = {
  row: number;
  title: string | null;
  artist: string | null;
  status: "created" | "matched" | "updated" | "skipped";
  linked: boolean;
  reason: string;
  missingIdentityFields?: string[];
};
type OnSongSetImportResult = {
  setlistId: string;
  setlistTitle: string;
  songsFound: number;
  songsProcessed?: number;
  created: number;
  matched: number;
  updated: number;
  skipped: number;
  rowIssues?: number;
  incomplete?: boolean;
  errors?: string[];
  details?: OnSongSetImportDetail[];
};

const venueTypeOptions = ["", "Bar Crowd", "Brewery", "Restaurant", "Outdoor", "Private Party", "Wedding", "Corporate Event"];
const crowdSetupOptions = ["", "Seated", "Standing", "Mixed"];

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

function minutesFromTime(value: string) {
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function timesAreValid(startTime: string, endTime: string) {
  if (!startTime || !endTime) return true;
  const start = minutesFromTime(startTime);
  const end = minutesFromTime(endTime);
  if (start == null || end == null) return false;
  return start !== end;
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

function readResponseJson(text: string) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function archiveTitleFromFile(file: File) {
  return file.name.replace(/\.archive$/i, "").trim();
}

function filenameFromDisposition(value: string | null) {
  if (!value) return null;
  const match = value.match(/filename="([^"]+)"/i) ?? value.match(/filename=([^;]+)/i);
  return match?.[1]?.trim() ?? null;
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
  const [showOnSongImport, setShowOnSongImport] = useState(false);
  const [onSongFile, setOnSongFile] = useState<File | null>(null);
  const [onSongTitle, setOnSongTitle] = useState("");
  const [onSongBandId, setOnSongBandId] = useState("");
  const [onSongVenueId, setOnSongVenueId] = useState("");
  const [onSongPerformanceDate, setOnSongPerformanceDate] = useState("");
  const [onSongVenueType, setOnSongVenueType] = useState("");
  const [onSongCrowdSetup, setOnSongCrowdSetup] = useState("Mixed");
  const [onSongStartTime, setOnSongStartTime] = useState("");
  const [onSongEndTime, setOnSongEndTime] = useState("");
  const [onSongMatchExisting, setOnSongMatchExisting] = useState(true);
  const [onSongImportMissing, setOnSongImportMissing] = useState(true);
  const [onSongUpdateMetadata, setOnSongUpdateMetadata] = useState(false);
  const [onSongPreserveMetadata, setOnSongPreserveMetadata] = useState(true);
  const [onSongImportBusy, setOnSongImportBusy] = useState(false);
  const [onSongExportBusy, setOnSongExportBusy] = useState(false);
  const [onSongImportResult, setOnSongImportResult] = useState<OnSongSetImportResult | null>(null);

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
    const venueName = list.venueId ? (venueMap.get(list.venueId)?.name ?? `Venue ${list.venueId.slice(0, 6)}`) : "Not specified";
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
    const venueName = list.venueId ? (venueMap.get(list.venueId)?.name ?? "") : "";
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
      setMsg("Start Time and End Time cannot be the same.");
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

  function selectOnSongVenue(id: string) {
    setOnSongVenueId(id);
    const venue = venues.find((row) => row.id === id);
    if (venue) {
      setOnSongVenueType(venue.venueType ?? "");
      setOnSongCrowdSetup(venue.crowdSetup ?? "Mixed");
    }
  }

  function selectOnSongFile(file: File | null) {
    setOnSongImportResult(null);
    if (!file) {
      setOnSongFile(null);
      return;
    }
    if (!file.name.toLowerCase().endsWith(".archive")) {
      setMsg("Choose an OnSong .archive file.");
      setOnSongFile(null);
      return;
    }
    setMsg(null);
    setOnSongFile(file);
    if (!onSongTitle.trim()) setOnSongTitle(archiveTitleFromFile(file));
  }

  async function importOnSongSet() {
    if (!onSongFile) {
      setMsg("Choose an OnSong .archive file.");
      return;
    }
    if (!timesAreValid(onSongStartTime, onSongEndTime)) {
      setMsg("Start Time and End Time cannot be the same.");
      return;
    }

    const form = new FormData();
    form.set("file", onSongFile);
    form.set("title", onSongTitle);
    form.set("bandId", onSongBandId);
    form.set("venueId", onSongVenueId);
    form.set("performanceDate", onSongPerformanceDate);
    form.set("venueType", onSongVenueType);
    form.set("crowdSetup", onSongCrowdSetup);
    form.set("startTime", onSongStartTime);
    form.set("endTime", onSongEndTime);
    form.set("matchExistingSongs", String(onSongMatchExisting));
    form.set("importMissingSongs", String(onSongImportMissing));
    form.set("updateExistingSongMetadata", String(onSongUpdateMetadata));
    form.set("preserveBandSetlistMetadata", String(onSongPreserveMetadata));

    setOnSongImportBusy(true);
    setMsg(null);
    try {
      const response = await fetch("/api/setlists/import-onsong", {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      const text = await response.text();
      const data = readResponseJson(text);
      if (!response.ok || !data?.ok) {
        const error = data?.error ? (typeof data.error === "string" ? data.error : JSON.stringify(data.error)) : text || `Import failed (${response.status})`;
        setMsg(error);
        return;
      }
      setOnSongImportResult(data as OnSongSetImportResult);
      await loadLists();
      setMsg(`Imported OnSong set "${data.setlistTitle}".`);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "OnSong set import failed.");
    } finally {
      setOnSongImportBusy(false);
    }
  }

  async function exportImportedBpmPrompter() {
    if (!onSongImportResult?.setlistId) return;
    setOnSongExportBusy(true);
    setMsg(null);
    try {
      const response = await fetch(`/api/setlists/${onSongImportResult.setlistId}/bpm-prompter-export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        setMsg(await readErrorMessage(response));
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filenameFromDisposition(response.headers.get("Content-Disposition")) ?? "Band Setlist - BPM Prompter.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMsg("BPM Prompter export downloaded.");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "BPM Prompter export failed.");
    } finally {
      setOnSongExportBusy(false);
    }
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

      <div className="card max-w-5xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Import OnSong Set</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">Import an OnSong SongSet .archive as a saved setlist while matching existing songs and preserving OnSong links.</p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => setShowOnSongImport((current) => !current)}>
            {showOnSongImport ? "Hide Import" : "Import OnSong Set"}
          </button>
        </div>

        {showOnSongImport && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="block text-sm text-[var(--muted)]">
                OnSong .archive
                <input
                  className="input mt-1"
                  type="file"
                  accept=".archive"
                  disabled={onSongImportBusy}
                  onChange={(e) => selectOnSongFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <label className="block text-sm text-[var(--muted)]">
                Setlist title
                <input className="input mt-1" value={onSongTitle} disabled={onSongImportBusy} onChange={(e) => setOnSongTitle(e.target.value)} placeholder="Defaults to archive title" />
              </label>
              <label className="block text-sm text-[var(--muted)]">
                Performance date
                <input className="input mt-1" type="date" value={onSongPerformanceDate} disabled={onSongImportBusy} onChange={(e) => setOnSongPerformanceDate(e.target.value)} />
              </label>
              <label className="block text-sm text-[var(--muted)]">
                Band
                <select className="input mt-1" value={onSongBandId} disabled={onSongImportBusy} onChange={(e) => setOnSongBandId(e.target.value)}>
                  <option value="">No band / choose if required</option>
                  {bands.map((band) => <option key={band.id} value={band.id}>{band.name}</option>)}
                </select>
              </label>
              <label className="block text-sm text-[var(--muted)]">
                Venue
                <select className="input mt-1" value={onSongVenueId} disabled={onSongImportBusy} onChange={(e) => selectOnSongVenue(e.target.value)}>
                  <option value="">Imported OnSong venue</option>
                  {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
                </select>
              </label>
              <label className="block text-sm text-[var(--muted)]">
                Venue Type
                <select className="input mt-1" value={onSongVenueType} disabled={onSongImportBusy} onChange={(e) => setOnSongVenueType(e.target.value)}>
                  {venueTypeOptions.map((value) => <option key={value || "blank"} value={value}>{value || "Not set"}</option>)}
                </select>
              </label>
              <label className="block text-sm text-[var(--muted)]">
                Crowd Setup
                <select className="input mt-1" value={onSongCrowdSetup} disabled={onSongImportBusy} onChange={(e) => setOnSongCrowdSetup(e.target.value)}>
                  {crowdSetupOptions.map((value) => <option key={value || "blank"} value={value}>{value || "Not set"}</option>)}
                </select>
              </label>
              <label className="block text-sm text-[var(--muted)]">
                Start Time
                <input className="input mt-1" type="time" value={onSongStartTime} disabled={onSongImportBusy} onChange={(e) => setOnSongStartTime(e.target.value)} />
              </label>
              <label className="block text-sm text-[var(--muted)]">
                End Time
                <input className="input mt-1" type="time" value={onSongEndTime} disabled={onSongImportBusy} onChange={(e) => setOnSongEndTime(e.target.value)} />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <input type="checkbox" checked={onSongMatchExisting} disabled={onSongImportBusy} onChange={(e) => setOnSongMatchExisting(e.target.checked)} />
                Match existing songs
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <input type="checkbox" checked={onSongImportMissing} disabled={onSongImportBusy} onChange={(e) => setOnSongImportMissing(e.target.checked)} />
                Import missing songs
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <input type="checkbox" checked={onSongUpdateMetadata} disabled={onSongImportBusy} onChange={(e) => setOnSongUpdateMetadata(e.target.checked)} />
                Update existing song metadata from OnSong
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <input type="checkbox" checked={onSongPreserveMetadata} disabled={onSongImportBusy} onChange={(e) => setOnSongPreserveMetadata(e.target.checked)} />
                Preserve Band Setlist metadata
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-primary" disabled={onSongImportBusy || !onSongFile} onClick={() => void importOnSongSet()}>
                {onSongImportBusy ? "Importing..." : "Create Set History Import"}
              </button>
              {onSongFile && <span className="text-xs text-[var(--muted)]">{onSongFile.name}</span>}
            </div>

            {onSongImportResult && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
                <div className="font-medium">Import Complete</div>
                <div className="mt-2 grid gap-1 text-xs text-[var(--muted)] sm:grid-cols-2 lg:grid-cols-3">
                  <div>{onSongImportResult.songsProcessed ?? onSongImportResult.songsFound} songs processed</div>
                  <div>{onSongImportResult.matched} matched existing songs</div>
                  <div>{onSongImportResult.created} new songs created</div>
                  <div>{onSongImportResult.updated} updated with OnSong identity</div>
                  <div>{onSongImportResult.skipped} skipped</div>
                  <div>{onSongImportResult.rowIssues ?? onSongImportResult.errors?.length ?? 0} row issues</div>
                  <div className="sm:col-span-2 lg:col-span-3">Setlist created: {onSongImportResult.setlistTitle}</div>
                </div>
                {onSongImportResult.incomplete && (
                  <div className="mt-2 text-xs text-amber-200">This imported setlist is incomplete because skipped songs were not included.</div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link className="btn btn-ghost px-3 py-1 text-xs" href={`/history/${onSongImportResult.setlistId}`}>Open Set</Link>
                  <Link className="btn btn-ghost px-3 py-1 text-xs" href={`/history/${onSongImportResult.setlistId}`}>Run AI Analysis</Link>
                  <button type="button" className="btn btn-ghost px-3 py-1 text-xs" disabled={onSongExportBusy} onClick={() => void exportImportedBpmPrompter()}>
                    {onSongExportBusy ? "Exporting" : "BPM Prompter Export"}
                  </button>
                </div>
                {(onSongImportResult.details?.length ?? 0) > 0 && (
                  <div className="mt-3 max-h-72 overflow-auto rounded border border-white/10 bg-black/10">
                    {onSongImportResult.details?.slice(0, 50).map((detail) => (
                      <div key={`${detail.row}-${detail.title ?? "song"}`} className="border-b border-white/10 px-3 py-2 last:border-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{detail.title || "Untitled"}</span>
                          <span className="text-xs text-[var(--muted)]">{detail.artist || "Unknown artist"}</span>
                          <span className="rounded border border-white/15 px-2 py-0.5 text-xs">{detail.status}{detail.linked ? " + OnSong Linked" : ""}</span>
                        </div>
                        <div className="mt-1 text-xs text-[var(--muted)]">{detail.reason}</div>
                        {!detail.linked && (detail.missingIdentityFields?.length ?? 0) > 0 && (
                          <div className="mt-1 text-xs text-amber-200">Missing identity fields: {detail.missingIdentityFields?.join(", ")}</div>
                        )}
                      </div>
                    ))}
                    {(onSongImportResult.details?.length ?? 0) > 50 && (
                      <div className="px-3 py-2 text-xs text-[var(--muted)]">Showing first 50 import details.</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <ul className="space-y-2">
        {lists.map((l) => {
          const bandName = l.bandId ? (bandMap.get(l.bandId)?.name ?? `band id ${l.bandId.slice(0, 6)}`) : "No band";
          const venueName = l.venueId ? (venueMap.get(l.venueId)?.name ?? `venue id ${l.venueId.slice(0, 6)}`) : "Not specified";
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
