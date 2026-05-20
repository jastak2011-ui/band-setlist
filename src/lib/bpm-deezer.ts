export type DeezerBpmResult = {
  bpm: number | null;
  durationSec: number | null;
  source: "deezer";
  deezerTrackId?: string;
  message?: string;
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreCandidate(
  candTitle: string,
  candArtist: string,
  wantTitle: string,
  wantArtist: string,
): number {
  const t = normalize(candTitle);
  const a = normalize(candArtist);
  const wt = normalize(wantTitle);
  const wa = normalize(wantArtist);
  let score = 0;
  if (t === wt) score += 12;
  else if (t.includes(wt) || wt.includes(t)) score += 6;
  const artistTokens = wa.split(" ").filter((x) => x.length > 1);
  if (a === wa) score += 12;
  else if (a.includes(wa)) score += 8;
  else if (artistTokens.length && artistTokens.every((tok) => a.includes(tok))) score += 5;
  return score;
}

type DeezerSearchTrack = {
  id: number;
  title: string;
  duration?: number;
  artist?: { name?: string };
};

type DeezerSearchResponse = { data?: DeezerSearchTrack[]; error?: unknown };
type DeezerTrackResponse = {
  id?: number;
  bpm?: number;
  duration?: number;
  error?: unknown;
};

/**
 * Deezer’s public catalog API does not require an app id or OAuth for read-only
 * search + track lookups. BPM is present on many (not all) tracks.
 */
export async function lookupBpmFromDeezer(
  title: string,
  artist: string,
): Promise<DeezerBpmResult> {
  const q = `${artist} ${title}`.trim();
  const searchUrl = new URL("https://api.deezer.com/search/track");
  searchUrl.searchParams.set("q", q);
  searchUrl.searchParams.set("limit", "15");

  const searchRes = await fetch(searchUrl.toString(), {
    headers: { Accept: "application/json" },
  });

  if (!searchRes.ok) {
    return {
      bpm: null,
      durationSec: null,
      source: "deezer",
      message: `Deezer search failed (${searchRes.status})`,
    };
  }

  const searchJson = (await searchRes.json()) as DeezerSearchResponse;
  if (searchJson.error) {
    return {
      bpm: null,
      durationSec: null,
      source: "deezer",
      message: "Deezer search returned an error payload.",
    };
  }

  const items = searchJson.data ?? [];
  if (items.length === 0) {
    return {
      bpm: null,
      durationSec: null,
      source: "deezer",
      message: "No Deezer track match for that title/artist.",
    };
  }

  let best = items[0];
  let bestScore = scoreCandidate(
    best.title,
    best.artist?.name ?? "",
    title,
    artist,
  );
  for (const cand of items.slice(1)) {
    const s = scoreCandidate(cand.title, cand.artist?.name ?? "", title, artist);
    if (s > bestScore) {
      best = cand;
      bestScore = s;
    }
  }

  if (bestScore < 4) {
    return {
      bpm: null,
      durationSec: null,
      source: "deezer",
      message:
        "Deezer results did not confidently match this title/artist. Try a shorter or alternate spelling.",
    };
  }

  const trackRes = await fetch(`https://api.deezer.com/track/${best.id}`, {
    headers: { Accept: "application/json" },
  });

  if (!trackRes.ok) {
    return {
      bpm: null,
      durationSec: typeof best.duration === "number" ? best.duration : null,
      source: "deezer",
      deezerTrackId: String(best.id),
      message: `Deezer track lookup failed (${trackRes.status})`,
    };
  }

  const trackJson = (await trackRes.json()) as DeezerTrackResponse;
  if (trackJson.error) {
    return {
      bpm: null,
      durationSec: typeof best.duration === "number" ? best.duration : null,
      source: "deezer",
      deezerTrackId: String(best.id),
      message: "Deezer track lookup returned an error payload.",
    };
  }

  const rawBpm = trackJson.bpm;
  const bpm =
    typeof rawBpm === "number" && Number.isFinite(rawBpm) && rawBpm > 0
      ? Math.round(rawBpm)
      : null;

  const durationSec =
    typeof trackJson.duration === "number"
      ? trackJson.duration
      : typeof best.duration === "number"
        ? best.duration
        : null;

  if (bpm == null) {
    return {
      bpm: null,
      durationSec,
      source: "deezer",
      deezerTrackId: trackJson.id != null ? String(trackJson.id) : String(best.id),
      message:
        "Deezer matched a track but has no BPM on file. Try Spotify in .env.local for audio features, or enter BPM manually.",
    };
  }

  return {
    bpm,
    durationSec,
    source: "deezer",
    deezerTrackId: trackJson.id != null ? String(trackJson.id) : String(best.id),
  };
}
