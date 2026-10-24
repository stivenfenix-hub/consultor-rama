import { NextRequest, NextResponse } from "next/server";
import { AccountError, changePassword } from "@/lib/accounts";
import { passwordSchema } from "@/lib/validation";
import { body, jsonError, str, withMobileUser } from "@/lib/mobile";

export const dynamic = "force-dynamic";

// POST { current, password } -> { ok }
export async function POST(req: NextRequest) {
  return withMobileUser(
    req,
    async (user) => {
      const b = await body(req);
      const current = str(b.current);
      if (!current) return jsonError("Ingresa tu contraseña actual", 400);
      const parsed = passwordSchema.safeParse(str(b.password));
      if (!parsed.success) {
        return jsonError(parsed.error.issues[0]?.message ?? "Datos inválidos", 400);
      }
      try {
        await changePassword(user.id, current, parsed.data);
      } catch (err) {
        if (err instanceof AccountError) return jsonError(err.message, 400);
        throw err;
      }
      return NextResponse.json({ ok: "Contraseña actualizada correctamente." });
    },
    { allowExpired: true },
  );
}
