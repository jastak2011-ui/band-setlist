import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, getAccessibleBandIds, requireAdmin, requireUser } from "@/lib/auth";
import { mapNamedRow, query } from "@/lib/db";
import { newId } from "@/lib/ids";

const body = z.object({ name: z.string().min(1).max(200) });

export async function GET() {
  try {
    const user = await requireUser();
    const accessibleBandIds = await getAccessibleBandIds(user);
    const result = accessibleBandIds === null
      ? await query("SELECT * FROM bands ORDER BY lower(name)")
      : accessibleBandIds.length > 0
        ? await query("SELECT * FROM bands WHERE id = ANY($1::text[]) ORDER BY lower(name)", [accessibleBandIds])
        : { rows: [] };
    return NextResponse.json(result.rows.map(mapNamedRow));
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const json = await req.json();
    const parsed = body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const result = await query(
      "INSERT INTO bands (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW()) RETURNING *",
      [newId(), parsed.data.name],
    );
    return NextResponse.json(mapNamedRow(result.rows[0]), { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
