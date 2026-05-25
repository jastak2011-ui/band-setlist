import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ACCESS_COOKIE, REFRESH_COOKIE, syncSupabaseUser } from "@/lib/auth";
import { loginWithPassword } from "@/lib/supabase-auth";

const body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const parsed = body.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });

    const { response, data } = await loginWithPassword(parsed.data.email, parsed.data.password);
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
