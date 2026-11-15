import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic gate only: sends visitors with no session cookie to /login.
 * It is NOT authorization. Every page and API handler re-verifies the session
 * and the patient membership on the server.
 */
const PUBLIC = [/^\/$/, /^\/(login|register|forgot-password|accessibility)(\/|$)/, /^\/invite\//, /^\/api\//, /^\/_next\//, /^\/favicon/];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  if (!req.cookies.get("__session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|.*\\..*).*)"] };
