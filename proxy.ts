import { auth } from "@/auth";
import { NextResponse } from "next/server";

const publicRoutes = ["/login"];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  const isPublic = publicRoutes.some((r) => pathname.startsWith(r));
  const isAuthenticated = !!req.auth;

  if (!isAuthenticated && !isPublic) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthenticated && pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
});

export const config = {
  /*
    Everything except the API, Next's own assets, and anything with a file
    extension (which is what lets `/manifest.webmanifest` through).

    **`icon` is excluded explicitly**, and it has to be: `app/icon.tsx`
    generates the browser-tab icon at `/icon`, which has no file extension, so
    without this the auth check above catches it and answers a 307 to /login.
    The tab icon is fetched with no session on the login page itself, so
    gating it means no shop ever sees its own icon before signing in.

    It replaces `favicon.ico` in this list, which no longer exists — the static
    favicon was removed in favour of the generated one (see `app/icon.tsx`).
    The `.*\..*` clause would have covered the old name anyway.
  */
  matcher: ["/((?!api|_next/static|_next/image|icon|.*\\..*).*)"],
};
