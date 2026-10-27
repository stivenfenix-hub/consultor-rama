import { NextRequest, NextResponse } from "next/server";
import { AccountError, registerUser } from "@/lib/accounts";
import { registerSchema } from "@/lib/validation";
import { body, jsonError, publicMobile } from "@/lib/mobile";

export const dynamic = "force-dynamic";

// POST { firstName, lastName, email, whatsapp, password } -> { ok }
// La cuenta queda activa de una vez (sin verificar el correo, igual que en la web).
export async function POST(req: NextRequest) {
  return publicMobile(req, async () => {
    const parsed = registerSchema.safeParse(await body(req));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return jsonError(issue?.message ?? "Datos inválidos", 400, {
        field: issue?.path[0] != null ? String(issue.path[0]) : undefined,
      });
    }
    try {
      await registerUser(parsed.data);
    } catch (err) {
      if (err instanceof AccountError) return jsonError(err.message, 409, { field: "email" });
      throw err;
    }
    return NextResponse.json({
      ok: "¡Cuenta creada! Ya puedes ingresar.",
    });
  });
}
