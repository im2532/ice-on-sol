import { NextRequest, NextResponse } from "next/server";

/**
 * Geo-blocks jurisdictions listed in GEOBLOCK_COUNTRIES (docs/ICEMARKETS_SPEC.md D10: offshore entity,
 * frontend geo-block US/UK/sanctioned). Reads Vercel's edge geo first, falling back to the
 * x-vercel-ip-country header some proxies forward instead.
 */
const DEFAULT_BLOCKED = ["US", "GB", "CU", "IR", "KP", "SY", "RU", "BY"];

function blockedCountries(): string[] {
  const raw = process.env.GEOBLOCK_COUNTRIES;
  if (!raw) return DEFAULT_BLOCKED;
  return raw
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (
    pathname.startsWith("/restricted") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // `geo` is present on Vercel's edge runtime request object; not typed on the base NextRequest.
  const geo = (request as unknown as { geo?: { country?: string } }).geo;
  const country = geo?.country ?? request.headers.get("x-vercel-ip-country") ?? undefined;

  if (country && blockedCountries().includes(country.toUpperCase())) {
    const url = request.nextUrl.clone();
    url.pathname = "/restricted";
    url.search = "";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
