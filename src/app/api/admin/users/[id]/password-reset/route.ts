import { authErrorResponse, privateJson, requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { supabaseUrl } from "@/lib/supabase-auth";

type Params = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

function appBaseUrl(req: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

function serviceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

export async function POST(req: Request, context: Params) {
  try {
    await requireAdmin();
    const key = serviceRoleKey();
    if (!key) {
      return privateJson(
        {
          error: "SUPABASE_SERVICE_ROLE_KEY is not configured. Add it as a server-only environment variable, or send password resets manually from the Supabase Authentication dashboard.",
        },
        { status: 501 },
      );
    }

    const { id } = await context.params;
    const userResult = await query("SELECT email, disabled_at FROM app_users WHERE id = $1", [id]);
    const user = userResult.rows[0];
    if (!user || user.disabled_at) return privateJson({ error: "User not found." }, { status: 404 });

    const response = await fetch(`${supabaseUrl()}/auth/v1/recover`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: user.email,
        redirect_to: `${appBaseUrl(req)}/login`,
      }),
      cache: "no-store",
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return privateJson(
        { error: data?.error_description || data?.msg || data?.error || "Supabase could not send the reset email." },
        { status: response.status },
      );
    }

    return privateJson({ ok: true, message: `Password reset email sent to ${user.email}.` });
  } catch (error) {
    return authErrorResponse(error);
  }
}
