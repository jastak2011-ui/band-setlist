import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth";

async function clearAuthCookies() {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
}

export async function POST() {
  await clearAuthCookies();
  return NextResponse.json({ ok: true });
}

export async function GET(req: Request) {
  await clearAuthCookies();
  return NextResponse.redirect(new URL("/login", req.url));
}

