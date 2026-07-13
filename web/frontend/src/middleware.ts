import { NextResponse, type NextRequest } from "next/server";

// Coarse gate: any /app/* route requires a token cookie. Fine-grained
// role checks (admin vs staff views) happen client-side in the layout,
// where we already have the decoded user from /auth/me.
const PROTECTED_PREFIX = "/app";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get("trax_token")?.value;

  if (pathname.startsWith(PROTECTED_PREFIX) && !token) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};
