import { authErrorResponse, privateJson, requireAdmin } from "@/lib/auth";
import { transaction } from "@/lib/db";

type Params = { params: Promise<{ id: string; bandId: string }> };

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, context: Params) {
  try {
    await requireAdmin();
    const { id, bandId } = await context.params;
    await transaction(async (client) => {
      const user = await client.query("SELECT email FROM app_users WHERE id = $1", [id]);
      await client.query("DELETE FROM band_memberships WHERE user_id = $1 AND band_id = $2", [id, bandId]);
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
