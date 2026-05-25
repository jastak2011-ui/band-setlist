import { NextResponse } from "next/server";
import { z } from "zod";
import { syncSupabaseUser } from "@/lib/auth";
import { query, transaction } from "@/lib/db";
import { appLoginRedirectUrl, setSupabaseSessionCookies, signUpWithPassword } from "@/lib/supabase-auth";

type Params = { params: Promise<{ token: string }> };

const acceptBody = z.object({
  password: z.string().min(8),
});

function isExistingAccountResponse(data: unknown) {
  const payload = data as { msg?: string; message?: string; error_description?: string; user?: { identities?: unknown[] } } | null;
  const message = `${payload?.msg ?? ""} ${payload?.message ?? ""} ${payload?.error_description ?? ""}`.toLowerCase();
  return (
    message.includes("already registered")
    || message.includes("already exists")
    || message.includes("user already")
    || (Array.isArray(payload?.user?.identities) && payload.user.identities.length === 0)
  );
}

function inviteStatus(invitation: { accepted_at: Date | null; expires_at: Date }) {
  if (invitation.accepted_at) return "accepted";
  if (new Date(invitation.expires_at).getTime() < Date.now()) return "expired";
  return "pending";
}

async function loadInvitation(token: string) {
  const result = await query(
    `
    SELECT
      i.*,
      COALESCE(
        json_agg(json_build_object('id', b.id, 'name', b.name) ORDER BY lower(b.name))
          FILTER (WHERE b.id IS NOT NULL),
        '[]'::json
      ) AS bands
    FROM invitations i
    LEFT JOIN invitation_bands ib ON ib.invitation_id = i.id
    LEFT JOIN bands b ON b.id = ib.band_id
    WHERE i.token = $1
    GROUP BY i.id
    `,
    [token],
  );
  const invitation = result.rows[0];
  if (!invitation) return null;
  return {
    id: invitation.id as string,
    email: invitation.email as string,
    role: invitation.role as "admin" | "member",
    token: invitation.token as string,
    expiresAt: invitation.expires_at as Date,
    acceptedAt: invitation.accepted_at as Date | null,
    status: inviteStatus({ accepted_at: invitation.accepted_at as Date | null, expires_at: invitation.expires_at as Date }),
    bands: Array.isArray(invitation.bands) ? invitation.bands as Array<{ id: string; name: string }> : [],
  };
}

async function applyInvitation(invitation: NonNullable<Awaited<ReturnType<typeof loadInvitation>>>, userId: string) {
  await transaction(async (client) => {
    await client.query(
      `
      INSERT INTO user_roles (user_id, role, created_at, updated_at)
      VALUES ($1, $2, NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()
      `,
      [userId, invitation.role],
    );
    for (const band of invitation.bands) {
      await client.query(
        `
        INSERT INTO band_memberships (user_id, band_id, created_at, updated_at)
        VALUES ($1, $2, NOW(), NOW())
        ON CONFLICT (user_id, band_id) DO UPDATE SET updated_at = NOW()
        `,
        [userId, band.id],
      );
    }
    await client.query("UPDATE invitations SET accepted_at = NOW() WHERE id = $1 AND accepted_at IS NULL", [invitation.id]);
  });
}

export async function GET(_req: Request, context: Params) {
  const { token } = await context.params;
  const invitation = await loadInvitation(token);
  if (!invitation) return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
  return NextResponse.json({
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    status: invitation.status,
    bands: invitation.bands,
  });
}

export async function POST(req: Request, context: Params) {
  const { token } = await context.params;
  const invitation = await loadInvitation(token);
  if (!invitation) return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
  if (invitation.status === "expired") return NextResponse.json({ error: "This invitation has expired." }, { status: 410 });
  if (invitation.status === "accepted") return NextResponse.json({ error: "This invitation has already been accepted." }, { status: 409 });

  const parsed = acceptBody.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });

  const signup = await signUpWithPassword(invitation.email, parsed.data.password, appLoginRedirectUrl());
  const authData = signup.data;

  if (!signup.response.ok || isExistingAccountResponse(authData)) {
    if (isExistingAccountResponse(authData)) {
      return NextResponse.json({ error: "This account already exists. Please log in instead." }, { status: 409 });
    }
    return NextResponse.json({ error: authData?.error_description || authData?.msg || "Could not create this account." }, { status: 400 });
  }

  if (!authData?.user?.id || !authData?.user?.email) {
    return NextResponse.json({ error: "Supabase did not return a new user." }, { status: 400 });
  }

  const email = String(authData.user.email).toLowerCase();
  if (email !== invitation.email.toLowerCase()) {
    return NextResponse.json({ error: "This account email does not match the invitation." }, { status: 403 });
  }

  if (!authData.access_token) {
    return NextResponse.json({
      ok: true,
      signedIn: false,
      message: "Account created. Please check your email to confirm your account, then log in.",
    });
  }

  const user = await syncSupabaseUser({ id: String(authData.user.id), email });
  await applyInvitation(invitation, user.id);
  const signedIn = await setSupabaseSessionCookies(authData);

  return NextResponse.json({
    ok: true,
    signedIn,
    message: signedIn ? "Invitation accepted." : "Account created. Please check your email to confirm your account, then log in.",
  });
}
