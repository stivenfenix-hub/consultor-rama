import crypto from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { confirmarPago } from "@/lib/subscription";

/**
 * Webhook de Bold (Panel de Comercios → Integraciones → Webhooks).
 * Firma: x-bold-signature = HMAC-SHA256(hex) del cuerpo en Base64, con la llave
 * secreta (BOLD_SECRET_KEY). En modo de pruebas Bold firma con llave vacía:
 * esos solo acreditan si el API de Bold confirma que el link es de pruebas.
 * Bold exige respuesta 200 en menos de 2 s, así que se responde de inmediato y
 * el pago se confirma después (ver confirmarPago).
 */
export const dynamic = "force-dynamic";

function firmaCon(raw: string, firma: string, llave: string) {
  const esperado = crypto
    .createHmac("sha256", llave)
    .update(Buffer.from(raw).toString("base64"))
    .digest("hex");
  const a = Buffer.from(esperado);
  const b = Buffer.from(firma);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const firma = req.headers.get("x-bold-signature") ?? "";
  const secreta = process.env.BOLD_SECRET_KEY ?? "";
  const tipoFirma: "real" | "prueba" | null =
    firma && secreta && firmaCon(raw, firma, secreta)
      ? "real"
      : firma && firmaCon(raw, firma, "")
        ? "prueba"
        : null;
  if (!tipoFirma) {
    console.warn("[bold] webhook con firma inválida");
    return NextResponse.json({ error: "firma inválida" }, { status: 401 });
  }

  let evento: {
    type?: string;
    subject?: string;
    data?: {
      payment_id?: string;
      amount?: { total?: number };
      metadata?: { reference?: string | null };
    };
  };
  try {
    evento = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }
  const ref = evento.data?.metadata?.reference;
  console.log(`[bold] webhook ${evento.type} ref=${ref} firma=${tipoFirma}`);
  if (evento.type === "SALE_APPROVED" && ref?.startsWith("LNK_")) {
    const webhook = {
      firma: tipoFirma,
      monto: typeof evento.data?.amount?.total === "number" ? evento.data.amount.total : null,
      paymentId: evento.data?.payment_id ?? evento.subject ?? null,
    };
    after(() =>
      confirmarPago(ref, webhook).catch((e) => console.error("[bold] webhook confirmar", e)),
    );
  }
  return NextResponse.json({ ok: true });
}
