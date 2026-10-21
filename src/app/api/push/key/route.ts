import { NextResponse } from "next/server";

// Clave pública VAPID leída en tiempo de ejecución, para no depender de que
// NEXT_PUBLIC_VAPID_PUBLIC_KEY existiera al momento del build.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    key: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null,
  });
}
