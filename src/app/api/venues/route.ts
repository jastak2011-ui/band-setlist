import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { mapNamedRow, query } from "@/lib/db";
import { newId } from "@/lib/ids";

const body = z.object({ name: z.string().min(1).max(200) });

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
      "INSERT INTO venues (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW()) RETURNING *",
      [newId(), parsed.data.name],
    );
    return NextResponse.json(mapNamedRow(result.rows[0]), { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
