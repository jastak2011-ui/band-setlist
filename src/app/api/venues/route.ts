import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { mapNamedRow, query } from "@/lib/db";
import { newId } from "@/lib/ids";

const venueTypes = ["Bar Crowd", "Brewery", "Private Party", "Wedding", "Corporate Event"] as const;
const crowdSetups = ["Seated", "Standing", "Mixed"] as const;
const nullableVenueType = z.preprocess((value) => value === "" ? null : value, z.enum(venueTypes).nullable().optional());
const nullableCrowdSetup = z.preprocess((value) => value === "" ? null : value, z.enum(crowdSetups).nullable().optional());

const body = z.object({
  name: z.string().min(1).max(200),
  venueType: nullableVenueType,
  crowdSetup: nullableCrowdSetup,
});

const patchBody = body.extend({ id: z.string().min(1) });

export async function GET() {
  try {
    await requireUser();
    const result = await query("SELECT * FROM venues ORDER BY lower(name)");
    return NextResponse.json(result.rows.map(mapNamedRow));
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    await requireUser();
    const json = await req.json();
    const parsed = body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const result = await query(
      "INSERT INTO venues (id, name, venue_type, crowd_setup, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING *",
      [newId(), parsed.data.name, parsed.data.venueType ?? null, parsed.data.crowdSetup ?? "Mixed"],
    );
    return NextResponse.json(mapNamedRow(result.rows[0]), { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PATCH(req: Request) {
  try {
    await requireUser();
    const json = await req.json();
    const parsed = patchBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const result = await query(
      "UPDATE venues SET name = $2, venue_type = $3, crowd_setup = $4, updated_at = NOW() WHERE id = $1 RETURNING *",
      [parsed.data.id, parsed.data.name, parsed.data.venueType ?? null, parsed.data.crowdSetup ?? "Mixed"],
    );
    if (!result.rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(mapNamedRow(result.rows[0]));
  } catch (error) {
    return authErrorResponse(error);
  }
}
