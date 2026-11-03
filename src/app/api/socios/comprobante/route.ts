import { after, NextRequest, NextResponse } from "next/server";
import { usuarioSocio } from "@/lib/socios-acceso";
import { listaSocios } from "@/lib/subscription";
import { crearDesdeComprobante, MAX_ARCHIVO, MIMES_OK, procesarComprobante } from "@/lib/socios";

export const dynamic = "force-dynamic";

/** Sube uno o varios comprobantes; la IA los lee en segundo plano. */
export async function POST(req: NextRequest) {
  const user = await usuarioSocio();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const form = await req.formData();
  const nota = String(form.get("nota") ?? "").trim().slice(0, 500) || null;
  // El root puede registrar un comprobante a nombre de otro socio.
  const pedido = String(form.get("socioId") ?? "");
  const socios = await listaSocios();
  const socioId = socios.some((s) => s.id === pedido) ? pedido : user.id;

  const archivos = form.getAll("archivo").filter((f): f is File => f instanceof File && f.size > 0);
  if (archivos.length === 0) return NextResponse.json({ error: "Elige al menos un archivo." }, { status: 400 });
  const ids: number[] = [];
  for (const f of archivos.slice(0, 10)) {
    if (f.size > MAX_ARCHIVO) return NextResponse.json({ error: `${f.name}: máximo 10 MB.` }, { status: 400 });
    const tipo = f.type || "application/octet-stream";
    if (!MIMES_OK.includes(tipo)) {
      return NextResponse.json({ error: `${f.name}: sube un PDF o una foto (JPG, PNG, WEBP).` }, { status: 400 });
    }
    ids.push(
      await crearDesdeComprobante(socioId, user.id, { nombre: f.name, tipo, datos: Buffer.from(await f.arrayBuffer()) }, nota),
    );
  }
  after(async () => {
    for (const id of ids) await procesarComprobante(id).catch((e) => console.error("[socios] procesar", id, e));
  });
  return NextResponse.json({ ok: true, ids });
}
