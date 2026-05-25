import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth-cookies";

export { ACCESS_COOKIE, REFRESH_COOKIE };

export type AppRole = "admin" | "member";
export type AuthUser = { id: string; email: string; role: AppRole };

export class AuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

function supabaseUrl() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!value) throw new AuthError("Supabase URL is not configured.", 500);
  return value.replace(/\/$/, "");
}

function supabaseAnonKey() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!value) throw new AuthError("Supabase anon key is not configured.", 500);
  return value;
}

function adminEmails() {
  return (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function isConfiguredAdmin(email: string) {
  return adminEmails().includes(email.toLowerCase());
}

function shouldLogAuthDebug() {
  return process.env.AUTH_DEBUG === "1" || process.env.NODE_ENV !== "production";
}

async function fetchSupabaseUser(accessToken: string) {
  const response = await fetch(`${supabaseUrl()}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey(),
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const data = await response.json();
  const email = typeof data.email === "string" ? data.email : "";
  if (!data.id || !email) return null;
  return { id: String(data.id), email };
}

export async function syncSupabaseUser(authUser: { id: string; email: string }) {
  const email = authUser.email.trim().toLowerCase();
  await query(
    `
    INSERT INTO app_users (id, email, last_seen_at, created_at, updated_at)
    VALUES ($1, $2, NOW(), NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, last_seen_at = NOW(), updated_at = NOW()
    `,
    [authUser.id, email],
  );

  const activeResult = await query("SELECT disabled_at FROM app_users WHERE id = $1", [authUser.id]);
  if (activeResult.rows[0]?.disabled_at) {
    throw new AuthError("This user no longer has access to Band Setlist.", 403);
  }

  const configuredAdmin = isConfiguredAdmin(email);
  await query(
    `
    INSERT INTO user_roles (user_id, role, created_at, updated_at)
    VALUES ($1, $2, NOW(), NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      role = CASE WHEN $2 = 'admin' THEN 'admin' ELSE user_roles.role END,
      updated_at = NOW()
    `,
    [authUser.id, configuredAdmin ? "admin" : "member"],
  );

  await reconcileEligibleInvitations(authUser.id, email);

  const roleResult = await query("SELECT role FROM user_roles WHERE user_id = $1", [authUser.id]);
  const role = roleResult.rows[0]?.role === "admin" ? "admin" : "member";
  if (shouldLogAuthDebug()) {
    const memberships = await query("SELECT band_id FROM band_memberships WHERE user_id = $1 ORDER BY band_id", [authUser.id]);
    console.info("auth user resolved", {
      userId: authUser.id,
      email,
      role,
      membershipCount: memberships.rows.length,
      bandIds: memberships.rows.map((row) => row.band_id),
    });
  }
  return { id: authUser.id, email, role } satisfies AuthUser;
}

async function reconcileEligibleInvitations(userId: string, email: string) {
  const invitations = await query(
    `
    SELECT id, role
    FROM invitations
    WHERE lower(email) = lower($1)
      AND (accepted_at IS NOT NULL OR expires_at > NOW())
    ORDER BY accepted_at DESC, created_at DESC
    `,
    [email],
  );
  if (invitations.rows.length === 0) return;

  const inviteRoles = new Set(invitations.rows.map((row) => row.role as AppRole));
  const invitationIds = Array.from(new Set(invitations.rows.map((row) => row.id as string)));
  const shouldBeAdmin = inviteRoles.has("admin") || isConfiguredAdmin(email);
  await query(
    `
    INSERT INTO user_roles (user_id, role, created_at, updated_at)
    VALUES ($1, $2, NOW(), NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      role = CASE WHEN user_roles.role = 'admin' OR EXCLUDED.role = 'admin' THEN 'admin' ELSE user_roles.role END,
      updated_at = NOW()
    `,
    [userId, shouldBeAdmin ? "admin" : "member"],
  );

  const bandResult = await query(
    `
    SELECT DISTINCT ib.band_id
    FROM invitations i
    JOIN invitation_bands ib ON ib.invitation_id = i.id
    WHERE lower(i.email) = lower($1)
      AND (i.accepted_at IS NOT NULL OR i.expires_at > NOW())
    `,
    [email],
  );
  const bandIds = Array.from(new Set(bandResult.rows.map((row) => row.band_id as string).filter(Boolean)));
  for (const bandId of bandIds) {
    await query(
      `
      INSERT INTO band_memberships (user_id, band_id, created_at, updated_at)
      VALUES ($1, $2, NOW(), NOW())
      ON CONFLICT (user_id, band_id) DO UPDATE SET updated_at = NOW()
      `,
      [userId, bandId],
    );
  }

  await query(
    "UPDATE invitations SET accepted_at = COALESCE(accepted_at, NOW()) WHERE lower(email) = lower($1) AND expires_at > NOW()",
    [email],
  );

  if (shouldLogAuthDebug()) {
    console.info("eligible invitations reconciled", {
      userId,
      email,
      invitationIds,
      bandIds,
      shouldBeAdmin,
    });
  }
}

export async function getCurrentUser() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  const authUser = await fetchSupabaseUser(token);
  if (!authUser) return null;
  return syncSupabaseUser(authUser);
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Login required.", 401);
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") throw new AuthError("Admin access required.", 403);
  return user;
}

export async function getAccessibleBandIds(user: AuthUser) {
  if (user.role === "admin") return null;
  const result = await query("SELECT band_id FROM band_memberships WHERE user_id = $1", [user.id]);
  const bandIds = result.rows.map((row) => row.band_id as string);
  if (shouldLogAuthDebug()) {
    console.info("accessible bands resolved", { userId: user.id, email: user.email, role: user.role, bandIds });
  }
  return bandIds;
}

export async function canAccessBand(user: AuthUser, bandId: string | null | undefined) {
  if (user.role === "admin") return true;
  if (!bandId) return false;
  const result = await query("SELECT 1 FROM band_memberships WHERE user_id = $1 AND band_id = $2", [user.id, bandId]);
  return Boolean(result.rows[0]);
}

export async function requireBandAccess(user: AuthUser, bandId: string | null | undefined) {
  if (await canAccessBand(user, bandId)) return;
  throw new AuthError("You do not have access to this band.", 403);
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return privateJson({ error: error.message }, { status: error.status });
  }
  throw error;
}

export function privateJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  return NextResponse.json(body, { ...init, headers });
}
