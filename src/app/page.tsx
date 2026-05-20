import Link from "next/link";

export default function HomePage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Plan gigs without repeating yourself</h1>
        <p className="mt-2 max-w-2xl text-[var(--muted)]">
          Import or enter your catalog, pull BPM from Deezer (no keys) with optional Spotify fallback, auto-build balanced sets,
          and keep per-venue history so the next night favors songs you have not leaned on lately.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/songs" className="card group hover:border-[var(--accent-dim)]">
          <h2 className="font-medium text-[var(--accent)]">Song library</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Add, edit, CSV import, BPM lookup</p>
        </Link>
        <Link href="/bands" className="card group hover:border-[var(--accent-dim)]">
          <h2 className="font-medium text-[var(--accent)]">Bands</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Keep setlists separated by group</p>
        </Link>
        <Link href="/venues" className="card group hover:border-[var(--accent-dim)]">
          <h2 className="font-medium text-[var(--accent)]">Venues</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Tag saved setlists by room</p>
        </Link>
        <Link href="/builder" className="card group hover:border-[var(--accent-dim)]">
          <h2 className="font-medium text-[var(--accent)]">Set builder</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Pick band, venue, songs, and set count</p>
        </Link>
        <Link href="/history" className="card group hover:border-[var(--accent-dim)]">
          <h2 className="font-medium text-[var(--accent)]">History</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Browse past nights by venue</p>
        </Link>
        <Link href="/reports" className="card group hover:border-[var(--accent-dim)]">
          <h2 className="font-medium text-[var(--accent)]">Reports</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Track song plays and venue rotation</p>
        </Link>
      </div>
      <section className="card text-sm text-[var(--muted)]">
        <p className="font-medium text-[var(--text)]">BPM from the internet</p>
        <p className="mt-2">
          BPM is resolved from the public Deezer catalog first (no API keys). If a track has no BPM there,
          optional <span className="mono">SPOTIFY_CLIENT_ID</span> /{" "}
          <span className="mono">SPOTIFY_CLIENT_SECRET</span> in{" "}
          <span className="mono rounded bg-[#0f131a] px-1">.env.local</span> enables Spotify audio features
          (tempo, energy, key) as a fallback.
        </p>
      </section>
    </div>
  );
}

