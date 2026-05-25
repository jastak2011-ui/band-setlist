"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { readArrayResponse, readObjectResponse } from "@/app/client-fetch";
import { PrintButton } from "@/app/print-button";

type Venue = { id: string; name: string };
type Band = { id: string; name: string };
type ReportSong = {
  id: string;
  title: string;
  artist: string;
  playCount: number;
  setlistCount: number;
  playPercent: number;
};
type VenueReport = {
  id: string;
  name: string;
  totalSetlists: number;
  songs: ReportSong[];
};
type BandReport = {
  id: string | null;
  name: string;
  totalSetlists: number;
  venues: VenueReport[];
};

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

export default function ReportsPage() {
  const router = useRouter();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [bands, setBands] = useState<Band[]>([]);
  const [venueId, setVenueId] = useState("");
  const [bandId, setBandId] = useState("");
  const [reports, setReports] = useState<BandReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);

  const selectedVenueName = useMemo(
    () => venues.find((venue) => venue.id === venueId)?.name ?? "All venues",
    [venueId, venues],
  );
  const selectedBandName = useMemo(
    () => bands.find((band) => band.id === bandId)?.name ?? "All bands",
    [bandId, bands],
  );

  const uniqueSongCount = useMemo(() => {
    const ids = new Set<string>();
    for (const band of reports) {
      for (const venue of band.venues) {
        for (const song of venue.songs) ids.add(song.id);
      }
    }
    return ids.size;
  }, [reports]);
  const summary = useMemo(() => {
    const venueIds = new Set<string>();
    let totalSetlists = 0;
    for (const band of reports) {
      totalSetlists += band.totalSetlists;
      for (const venue of band.venues) venueIds.add(venue.id);
    }
    return { bandCount: reports.length, venueCount: venueIds.size, totalSetlists };
  }, [reports]);

  const loadFilters = useCallback(async () => {
    try {
      const [venueResponse, bandResponse] = await Promise.all([
        fetch("/api/venues", { cache: "no-store" }),
        fetch("/api/bands", { cache: "no-store" }),
      ]);
      setVenues(await readArrayResponse<Venue>(venueResponse, router, "Venues"));
      setBands(await readArrayResponse<Band>(bandResponse, router, "Bands"));
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Failed to load filters.");
      setVenues([]);
      setBands([]);
    }
  }, [router]);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    const params = new URLSearchParams();
    if (venueId) params.set("venueId", venueId);
    if (bandId) params.set("bandId", bandId);
    const query = params.toString();
    try {
      const response = await fetch(`/api/reports/venue-songs${query ? `?${query}` : ""}`, { cache: "no-store" });
      const json = await readObjectResponse<{ bands?: unknown }>(response, router, "Report");
      setReports(Array.isArray(json?.bands) ? json.bands as BandReport[] : []);
      setGeneratedAt(new Date());
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Failed to load report.");
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [bandId, router, venueId]);

  useEffect(() => {
    void loadFilters();
  }, [loadFilters]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">See which songs show up most often by band and venue.</p>
        </div>
        <div className="no-print flex flex-wrap items-end gap-3">
          <label className="block min-w-56 text-sm text-[var(--muted)]">
            Band
            <select className="input mt-1" value={bandId} onChange={(event) => setBandId(event.target.value)}>
              <option value="">All bands</option>
              {bands.map((band) => (
                <option key={band.id} value={band.id}>{band.name}</option>
              ))}
            </select>
          </label>
          <label className="block min-w-56 text-sm text-[var(--muted)]">
            Venue
            <select className="input mt-1" value={venueId} onChange={(event) => setVenueId(event.target.value)}>
              <option value="">All venues</option>
              {venues.map((venue) => (
                <option key={venue.id} value={venue.id}>{venue.name}</option>
              ))}
            </select>
          </label>
          <PrintButton />
        </div>
      </div>

      <section className="print-only space-y-1 border-b border-[var(--border)] pb-4">
        <h2 className="text-xl font-semibold">Songs by Band and Venue</h2>
        <div className="text-sm">Band filter: {selectedBandName}</div>
        <div className="text-sm">Venue filter: {selectedVenueName}</div>
        <div className="text-sm">Generated: {generatedAt ? generatedAt.toLocaleString() : new Date().toLocaleString()}</div>
        <div className="text-sm">
          {summary.bandCount} band{summary.bandCount === 1 ? "" : "s"} - {summary.venueCount} venue{summary.venueCount === 1 ? "" : "s"} - {summary.totalSetlists} setlist{summary.totalSetlists === 1 ? "" : "s"} - {uniqueSongCount} unique song{uniqueSongCount === 1 ? "" : "s"}
        </div>
      </section>

      {msg && <div className="no-print rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{msg}</div>}

      <section className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium text-[var(--accent)]">Songs by band and venue</h2>
          <div className="text-right">
            <div className="text-sm text-[var(--muted)]">{loading ? "Loading..." : `${selectedBandName} / ${selectedVenueName}`}</div>
            {!loading && <div className="mono mt-1 text-xs text-[var(--muted)]">Unique songs: {uniqueSongCount}</div>}
          </div>
        </div>
        <p className="no-print mb-4 text-xs text-[var(--muted)]">
          Percent played is the share of saved setlists for that band at that venue that included the song at least once.
        </p>

        {!loading && reports.length === 0 && <div className="py-6 text-sm text-[var(--muted)]">No saved setlists found for this report.</div>}

        <div className="space-y-8">
          {reports.map((band) => (
            <div key={band.id ?? "__none"} className="space-y-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] pb-2">
                <h3 className="text-lg font-medium text-[var(--accent)]">{band.name}</h3>
                <span className="text-xs text-[var(--muted)]">{band.totalSetlists} saved setlist{band.totalSetlists === 1 ? "" : "s"}</span>
              </div>

              {band.venues.map((venue) => (
                <div key={venue.id} className="space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h4 className="font-medium">{venue.name}</h4>
                    <span className="text-xs text-[var(--muted)]">{venue.totalSetlists} saved setlist{venue.totalSetlists === 1 ? "" : "s"} at this venue</span>
                  </div>
                  {venue.songs.length === 0 ? (
                    <div className="rounded-lg border border-[var(--border)] px-3 py-3 text-sm text-[var(--muted)]">No songs played here yet.</div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                      <table className="w-full min-w-[620px] border-collapse text-sm">
                        <thead className="bg-[#0f131a] text-left text-xs uppercase text-[var(--muted)]">
                          <tr>
                            <th className="px-3 py-2 font-medium">Song</th>
                            <th className="px-3 py-2 font-medium">Artist</th>
                            <th className="px-3 py-2 text-right font-medium">Times played</th>
                            <th className="px-3 py-2 text-right font-medium">Setlists</th>
                            <th className="px-3 py-2 text-right font-medium">% played</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {venue.songs.map((song) => (
                            <tr key={song.id}>
                              <td className="px-3 py-2 font-medium">{song.title}</td>
                              <td className="px-3 py-2 text-[var(--muted)]">{song.artist}</td>
                              <td className="mono px-3 py-2 text-right">{song.playCount}</td>
                              <td className="mono px-3 py-2 text-right">{song.setlistCount}</td>
                              <td className="mono px-3 py-2 text-right">{formatPercent(song.playPercent)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
