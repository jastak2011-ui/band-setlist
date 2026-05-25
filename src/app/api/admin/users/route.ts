import { z } from "zod";
import { authErrorResponse, privateJson, requireAdmin } from "@/lib/auth";
import { query, transaction } from "@/lib/db";

const membershipBody = z.object({
  userId: z.string().min(1),
  bandId: z.string().min(1),
});

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const admin = await requireAdmin();
    const [users, bands, memberships] = await Promise.all([
      query(`
        SELECT u.id, u.email, u.display_name, COALESCE(r.role, 'member') AS role, u.last_seen_at, u.created_at, u.updated_at
        FROM app_users u
        LEFT JOIN user_roles r ON r.user_id = u.id
        WHERE u.disabled_at IS NULL
        ORDER BY lower(u.email)
      `),
      query("SELECT id, name FROM bands ORDER BY lower(name)"),
      query(`
        SELECT bm.user_id, bm.band_id
        FROM band_memberships bm
        JOIN app_users u ON u.id = bm.user_id
        WHERE u.disabled_at IS NULL
        ORDER BY bm.user_id, bm.band_id
      `),
    ]);
    return privateJson({
      currentUserId: admin.id,
      users: users.rows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        role: row.role,
        lastSeenAt: row.last_seen_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      bands: bands.rows.map((row) => ({ id: row.id, name: row.name })),
      memberships: memberships.rows.map((row) => ({ userId: row.user_id, bandId: row.band_id })),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const parsed = membershipBody.safeParse(await req.json());
    if (!parsed.success) return privateJson({ error: parsed.error.flatten() }, { status: 400 });
    const user = await query("SELECT id, disabled_at FROM app_users WHERE id = $1", [parsed.data.userId]);
    if (!user.rows[0] || user.rows[0].disabled_at) return privateJson({ error: "User not found." }, { status: 404 });
    await query(
      `
      INSERT INTO band_memberships (user_id, band_id, created_at, updated_at)
      VALUES ($1, $2, NOW(), NOW())
      ON CONFLICT (user_id, band_id) DO UPDATE SET updated_at = NOW()
      `,
      [parsed.data.userId, parsed.data.bandId],
    );
    return privateJson({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(req: Request) {
  try {
    await requireAdmin();
    const url = new URL(req.url);
    const userId = url.searchParams.get("userId");
    const bandId = url.searchParams.get("bandId");
    if (!userId || !bandId) return privateJson({ error: "userId and bandId are required" }, { status: 400 });
    await transaction(async (client) => {
      const user = await client.query("SELECT email FROM app_users WHERE id = $1", [userId]);
      await client.query("DELETE FROM band_memberships WHERE user_id = $1 AND band_id = $2", [userId, bandId]);
      if (user.rows[0]?.email) {
        await client.query(
          `
          DELETE FROM invitation_bands ib
          USING invitations i
          WHERE ib.invitation_id = i.id
            AND lower(i.email) = lower($1)
            AND ib.band_id = $2
          `,
          [user.rows[0].email, bandId],
        );
      }
    });
    return privateJson({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
