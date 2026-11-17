import "server-only";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

/**
 * Almacén de archivos de Firma Electrónica (PDF originales y sellados, firmas,
 * fotos de cédula y selfies). Los archivos NO van a la base de datos: en la
 * base solo queda la "clave" (ruta relativa) y su SHA-256.
 *
 * Dónde se guardan:
 *   - FIRMA_STORAGE_DIR, si está definida (ruta absoluta recomendada).
 *   - En producción, sin esa variable: /home/<usuario>/domains/<dominio>/estradox-firmas,
 *     fuera de las carpetas de versión que Hostinger crea en cada publicación
 *     (ver carpetaProduccion).
 *   - En desarrollo: ./.firmas-storage
 *
 * Las funciones de aquí son las únicas que tocan el disco: cambiar a un bucket
 * (S3, R2, Supabase Storage) es reemplazar este archivo sin tocar el resto.
 */

/**
 * Carpeta por defecto en producción. Hostinger corre la app desde una carpeta
 * NUEVA en cada publicación:
 *   /home/<usuario>/domains/<dominio>/hbuilds/versions/<id>/nodejs
 * Por eso la carpeta de archivos va en /home/<usuario>/domains/<dominio>/,
 * fuera de "hbuilds", que no cambia entre publicaciones.
 */
function carpetaProduccion() {
  const app = process.cwd().replace(/\\/g, "/");
  const i = app.indexOf("/hbuilds/");
  return i > 0 ? path.posix.join(app.slice(0, i), "estradox-firmas") : path.join(app, "..", "estradox-firmas");
}

export const CARPETA_FIRMAS = path.resolve(
  process.env.FIRMA_STORAGE_DIR?.trim() ||
    (process.env.NODE_ENV === "production" ? carpetaProduccion() : ".firmas-storage"),
);

/** Solo claves generadas por el módulo: "<uuid>/<nombre>" sin subir de carpeta. */
function rutaSegura(clave: string) {
  if (!/^[a-f0-9-]{36}\/[a-zA-Z0-9._-]+$/.test(clave)) throw new Error("Clave de archivo no válida.");
  return path.join(CARPETA_FIRMAS, clave);
}

export async function guardarArchivo(clave: string, datos: Uint8Array | Buffer): Promise<string> {
  const ruta = rutaSegura(clave);
  await mkdir(path.dirname(ruta), { recursive: true });
  await writeFile(ruta, datos);
  return clave;
}

export async function leerArchivo(clave: string): Promise<Buffer> {
  return readFile(rutaSegura(clave));
}

/** Diagnóstico para el root: qué carpeta se usa y si se puede escribir en ella. */
export async function estadoAlmacen() {
  const prueba = path.join(CARPETA_FIRMAS, ".prueba-escritura");
  try {
    await mkdir(CARPETA_FIRMAS, { recursive: true });
    await writeFile(prueba, String(Date.now()));
    await rm(prueba, { force: true });
    await access(CARPETA_FIRMAS, constants.R_OK | constants.W_OK);
    return { carpeta: CARPETA_FIRMAS, appEn: process.cwd(), escribe: true, error: null as string | null };
  } catch (e) {
    return { carpeta: CARPETA_FIRMAS, appEn: process.cwd(), escribe: false, error: e instanceof Error ? e.message : String(e) };
  }
}
