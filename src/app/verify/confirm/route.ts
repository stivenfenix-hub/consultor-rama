import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { verifyEmailToken } from "@/lib/accounts";
import { createSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Enlace del correo de verificación: activa la cuenta e inicia sesión de una
 * vez (el enlace de un solo uso, enviado a su correo, ya prueba que es él).
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const userId = token ? await verifyEmailToken(token) : null;
  if (!userId) redirect("/verify?invalido=1");
  await createSession(userId);
  redirect("/dashboard?verificado=1");
}
