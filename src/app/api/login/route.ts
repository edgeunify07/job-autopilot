import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, sessionToken, verifyPassword } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Build redirects from the Host header rather than req.nextUrl.
 *
 * In the Node runtime nextUrl can resolve to localhost whatever address the
 * request actually arrived on, which would send anyone signing in to a server
 * over its public IP back to their own machine instead of to the dashboard.
 */
function origin(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return req.nextUrl.origin;
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "") ?? "http";
  return `${proto}://${host}`;
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") || "/");
  const base = origin(req);

  // Slow down guessing a little without needing any state.
  await new Promise((r) => setTimeout(r, 400));

  if (!(await verifyPassword(password))) {
    const url = new URL("/login", base);
    url.searchParams.set("error", "1");
    url.searchParams.set("next", next);
    return NextResponse.redirect(url, { status: 303 });
  }

  // Only same-site paths, so the form cannot be used as an open redirect.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const res = NextResponse.redirect(new URL(safeNext, base), { status: 303 });

  res.cookies.set(COOKIE, await sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: base.startsWith("https:"),
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
