import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Almacén de archivos de Firma Electrónica (PDF originales, firmas y PDF
 * sellados). Los archivos NO van a la base de datos: en la base solo queda la
 * "clave" (ruta relativa) y su SHA-256.
 *
 * Por ahora hay un solo driver: carpeta del servidor (FIRMA_STORAGE_DIR, por
 * defecto ./.firmas-storage). Las funciones son las únicas que tocan el disco,
 * así que cambiar a un bucket (S3, R2, Supabase Storage) es reemplazar este
 * archivo sin tocar el resto del módulo.
 */

const DIR = path.resolve(process.env.FIRMA_STORAGE_DIR ?? ".firmas-storage");

/** Solo claves generadas por el módulo: "<uuid>/<nombre>" sin subir de carpeta. */
function rutaSegura(clave: string) {
  if (!/^[a-f0-9-]{36}\/[a-zA-Z0-9._-]+$/.test(clave)) throw new Error("Clave de archivo no válida.");
  return path.join(DIR, clave);
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
