import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE } from "@/lib/auth-cookies";

const PUBLIC_PATHS = ["/login"];
const PUBLIC_API_PATHS = ["/api/auth/login", "/api/auth/logout", "/api/auth/me"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublicPage = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const isPublicApi = PUBLIC_API_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const isAsset = pathname.startsWith("/_next/") || pathname === "/favicon.ico" || /\.[a-zA-Z0-9]+$/.test(pathname);
  const hasSession = Boolean(req.cookies.get(ACCESS_COOKIE)?.value);

  if (isAsset || isPublicApi) return NextResponse.next();
  if (isPublicPage) {
    if (hasSession) return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }
  if (!hasSession) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
