import { NextRequest, NextResponse } from "next/server";
import { resendVerification } from "@/lib/accounts";
import { body, publicMobile, str } from "@/lib/mobile";

export const dynamic = "force-dynamic";

// POST { email } -> { ok }. Reenvía el correo de verificación.
export async function POST(req: NextRequest) {
  return publicMobile(req, async () => {
    const email = str((await body(req)).email);
    if (email) await resendVerification(email);
    return NextResponse.json({
      ok: "Si la cuenta existe y no está verificada, te reenviamos el correo.",
    });
  });
}
