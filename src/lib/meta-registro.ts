import "server-only";
import { createHash } from "node:crypto";
import { after } from "next/server";
import { cookies, headers } from "next/headers";
import { COOKIE_REGISTRO, META_PIXEL_ID, nombreCompra } from "./meta-pixel-config";

/**
 * Marca que se acaba de crear una cuenta:
 *  - Navegador: el Píxel de Meta (componente MetaPixel) envía CompleteRegistration
 *    y borra la cookie.
 *  - Servidor (Conversions API, 20 nov 2026): el mismo evento, con el mismo
 *    event_id ("registro-<id>"), para que cuente aunque Safari o un bloqueador
 *    frenen el píxel; si llegan los dos, Meta los deduplica.
 * Solo se llama al CREAR la cuenta, nunca en un login.
 * Las cuentas de prueba (esPruebaMeta) no envían nada, ni por píxel ni por servidor.
 */
export async function marcarRegistroNuevo(userId: string, email: string) {
  if (esPruebaMeta(email)) {
    // Sin cookie el píxel no dispara; queda constancia en MetaCapiLog.
    after(() => registrarCapi(userId, true, false, null, "omitido: correo de prueba"));
    return;
  }
  const jar = await cookies();
  jar.set(COOKIE_REGISTRO, userId, {
    path: "/",
    maxAge: 60 * 60, // si no se envía en 1 hora, se descarta
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: false, // la lee el script del píxel
  });

  const datos = datosDeCabeceras(await headers());
  after(() => enviarRegistroCapi(userId, datos));
}

/**
 * Valor CRUDO de una cookie de Meta (_fbc/_fbp), tal cual la escribió el píxel:
 * cookies() de Next decodifica los %XX y eso puede alterar el fbclid ("fbclid
 * modificado" en Meta). Si hay dos (la del dominio estradox.com y la de app.), se
 * usa la más reciente según su marca de tiempo. Si no tiene el formato de Meta
 * (fb.<n>.<ms>.<valor>), no se envía: mejor sin fbc que con uno alterado.
 */
export function cookieMetaCruda(cabeceraCookie: string | null, nombre: "_fbc" | "_fbp"): string | undefined {
  if (!cabeceraCookie) return undefined;
  const valores = cabeceraCookie
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p.startsWith(`${nombre}=`))
    .map((p) => p.slice(nombre.length + 1))
    .filter((v) => /^fb\.\d+\.\d+\.\S+$/.test(v));
  if (!valores.length) return undefined;
  return valores.sort((a, b) => Number(b.split(".")[2]) - Number(a.split(".")[2]))[0];
}

function datosDeCabeceras(h: Headers): DatosMeta {
  const c = h.get("cookie");
  return {
    fbc: cookieMetaCruda(c, "_fbc"),
    fbp: cookieMetaCruda(c, "_fbp"),
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || h.get("cf-connecting-ip") || undefined,
    ua: h.get("user-agent") ?? undefined,
  };
}

/**
 * Correos de prueba que nunca se reportan a Meta (22 nov 2026), para poder probar
 * el registro en producción sin contaminar las campañas:
 *  - contienen "+test" (ej. nombre+test1@gmail.com),
 *  - terminan en "@estradox.test",
 *  - o están en META_IGNORED_EMAILS (separados por coma).
 */
export function esPruebaMeta(email: string | null | undefined) {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return false;
  if (e.includes("+test") || e.endsWith("@estradox.test")) return true;
  const lista = (process.env.META_IGNORED_EMAILS ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return lista.includes(e);
}

const sha256 = (s: string) => createHash("sha256").update(s.trim().toLowerCase()).digest("hex");

export type DatosMeta = { fbc?: string; fbp?: string; ip?: string; ua?: string };

/**
 * Datos de Meta del navegador que hace la petición (cookies _fbc/_fbp, IP y
 * navegador). Fuera de una petición (cron, webhook) devuelve {}.
 */
export async function datosMetaDeLaPeticion(): Promise<DatosMeta> {
  try {
    return datosDeCabeceras(await headers());
  } catch {
    return {};
  }
}

/**
 * Purchase por Conversions API (20 nov 2026) al acreditarse un pago de Bold, con el
 * valor real cobrado: así el ROAS de Meta se calcula con plata que entró. El
 * event_id "compra-<link>" es el mismo que dispara el píxel en /dashboard/suscripcion.
 * Los datos de Meta se guardaron al crear el link (el webhook de Bold no los trae).
 */
export async function enviarCompraCapi(c: {
  linkId: string;
  userId: string;
  valor: number;
  tipo: string;
  datos: DatosMeta | null;
}) {
  const token = process.env.META_CAPI_ACCESS_TOKEN;
  const prueba = !!process.env.META_TEST_EVENT_CODE;
  const etiqueta = `compra ${c.linkId}`;
  if (!token) return registrarCapi(etiqueta, prueba, false, null, "sin META_CAPI_ACCESS_TOKEN");
  const d = c.datos ?? {};
  const evento = {
    event_name: "Purchase",
    event_time: Math.floor(Date.now() / 1000),
    event_id: `compra-${c.linkId}`,
    action_source: "website",
    event_source_url: "https://app.estradox.com/dashboard/suscripcion",
    user_data: {
      external_id: [sha256(c.userId)],
      country: [sha256("co")],
      ...(d.ip && { client_ip_address: d.ip }),
      ...(d.ua && { client_user_agent: d.ua }),
      ...(d.fbc && { fbc: d.fbc }),
      ...(d.fbp && { fbp: d.fbp }),
    },
    custom_data: { content_name: nombreCompra(c.tipo), content_type: "product", currency: "COP", value: c.valor },
  };
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [evento],
        access_token: token,
        ...(process.env.META_TEST_EVENT_CODE && { test_event_code: process.env.META_TEST_EVENT_CODE }),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const texto = (await r.text()).slice(0, 500);
    if (!r.ok) console.error("[meta-capi] Purchase", r.status, texto);
    await registrarCapi(etiqueta, prueba, true, r.status, texto, d);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[meta-capi] Purchase", msg);
    await registrarCapi(etiqueta, prueba, true, null, msg, d);
  }
}



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
  const prueba = !!process.env.META_TEST_EVENT_CODE;
  if (!token) return registrarCapi(userId, prueba, false, null, "sin META_CAPI_ACCESS_TOKEN");
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
    const texto = (await r.text()).slice(0, 500);
    if (!r.ok) console.error("[meta-capi] CompleteRegistration", r.status, texto);
    await registrarCapi(userId, prueba, true, r.status, texto, d);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[meta-capi] CompleteRegistration", msg);
    await registrarCapi(userId, prueba, true, null, msg, d);
  }
}

/**
 * Resultado de cada envío a Meta (sin el token), para revisar desde la base si
 * llegó: Hostinger no deja ver los logs de la app fácilmente.
 */
let columnasLog = false;
async function registrarCapi(
  userId: string,
  prueba: boolean,
  conToken: boolean,
  status: number | null,
  respuesta: string,
  /** Si el evento llevó fbc (clic en anuncio) y fbp: solo sí/no, nunca el valor. */
  datos?: DatosMeta | null,
) {
  try {
    const { prisma } = await import("./db");
    if (!columnasLog) {
      await prisma.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS "MetaCapiLog" (id SERIAL PRIMARY KEY, "userId" TEXT, prueba BOOLEAN, "conToken" BOOLEAN, status INTEGER, respuesta TEXT, "at" TIMESTAMPTZ DEFAULT now())`,
      );
      // 25 nov 2026: para ver qué registros/compras vinieron de un clic en anuncio.
      await prisma.$executeRawUnsafe(`ALTER TABLE "MetaCapiLog" ADD COLUMN IF NOT EXISTS "conFbc" BOOLEAN`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "MetaCapiLog" ADD COLUMN IF NOT EXISTS "conFbp" BOOLEAN`);
      columnasLog = true;
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO "MetaCapiLog" ("userId", prueba, "conToken", status, respuesta, "conFbc", "conFbp") VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      userId,
      prueba,
      conToken,
      status,
      respuesta.slice(0, 500),
      datos ? !!datos.fbc : null,
      datos ? !!datos.fbp : null,
    );
  } catch (e) {
    console.error("[meta-capi] no se pudo guardar el resultado", e);
  }
}
