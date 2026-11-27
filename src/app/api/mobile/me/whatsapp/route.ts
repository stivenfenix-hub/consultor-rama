import { NextRequest, NextResponse } from "next/server";
import { AccountError, normalizarWhatsapp, setWhatsapp } from "@/lib/accounts";
import { body, jsonError, str, withMobileUser } from "@/lib/mobile";

export const dynamic = "force-dynamic";

// PUT { whatsapp } -> { ok, whatsapp }
export async function PUT(req: NextRequest) {
  return withMobileUser(
    req,
    async (user) => {
      const n = normalizarWhatsapp(str((await body(req)).whatsapp));
      if (!n) return jsonError("Ingresa un número de WhatsApp válido (ej. 300 123 4567).", 400);
      try {
        await setWhatsapp(user.id, n);
      } catch (e) {
        if (e instanceof AccountError) return jsonError(e.message, 409);
        throw e;
      }
      return NextResponse.json({ ok: `WhatsApp guardado: ${n}`, whatsapp: n });
    },
    { allowExpired: true },
  );
}
