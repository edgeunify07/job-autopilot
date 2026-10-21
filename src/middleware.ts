import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, authRequired, isValidSession } from "@/lib/auth";

/**
 * Everything is behind the password except the login page itself and static
 * assets. When APP_PASSWORD is unset the gate is skipped — that is the local
 * case; the deploy script always sets one.
 */
export async function middleware(req: NextRequest) {
  if (!authRequired()) return NextResponse.next();

  const ok = await isValidSession(req.cookies.get(COOKIE)?.value);
  if (ok) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // The login page and the assets it loads must stay reachable, or a logged-out
  // visitor gets the icon redirected to /login and a bare-looking login screen.
  matcher: [
    "/((?!login|api/login|_next/static|_next/image|favicon\\.ico|icon\\.svg|apple-icon\\.png|robots\\.txt).*)",
  ],
};
