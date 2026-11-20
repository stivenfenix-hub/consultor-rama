import "server-only";
import { createHash } from "node:crypto";
import { after } from "next/server";
import { cookies, headers } from "next/headers";
import { COOKIE_REGISTRO, META_PIXEL_ID } from "./meta-pixel-config";

/**
 * Marca que se acaba de crear una cuenta:
 *  - Navegador: el Píxel de Meta (componente MetaPixel) envía CompleteRegistration
 *    y borra la cookie.
 *  - Servidor (Conversions API, 20 nov 2026): el mismo evento, con el mismo
 *    event_id ("registro-<id>"), para que cuente aunque Safari o un bloqueador
 *    frenen el píxel; si llegan los dos, Meta los deduplica.
 * Solo se llama al CREAR la cuenta, nunca en un login.
 */
export async function marcarRegistroNuevo(userId: string) {
  const jar = await cookies();
  jar.set(COOKIE_REGISTRO, userId, {
    path: "/",
    maxAge: 60 * 60, // si no se envía en 1 hora, se descarta
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: false, // la lee el script del píxel
  });

  const h = await headers();
  const datos = {
    fbc: jar.get("_fbc")?.value,
    fbp: jar.get("_fbp")?.value,
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || h.get("cf-connecting-ip") || undefined,
    ua: h.get("user-agent") ?? undefined,
  };
  after(() => enviarRegistroCapi(userId, datos));
}

const sha256 = (s: string) => createHash("sha256").update(s.trim().toLowerCase()).digest("hex");

/**
 * CompleteRegistration por Conversions API. Sin META_CAPI_ACCESS_TOKEN no hace nada.
 * Solo datos técnicos (IP, navegador, cookies de Meta) y el id interno hasheado:
 * la Política de Datos dice que a Meta no se le envía nombre, correo ni WhatsApp.
 */
async function enviarRegistroCapi(
  userId: string,
  d: { fbc?: string; fbp?: string; ip?: string; ua?: string },
) {
  const token = process.env.META_CAPI_ACCESS_TOKEN;
  if (!token) return;
  const evento = {
    event_name: "CompleteRegistration",
    event_time: Math.floor(Date.now() / 1000),
    event_id: `registro-${userId}`, // el mismo eventID que usa el píxel
    action_source: "website",
    event_source_url: "https://app.estradox.com/register",
    user_data: {
      external_id: [sha256(userId)],
      country: [sha256("co")],
      ...(d.ip && { client_ip_address: d.ip }),
      ...(d.ua && { client_user_agent: d.ua }),
      ...(d.fbc && { fbc: d.fbc }),
      ...(d.fbp && { fbp: d.fbp }),
    },
    custom_data: { content_name: "Prueba Gratis 1 Mes", currency: "COP", value: 0 },
  };
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // El token va en el cuerpo, no en la URL (no queda en registros de acceso).
      body: JSON.stringify({
        data: [evento],
        access_token: token,
        ...(process.env.META_TEST_EVENT_CODE && { test_event_code: process.env.META_TEST_EVENT_CODE }),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) console.error("[meta-capi] CompleteRegistration", r.status, (await r.text()).slice(0, 300));
  } catch (e) {
    console.error("[meta-capi] CompleteRegistration", e instanceof Error ? e.message : e);
  }
}
