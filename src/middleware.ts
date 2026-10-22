import { NextRequest, NextResponse } from "next/server";

// Pasa la ruta actual a los layouts del servidor (x-pathname), que la usan
// para saber qué páginas se muestran aunque la suscripción esté vencida.
export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/dashboard/:path*"] };
