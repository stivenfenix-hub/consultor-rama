import "server-only";
import { prisma } from "./db";

/**
 * Word → PDF para Firma Electrónica. La conversión la hace LibreOffice en el
 * VPS (servicio estradox-convertir, en convertir-worker/) a través de una cola
 * en la base: aquí se deja el archivo y se espera el PDF.
 */

export const EXT_WORD = /\.(docx|doc|odt|rtf)$/i;

/** ¿Es un Word (por nombre y por sus primeros bytes)? */
export function esWord(nombre: string, b: Uint8Array) {
  if (!EXT_WORD.test(nombre)) return false;
  const zip = b[0] === 0x50 && b[1] === 0x4b; // .docx / .odt
  const ole = b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0; // .doc
  const rtf = Buffer.from(b.subarray(0, 5)).toString("latin1") === "{\\rtf";
  return zip || ole || rtf;
}

let tabla: Promise<unknown> | null = null;
const asegurarTabla = () =>
  (tabla ??= prisma
    .$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "FirmaConversion" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" TEXT NOT NULL,
        nombre TEXT NOT NULL,
        entrada BYTEA,
        salida BYTEA,
        estado TEXT NOT NULL DEFAULT 'pendiente',
        error TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "listoAt" TIMESTAMPTZ
      )`)
    .catch((e) => {
      tabla = null;
      throw e;
    }));

/** Convierte el Word a PDF (espera hasta ~75 s). Lanza un Error con mensaje para el abogado. */
export async function wordAPdf(userId: string, nombre: string, datos: Uint8Array): Promise<Uint8Array> {
  await asegurarTabla();
  const [fila] = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO "FirmaConversion" ("userId", nombre, entrada) VALUES ($1, $2, $3) RETURNING id`,
    userId,
    nombre.slice(0, 200),
    Buffer.from(datos),
  );
  const fin = Date.now() + 75_000;
  try {
    while (Date.now() < fin) {
      await new Promise((r) => setTimeout(r, 700));
      const [r] = await prisma.$queryRawUnsafe<{ estado: string; salida: Buffer | null; error: string | null }[]>(
        `SELECT estado, CASE WHEN estado = 'listo' THEN salida END AS salida, error FROM "FirmaConversion" WHERE id = $1::uuid`,
        fila.id,
      );
      if (!r) break;
      if (r.estado === "listo" && r.salida) return new Uint8Array(r.salida);
      if (r.estado === "error") {
        console.error("[firma] conversión Word", r.error);
        throw new Error("No pudimos convertir ese Word a PDF. Revisa que abra bien o súbelo como PDF.");
      }
    }
    throw new Error("La conversión del Word está tardando más de lo normal. Intenta de nuevo o súbelo como PDF.");
  } finally {
    await prisma.$executeRawUnsafe(`DELETE FROM "FirmaConversion" WHERE id = $1::uuid`, fila.id).catch(() => {});
  }
}
