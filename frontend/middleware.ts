import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Runtime builds expose only /<app-slug> (served by /inspect/<slug>), the runtime API proxy and static assets.
 * Studio builds serve everything, including /inspect/<slug> as a fallback address for apps.
 */
export function middleware(request: NextRequest) {
  if (process.env.APP_MODE !== "runtime") return NextResponse.next();
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/_next/") || pathname.startsWith("/api/runtime/") || pathname.startsWith("/samples/")) return NextResponse.next();
  if (pathname === "/" || pathname === "/inspect") return NextResponse.rewrite(new URL("/inspect", request.url));
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 1 && segments[0] !== "inspect") return NextResponse.rewrite(new URL(`/inspect/${segments[0]}`, request.url));
  if (segments.length === 2 && segments[0] === "inspect") return NextResponse.next();
  return new NextResponse("Not found", { status: 404 });
}

export const config = { matcher: "/((?!favicon.ico).*)" };
