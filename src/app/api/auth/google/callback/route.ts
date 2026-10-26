import { after, NextRequest } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, homePath } from "@/lib/auth";
import { getWhatsapp } from "@/lib/accounts";
import { enviarBienvenida } from "@/lib/auto-emails";
import { registrarConsentimientoInicial } from "@/lib/consent";
import { COOKIE_ESTADO, cuentaGoogle, perfilDesdeCodigo } from "@/lib/google-auth";

export const dynamic = "force-dynamic";

/** Google devuelve al usuario aquí con un código de un solo uso. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const jar = await cookies();
  const [state, verifier] = (jar.get(COOKIE_ESTADO)?.value ?? "").split(".");
  jar.delete(COOKIE_ESTADO);

  const code = q.get("code");
  // Canceló en Google, o el estado no coincide (enlace viejo o manipulado).
  if (!code || !state || !verifier || q.get("state") !== state) redirect("/login?google=cancelado");

  let destino: string;
  try {
    const perfil = await perfilDesdeCodigo(code, verifier);
    const { user, nueva } = await cuentaGoogle(perfil);
    await createSession(user.id);
    if (nueva) {
      // Al crear la cuenta con Google acepta Términos y Política (texto bajo el botón).
      await registrarConsentimientoInicial(user.id).catch((e) => console.error("[consentimiento]", e));
      after(() => enviarBienvenida(user.id));
    }
    // El WhatsApp es obligatorio: si no lo tiene, se le pide antes de entrar.
    destino = (await getWhatsapp(user.id)) ? homePath(user.role) : "/completar-registro";
  } catch (e) {
    console.error("[google] error", e);
    destino = "/login?google=error";
  }
  redirect(destino);
}
