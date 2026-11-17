import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

/**
 * Root: ¿Hostinger puede entrar al portal de Publicaciones Procesales?
 * (El 17 nov 2026 el firewall de Azure de la Rama bloqueó la IP del VPS con 403.)
 * Hace UNA sola consulta liviana y devuelve el código de respuesta.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (user?.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const url =
    "https://publicacionesprocesales.ramajudicial.gov.co/web/publicaciones-procesales/search?q=76001311000820260048600";
  const t = Date.now();
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
        "Accept-Language": "es-CO,es;q=0.9",
      },
      signal: AbortSignal.timeout(25_000),
      cache: "no-store",
    });
    const html = await r.text();
    return NextResponse.json({
      desde: "Hostinger",
      status: r.status,
      ms: Date.now() - t,
      azure: r.headers.get("x-azure-ref") ? "sí" : "no",
      bytes: html.length,
      traeResultados: /publicaci/i.test(html),
    });
  } catch (e) {
    return NextResponse.json({ desde: "Hostinger", error: e instanceof Error ? e.message : String(e), ms: Date.now() - t });
  }
}
