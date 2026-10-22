import crypto from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { confirmarPago } from "@/lib/subscription";

/**
 * Webhook de Bold (Panel de Comercios → Integraciones → Webhooks).
 * Firma: x-bold-signature = HMAC-SHA256(hex) del cuerpo en Base64, con la llave
 * secreta (BOLD_SECRET_KEY; en pruebas Bold firma con llave vacía).
 * Bold exige respuesta 200 en menos de 2 s, así que se responde de inmediato y
 * el pago se confirma después consultando el API de Bold: nunca se da acceso
 * solo por lo que diga el webhook.
 */
export const dynamic = "force-dynamic";

function firmaValida(raw: string, firma: string | null) {
  if (!firma) return false;
  const esperado = crypto
    .createHmac("sha256", process.env.BOLD_SECRET_KEY ?? "")
    .update(Buffer.from(raw).toString("base64"))
    .digest("hex");
  const a = Buffer.from(esperado);
  const b = Buffer.from(firma);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!firmaValida(raw, req.headers.get("x-bold-signature"))) {
    console.warn("[bold] webhook con firma inválida");
    return NextResponse.json({ error: "firma inválida" }, { status: 401 });
  }
  let evento: { type?: string; data?: { metadata?: { reference?: string | null } } };
  try {
    evento = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }
  const ref = evento.data?.metadata?.reference;
  if (evento.type === "SALE_APPROVED" && ref?.startsWith("LNK_")) {
    after(() =>
      confirmarPago(ref).catch((e) => console.error("[bold] webhook confirmar", e)),
    );
  }
  return NextResponse.json({ ok: true });
}
