import { NextResponse } from "next/server";
import { z } from "zod";
import { transaction } from "@/lib/db";
import { newId } from "@/lib/ids";

const rating = z.number().min(0).max(10).transform((value) => (value > 1 ? value / 10 : value)).optional().nullable();
const song = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  artist: z.string().min(1),
  bpm: z.number().int().positive().max(400).optional().nullable(),
  musicalKey: z.string().optional().nullable(),
  key: z.string().optional().nullable(),
  durationSec: z.number().int().positive().max(36000).optional().nullable(),
  energy: rating,
  notes: z.string().optional().nullable(),
  genre: z.string().optional().nullable(),
  vibe: z.string().optional().nullable(),
  crowdScore: rating,
  danceability: rating,
  vocalDifficulty: rating,
  openerCandidate: z.boolean().optional().nullable(),
  closerCandidate: z.boolean().optional().nullable(),
  leadSinger: z.string().optional().nullable(),
  capoOrTuning: z.string().optional().nullable(),
  avoidAfter: z.string().optional().nullable(),
});
const named = z.object({ id: z.string().optional(), name: z.string().min(1) });
const setlist = z.object({
  id: z.string().optional(),
  venueId: z.string(),
  bandId: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  performedAt: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  sets: z.array(z.array(z.string())).min(1),
});
const body = z.object({
  songs: z.array(song).optional().default([]),
  bands: z.array(named).optional().default([]),
  venues: z.array(named).optional().default([]),
  setlists: z.array(setlist).optional().default([]),
});

export async function POST(req: Request) {
  const json = await req.json();
  const parsed = body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const counts = await transaction(async (client) => {
    for (const band of parsed.data.bands) {
      await client.query(
        `INSERT INTO bands (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
        [band.id ?? newId(), band.name],
      );
    }

    for (const venue of parsed.data.venues) {
      await client.query(
        `INSERT INTO venues (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
        [venue.id ?? newId(), venue.name],
      );
    }

    for (const row of parsed.data.songs) {
      await client.query(
        `
        INSERT INTO songs (
          id, title, artist, bpm, musical_key, duration_sec, energy, notes, genre, vibe,
          crowd_score, danceability, vocal_difficulty, opener_candidate, closer_candidate,
          lead_singer, capo_or_tuning, avoid_after, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title, artist = EXCLUDED.artist, bpm = EXCLUDED.bpm,
          musical_key = EXCLUDED.musical_key, duration_sec = EXCLUDED.duration_sec,
          energy = EXCLUDED.energy, notes = EXCLUDED.notes, genre = EXCLUDED.genre,
          vibe = EXCLUDED.vibe, crowd_score = EXCLUDED.crowd_score,
          danceability = EXCLUDED.danceability, vocal_difficulty = EXCLUDED.vocal_difficulty,
          opener_candidate = EXCLUDED.opener_candidate, closer_candidate = EXCLUDED.closer_candidate,
          lead_singer = EXCLUDED.lead_singer, capo_or_tuning = EXCLUDED.capo_or_tuning,
          avoid_after = EXCLUDED.avoid_after, updated_at = NOW()
        `,
        [
          row.id ?? newId(), row.title, row.artist, row.bpm ?? null, row.musicalKey ?? row.key ?? null,
          row.durationSec ?? null, row.energy ?? null, row.notes ?? null, row.genre ?? null, row.vibe ?? null,
          row.crowdScore ?? null, row.danceability ?? null, row.vocalDifficulty ?? null,
          row.openerCandidate ?? null, row.closerCandidate ?? null, row.leadSinger ?? null,
          row.capoOrTuning ?? null, row.avoidAfter ?? null,
        ],
      );
    }

    for (const list of parsed.data.setlists) {
      const setlistId = list.id ?? newId();
      await client.query(
        `INSERT INTO setlists (id, venue_id, band_id, title, performed_at, created_at, updated_at, notes)
         VALUES ($1,$2,$3,$4,$5,NOW(),NOW(),$6)
         ON CONFLICT (id) DO UPDATE SET venue_id = EXCLUDED.venue_id, band_id = EXCLUDED.band_id,
           title = EXCLUDED.title, performed_at = EXCLUDED.performed_at, notes = EXCLUDED.notes, updated_at = NOW()`,
        [setlistId, list.venueId, list.bandId ?? null, list.title ?? null, list.performedAt ? new Date(list.performedAt) : null, list.notes ?? null],
      );
      const existingSets = await client.query("SELECT id FROM setlist_sets WHERE setlist_id = $1", [setlistId]);
      const existingSetIds = existingSets.rows.map((row) => row.id as string);
      if (existingSetIds.length > 0) await client.query("DELETE FROM setlist_set_songs WHERE set_id = ANY($1::text[])", [existingSetIds]);
      await client.query("DELETE FROM setlist_sets WHERE setlist_id = $1", [setlistId]);
      for (let i = 0; i < list.sets.length; i++) {
        const setId = newId();
        await client.query("INSERT INTO setlist_sets (id, setlist_id, set_index, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())", [setId, setlistId, i]);
        for (let p = 0; p < list.sets[i].length; p++) {
          await client.query("INSERT INTO setlist_set_songs (id, set_id, song_id, position, created_at, updated_at) VALUES ($1,$2,$3,$4,NOW(),NOW())", [newId(), setId, list.sets[i][p], p]);
        }
      }
    }

    return {
      songs: parsed.data.songs.length,
      bands: parsed.data.bands.length,
      venues: parsed.data.venues.length,
      setlists: parsed.data.setlists.length,
    };
  });

  return NextResponse.json({ imported: counts });
}
