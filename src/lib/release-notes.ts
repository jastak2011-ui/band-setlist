export type ReleaseNote = {
  version: string;
  date: string;
  title: string;
  additions: string[];
  changes: string[];
  fixes: string[];
  notes: string[];
};

export const releaseNotes: ReleaseNote[] = [
  {
    version: "2026.10",
    date: "May 31, 2026",
    title: "Post-gig crowd response intelligence",
    additions: [
      "Crowd response ratings by song, setlist, venue, band, and performance date.",
      "Inline Set History rating controls with Poor, Okay, Good, and Great presets.",
      "Song library crowd response aggregates, including average response, times rated, best venue, and last rated date.",
      "Crowd response report sections for top songs, venue leaders, lowest response songs, and unrated songs.",
    ],
    changes: [
      "Venue-aware recommendations and Set Builder ranking now use actual crowd response history when available.",
      "Venue-specific response carries the most weight, followed by band-specific and global response.",
    ],
    fixes: [],
    notes: [
      "Crowd Familiarity remains general song metadata; Crowd Response is actual post-performance result data.",
    ],
  },
  {
    version: "2026.9",
    date: "May 31, 2026",
    title: "Venue-aware recommendations",
    additions: [
      "Venue-aware recommendations that account for venue history, band, performance date, seasonality, and smart metadata.",
      "Recommendation scores such as Wedding Fit and Corporate Event Fit.",
      "Recommendation reasons, scoring details, Add Song, Ignore Song, and excluded-song explanations.",
    ],
    changes: [
      "Suggested Next Picks became Venue-Aware Recommendations.",
      "Recommendations refresh when the selected Build Set For preset changes.",
    ],
    fixes: [],
    notes: [
      "Build Sets still organizes the selected song pool into the final setlist.",
    ],
  },
  {
    version: "2026.8",
    date: "May 30, 2026",
    title: "Set Builder intelligence",
    additions: [
      "Build Set For presets: Bar Crowd, Brewery, Private Party, Wedding, and Corporate Event.",
      "Set Analysis panel with opener and closer reasoning, engagement leaders, peak-hour songs, energy-flow notes, audience age distribution, and average scores.",
      "Smart placement for opener, closer, peak-hour songs, energy curve, transition flexibility, and audience age variety.",
    ],
    changes: [
      "Set Builder scoring now uses smart metadata including singalong, danceability, crowd familiarity, female participation, peak hour, and transition flexibility.",
    ],
    fixes: [],
    notes: [],
  },
  {
    version: "2026.7",
    date: "May 29, 2026",
    title: "Seasonality controls",
    additions: [
      "Holiday genre filtering based on the existing Genre field.",
      "Holiday active season from November 15 through December 31.",
      "Manual override warnings when Holiday songs are selected outside season.",
    ],
    changes: [
      "Holiday songs are excluded from automatic set builds and venue recommendations outside the holiday season.",
    ],
    fixes: [
      "Prevents songs such as Linus and Lucy from being recommended for non-holiday performances when tagged as Holiday.",
    ],
    notes: [
      "No new seasonal database fields were added.",
    ],
  },
  {
    version: "2026.6",
    date: "May 28, 2026",
    title: "Smart Builder metadata",
    additions: [
      "Singalong score, peak hour score, transition flexibility, audience age appeal, and female participation score.",
      "Smart fields for crowd familiarity, energy, danceability, vocal difficulty, opener candidate, and closer candidate.",
      "Manual override support for inferred metadata values.",
    ],
    changes: [
      "Set Builder now has richer signals for live-show pacing and audience engagement.",
    ],
    fixes: [],
    notes: [],
  },
  {
    version: "2026.5",
    date: "May 27, 2026",
    title: "Metadata enrichment",
    additions: [
      "Shared enrichment pipeline using local library data, Deezer, MusicBrainz, and Last.fm.",
      "Deezer BPM and duration lookup.",
      "MusicBrainz canonical title, artist, duration, and recording matching.",
      "Last.fm tag, genre, vibe, crowd, and smart metadata inference.",
      "Bulk enrichment and per-song BPM lookup.",
    ],
    changes: [
      "Metadata lookup and BPM lookup now use a shared enrichment flow.",
      "Preview-before-apply protects existing populated fields.",
    ],
    fixes: [
      "Authenticated users can enrich shared song metadata without band membership requirements.",
    ],
    notes: [
      "Spotify is not required for enrichment.",
    ],
  },
  {
    version: "2026.4",
    date: "May 26, 2026",
    title: "Import improvements",
    additions: [
      "CSV import with flexible headers and aliases.",
      "HTML setlist import.",
      "Import metadata detection from filenames.",
      "Duplicate song prevention and duplicate review tooling.",
    ],
    changes: [
      "Imports became more forgiving for common column names and exported setlist formats.",
    ],
    fixes: [
      "Improved handling for set marker rows in imported HTML tables.",
    ],
    notes: [],
  },
  {
    version: "2026.3",
    date: "May 25, 2026",
    title: "User accounts and permissions",
    additions: [
      "Supabase authentication.",
      "Admin and member users.",
      "Band-specific access controls.",
      "Private invitations and invitation band assignment.",
      "Password reset support.",
    ],
    changes: [
      "Protected routes now use server-side permission checks.",
    ],
    fixes: [],
    notes: [],
  },
  {
    version: "2026.2",
    date: "May 24, 2026",
    title: "Cloud persistence and deployment",
    additions: [
      "Supabase/PostgreSQL persistence.",
      "Render deployment support.",
      "GitHub deployment workflow.",
    ],
    changes: [
      "The app moved from local-only storage toward a persistent cloud database.",
    ],
    fixes: [],
    notes: [
      "Database bootstrap creates and updates schema safely without deleting existing data.",
    ],
  },
  {
    version: "2026.1",
    date: "May 14, 2026",
    title: "Initial app foundation",
    additions: [
      "Song library.",
      "Bands and venues.",
      "Set Builder.",
      "Set History.",
      "Reports foundation.",
      "History setlist printing and Reports print support.",
      "Drummer-friendly BPM print layout.",
    ],
    changes: [],
    fixes: [],
    notes: [
      "Established the first usable Band Setlist workflow: manage songs, build sets, save history, and print setlists.",
    ],
  },
];
