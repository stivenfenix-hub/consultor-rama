import { NextRequest, NextResponse } from "next/server";
import { checkPassword } from "@/lib/auth";
import { MSG_CUENTA_DESACTIVADA } from "@/lib/cuenta-desactivada";
import { body, createMobileSession, jsonError, perfil, publicMobile, str } from "@/lib/mobile";

export const dynamic = "force-dynamic";

// POST { email, password, device? } -> { token, user, suscripcion }
export async function POST(req: NextRequest) {
  return publicMobile(req, async () => {
    const b = await body(req);
    const email = str(b.email);
    const password = str(b.password);
    if (!email || !password) return jsonError("Ingresa correo y contraseña.", 400);
    const res = await checkPassword(email, password);
    if (res.status === "invalid") return jsonError("Correo o contraseña incorrectos.", 401);
    if (res.status === "desactivada") return jsonError(MSG_CUENTA_DESACTIVADA, 403);
    const token = await createMobileSession(res.user.id, str(b.device) || null);
    return NextResponse.json({ token, ...(await perfil(res.user)) });
  });
}
