import { z } from "zod";
import { authErrorResponse, privateJson, requireBandAccess, requireUser } from "@/lib/auth";
import { mapSetlist, query, querySongsByIds, type DbSetlist, type DbSong } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

type ExportSetlist = DbSetlist & {
  venueName: string;
  bandName: string | null;
};

type ExportSet = {
  index: number;
  songs: DbSong[];
};

const exportBody = z.object({
  sets: z.array(z.array(z.string()).min(0)).min(1).optional(),
});

export const dynamic = "force-dynamic";

async function loadSetlist(id: string): Promise<ExportSetlist | null> {
  const result = await query(
    `
    SELECT sl.*, v.name AS venue_name, b.name AS band_name
    FROM setlists sl
    JOIN venues v ON v.id = sl.venue_id
    LEFT JOIN bands b ON b.id = sl.band_id
    WHERE sl.id = $1
    `,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...mapSetlist(row),
    venueName: row.venue_name as string,
    bandName: (row.band_name as string | null) ?? null,
  };
}

async function loadSavedSetSongIds(id: string) {
  const setResult = await query("SELECT id FROM setlist_sets WHERE setlist_id = $1 ORDER BY set_index", [id]);
  const sets: string[][] = [];
  for (const set of setResult.rows) {
    const linkResult = await query("SELECT song_id FROM setlist_set_songs WHERE set_id = $1 ORDER BY position", [set.id]);
    sets.push(linkResult.rows.map((row) => row.song_id as string));
  }
  return sets;
}

async function hydrateSets(songIdSets: string[][]): Promise<ExportSet[]> {
  const ids = Array.from(new Set(songIdSets.flat()));
  const songs = await querySongsByIds(ids);
  const songMap = new Map(songs.map((song) => [song.id, song]));
  return songIdSets.map((songIds, index) => ({
    index: index + 1,
    songs: songIds.map((songId) => songMap.get(songId)).filter((song): song is DbSong => Boolean(song)),
  }));
}

function csvCell(value: string | number | null | undefined) {
  if (value == null) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvRow(cells: (string | number | null | undefined)[]) {
  return cells.map(csvCell).join(",");
}

function formatDateForFilename(value: Date | null) {
  if (!value) return "No Date";
  return value.toISOString().slice(0, 10);
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

function safeFilenamePart(value: string | null | undefined, fallback: string) {
  const cleaned = (value || fallback).replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

function bpmPrompterFilename(setlist: ExportSetlist) {
  const band = safeFilenamePart(setlist.bandName, "Band");
  const venue = safeFilenamePart(setlist.venueName, "Venue");
  const date = formatDateForFilename(setlist.performedAt);
  return `${band} - ${venue} - ${date} - BPM Prompter.csv`;
}

function createBpmPrompterCsv(setlist: ExportSetlist, sets: ExportSet[]) {
  const totalSeconds = sets.flatMap((set) => set.songs).reduce((sum, song) => sum + (song.durationSec ?? 0), 0);
  const rows: string[] = [
    csvRow(["type", "set_number", "position", "title", "artist", "bpm"]),
    csvRow(["gig", "", "", "", "", ""]),
    csvRow(["band", "", "", setlist.bandName ?? "", "", ""]),
    csvRow(["venue", "", "", setlist.venueName, "", ""]),
    csvRow(["performance_date", "", "", setlist.performedAt ? setlist.performedAt.toISOString().slice(0, 10) : "", "", ""]),
    csvRow(["setlist_title", "", "", setlist.title ?? "", "", ""]),
    csvRow(["total_duration", "", "", totalSeconds > 0 ? formatDuration(totalSeconds) : "", "", ""]),
  ];

  for (const set of sets) {
    set.songs.forEach((song, index) => {
      rows.push(csvRow(["song", set.index, index + 1, song.title, song.artist, song.bpm ?? ""]));
    });
  }

  return `${rows.join("\r\n")}\r\n`;
}

export async function POST(req: Request, context: Params) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const setlist = await loadSetlist(id);
    if (!setlist) return privateJson({ error: "Not found" }, { status: 404 });
    await requireBandAccess(user, setlist.bandId);

    const json = await req.json().catch(() => ({}));
    const parsed = exportBody.safeParse(json);
    if (!parsed.success) return privateJson({ error: parsed.error.flatten() }, { status: 400 });

    const songIdSets = parsed.data.sets && parsed.data.sets.length > 0 ? parsed.data.sets : await loadSavedSetSongIds(id);
    const sets = await hydrateSets(songIdSets);
    const csv = createBpmPrompterCsv(setlist, sets);
    const filename = bpmPrompterFilename(setlist);

    return new Response(csv, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
        "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "'")}"`,
        "Content-Type": "text/csv; charset=utf-8",
        "Vary": "Cookie",
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
