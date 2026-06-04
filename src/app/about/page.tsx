import { releaseNotes, type ReleaseNote } from "@/lib/release-notes";
import { OpenAiTestButton } from "./openai-test-button";

const featureGroups = [
  {
    title: "Build smarter sets",
    items: [
      "AI-powered Set Builder with venue-aware recommendations, set analysis, and intelligent song sequencing.",
      "AI Recommended Order with Apply AI Order support in both Set Builder and Set History.",
    ],
  },
  {
    title: "Preserve the library",
    items: [
      "Song library with CSV, HTML, and OnSong archive imports.",
      "Full OnSong .archive import/export with round-trip song identity preservation.",
    ],
  },
  {
    title: "Learn from shows",
    items: [
      "Post-gig crowd response ratings by song, venue, band, and performance date.",
      "Venue-aware recommendations with scoring details and crowd-response history.",
    ],
  },
];

export default function AboutPage() {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-wide text-[var(--accent)]">About</p>
        <div className="max-w-3xl space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">Band Setlist</h1>
          <p className="text-sm leading-6 text-[var(--muted)]">
            Band Setlist helps working bands manage their song library, build smarter venue-specific setlists, analyze performance flow with AI, preserve OnSong compatibility, and learn from real crowd response over time.
          </p>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="card">
          <h2 className="mb-2 font-medium text-[var(--accent)]">What This App Does</h2>
          <p className="text-sm leading-6 text-[var(--muted)]">
            It gives working bands one place to maintain a shared song catalog, plan live sets, save show history, print practical setlists, and improve recommendations with actual performance results.
          </p>
        </div>
        {featureGroups.map((group) => (
          <div key={group.title} className="card">
            <h2 className="mb-2 font-medium text-[var(--accent)]">{group.title}</h2>
            <ul className="space-y-2 text-sm leading-6 text-[var(--muted)]">
              {group.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="mb-4">
          <h2 className="text-xl font-semibold">Key Features</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">The core tools that make the app useful before, during, and after shows.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {[
            "AI-powered Set Builder with venue-aware recommendations, set analysis, and intelligent song sequencing",
            "AI Recommended Order with Apply AI Order support in both Set Builder and Set History",
            "Full OnSong .archive import/export with round-trip song identity preservation",
            "Song library with CSV, HTML, and OnSong archive imports",
            "Metadata enrichment with Deezer, MusicBrainz, Last.fm, and local library matching",
            "Venue-aware recommendations with scoring details and crowd-response history",
            "Post-gig crowd response ratings by song, venue, band, and performance date",
            "Smart Builder metadata including singalong, danceability, energy, peak-hour, female participation, and audience age appeal",
            "Holiday seasonality controls using the existing Genre field",
            "Clean print/PDF layouts with Song, Artist, BPM, and set duration",
          ].map((feature) => (
            <div key={feature} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
              {feature}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Release Notes</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Major product milestones in reverse chronological order.</p>
        </div>
        <div className="space-y-3">
          {releaseNotes.map((release) => <ReleaseCard key={release.version} release={release} />)}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold">Admin / Debug</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Utilities for checking deployed service configuration.</p>
        </div>
        <OpenAiTestButton />
      </section>
    </div>
  );
}

function ReleaseCard({ release }: { release: ReleaseNote }) {
  return (
    <details className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-medium">
            {release.version} <span className="text-[var(--muted)]">- {release.date} - {release.title}</span>
          </div>
          <span className="text-xs text-[var(--accent)]">View notes</span>
        </div>
      </summary>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <ReleaseList title="Additions" items={release.additions} />
        <ReleaseList title="Changes" items={release.changes} />
        <ReleaseList title="Fixes" items={release.fixes} />
        <ReleaseList title="Notes" items={release.notes} />
      </div>
    </details>
  );
}

function ReleaseList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-[var(--accent)]">{title}</h3>
      {items.length > 0 ? (
        <ul className="space-y-1 text-sm leading-6 text-[var(--muted)]">
          {items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : (
        <p className="text-sm text-[var(--muted)]">None.</p>
      )}
    </div>
  );
}
