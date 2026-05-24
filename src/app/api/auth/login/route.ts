import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ACCESS_COOKIE, REFRESH_COOKIE, syncSupabaseUser } from "@/lib/auth";

const body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function supabaseUrl() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!value) throw new Error("Supabase URL is not configured.");
  return value.replace(/\/$/, "");
}

function supabaseAnonKey() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!value) throw new Error("Supabase anon key is not configured.");
  return value;
}

export async function POST(req: Request) {
  try {
    const parsed = body.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });

    const response = await fetch(`${supabaseUrl()}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: supabaseAnonKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(parsed.data),
      cache: "no-store",
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.access_token) {
      return NextResponse.json({ error: data?.error_description || data?.msg || "Login failed." }, { status: 401 });
    }

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

  if (!data.user?.id || !data.user?.email) return NextResponse.json({ error: "Login did not return a user." }, { status: 401 });
    const user = await syncSupabaseUser({ id: String(data.user.id), email: String(data.user.email) });
    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Login failed." }, { status: 500 });
  }
}
