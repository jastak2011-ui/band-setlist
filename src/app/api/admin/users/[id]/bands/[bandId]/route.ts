import { authErrorResponse, privateJson, requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";

type Params = { params: Promise<{ id: string; bandId: string }> };

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, context: Params) {
  try {
    await requireAdmin();
    const { id, bandId } = await context.params;
    await query("DELETE FROM band_memberships WHERE user_id = $1 AND band_id = $2", [id, bandId]);
    return privateJson({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
