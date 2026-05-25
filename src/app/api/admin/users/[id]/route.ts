import { authErrorResponse, privateJson, requireAdmin } from "@/lib/auth";
import { query, transaction } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

async function activeAdminCount() {
  const result = await query(`
    SELECT COUNT(*)::int AS count
    FROM user_roles r
    JOIN app_users u ON u.id = r.user_id
    WHERE r.role = 'admin' AND u.disabled_at IS NULL
  `);
  return Number(result.rows[0]?.count ?? 0);
}

export async function DELETE(_req: Request, context: Params) {
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;
    if (id === admin.id) return privateJson({ error: "You cannot remove your own admin account." }, { status: 400 });

    const userResult = await query(
      `
      SELECT u.id, u.email, u.disabled_at, COALESCE(r.role, 'member') AS role
      FROM app_users u
      LEFT JOIN user_roles r ON r.user_id = u.id
      WHERE u.id = $1
      `,
      [id],
    );
    const user = userResult.rows[0];
    if (!user || user.disabled_at) return privateJson({ error: "User not found." }, { status: 404 });
    if (user.role === "admin" && (await activeAdminCount()) <= 1) {
      return privateJson({ error: "You cannot remove the last admin." }, { status: 400 });
    }

    await transaction(async (client) => {
      await client.query("DELETE FROM band_memberships WHERE user_id = $1", [id]);
      await client.query("DELETE FROM user_roles WHERE user_id = $1", [id]);
      await client.query("UPDATE app_users SET disabled_at = NOW(), updated_at = NOW() WHERE id = $1", [id]);
    });

    return privateJson({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
