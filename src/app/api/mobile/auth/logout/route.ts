import { NextRequest, NextResponse } from "next/server";
import { publicMobile, revokeMobileSession } from "@/lib/mobile";

export const dynamic = "force-dynamic";

// POST -> { ok }. Revoca el token de este dispositivo.
export async function POST(req: NextRequest) {
  return publicMobile(req, async () => {
    await revokeMobileSession(req);
    return NextResponse.json({ ok: true });
  });
}
