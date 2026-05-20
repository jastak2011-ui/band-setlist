export type SongBpmResult = {
  bpm: number | null;
  durationSec: number | null;
  musicalKey: string | null;
  source: "songbpm";
  url?: string;
  message?: string;
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textBetween(html: string, pattern: RegExp) {
  const match = html.match(pattern);
  return match?.[1]?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() ?? null;
}

function parseDuration(value: string | null) {
  if (!value) return null;
  const match = value.match(/^(\d+):(\d{1,2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function parseMetric(html: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return textBetween(
    html,
    new RegExp(`<dt[^>]*>\\s*${escaped}\\s*<\\/dt>\\s*<dd[^>]*>([\\s\\S]*?)<\\/dd>`, "i"),
  );
}

export async function lookupBpmFromSongBpm(title: string, artist: string): Promise<SongBpmResult> {
  const artistSlug = slugify(artist);
  const titleSlug = slugify(title);

  if (!artistSlug || !titleSlug) {
    return {
      bpm: null,
      durationSec: null,
      musicalKey: null,
      source: "songbpm",
      message: "SongBPM needs both artist and title to build a lookup URL.",
    };
  }

  const url = `https://songbpm.com/@${artistSlug}/${titleSlug}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Accept: "text/html",
        "User-Agent": "band-setlist/0.1 (+local BPM lookup)",
      },
    });
  } catch {
    return {
      bpm: null,
      durationSec: null,
      musicalKey: null,
      source: "songbpm",
      url,
      message: "SongBPM lookup failed before receiving a response.",
    };
  }

  if (!res.ok) {
    return {
      bpm: null,
      durationSec: null,
      musicalKey: null,
      source: "songbpm",
      url,
      message: `SongBPM lookup failed (${res.status}).`,
    };
  }

  const html = await res.text();
  const pageArtist = textBetween(html, /<h2[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/i);
  const pageTitle = textBetween(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);

  if (pageArtist && normalize(pageArtist) !== normalize(artist)) {
    return {
      bpm: null,
      durationSec: null,
      musicalKey: null,
      source: "songbpm",
      url,
      message: "SongBPM URL resolved to a different artist.",
    };
  }

  if (pageTitle && normalize(pageTitle) !== normalize(title)) {
    return {
      bpm: null,
      durationSec: null,
      musicalKey: null,
      source: "songbpm",
      url,
      message: "SongBPM URL resolved to a different title.",
    };
  }

  const bpmText = parseMetric(html, "Tempo (BPM)") ?? textBetween(html, /<span[^>]*>\s*(\d{2,3})\s*<span[^>]*>\s*BPM/i);
  const bpm = bpmText != null ? Number(bpmText) : null;
  const musicalKey = parseMetric(html, "Key");
  const durationSec = parseDuration(parseMetric(html, "Duration"));

  if (!Number.isInteger(bpm) || bpm == null || bpm <= 0) {
    return {
      bpm: null,
      durationSec,
      musicalKey,
      source: "songbpm",
      url,
      message: "SongBPM page did not include a usable BPM.",
    };
  }

  return {
    bpm,
    durationSec,
    musicalKey,
    source: "songbpm",
    url,
  };
}