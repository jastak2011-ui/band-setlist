import { cookies } from "next/headers";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth-cookies";

export function supabaseUrl() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!value) throw new Error("Supabase URL is not configured.");
  return value.replace(/\/$/, "");
}

export function supabaseAnonKey() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!value) throw new Error("Supabase anon key is not configured.");
  return value;
}

export async function signUpWithPassword(email: string, password: string) {
  const response = await fetch(`${supabaseUrl()}/auth/v1/signup`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  return { response, data };
}

export async function loginWithPassword(email: string, password: string) {
  const response = await fetch(`${supabaseUrl()}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  return { response, data };
}

export async function setSupabaseSessionCookies(data: { access_token?: string; refresh_token?: string; expires_in?: number }) {
  if (!data.access_token) return false;
  const jar = await cookies();
  const secure = process.env.NODE_ENV === "production";
  jar.set(ACCESS_COOKIE, data.access_token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: Number(data.expires_in ?? 3600),
  });
  if (data.refresh_token) {
    jar.set(REFRESH_COOKIE, data.refresh_token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return true;
}

