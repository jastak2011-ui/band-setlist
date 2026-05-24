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
  await query(
    `
    INSERT INTO app_users (id, email, last_seen_at, created_at, updated_at)
    VALUES ($1, $2, NOW(), NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, last_seen_at = NOW(), updated_at = NOW()
    `,
    [authUser.id, authUser.email],
  );

  const configuredAdmin = isConfiguredAdmin(authUser.email);
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

  const roleResult = await query("SELECT role FROM user_roles WHERE user_id = $1", [authUser.id]);
  const role = roleResult.rows[0]?.role === "admin" ? "admin" : "member";
  return { id: authUser.id, email: authUser.email, role } satisfies AuthUser;
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
  return result.rows.map((row) => row.band_id as string);
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
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  throw error;
}
