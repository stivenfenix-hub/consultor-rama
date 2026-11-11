import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { estadoWhatsapp, ultimosMensajesWa } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

// Estado del panel de WhatsApp. Es una ruta y no una acción de servidor porque
// el panel lo pide seguido: las acciones van en fila con la navegación y, si se
// acumulan, los clics a otras páginas se quedan esperando.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const pagina = Math.max(1, Number(req.nextUrl.searchParams.get("pagina")) || 1);
  const [cuentas, { mensajes, total }] = await Promise.all([estadoWhatsapp(), ultimosMensajesWa(pagina)]);
  return NextResponse.json({ cuentas, mensajes, total }, { headers: { "Cache-Control": "no-store" } });
}
