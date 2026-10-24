import { NextRequest, NextResponse } from "next/server";
import { requestPasswordReset } from "@/lib/accounts";
import { body, publicMobile, str } from "@/lib/mobile";

export const dynamic = "force-dynamic";

// POST { email } -> { ok }. Siempre responde igual (no revela si la cuenta existe).
export async function POST(req: NextRequest) {
  return publicMobile(req, async () => {
    const email = str((await body(req)).email);
    if (email) await requestPasswordReset(email);
    return NextResponse.json({
      ok: "Si existe una cuenta con ese correo, te enviamos un enlace para restablecer la contraseña.",
    });
  });
}
