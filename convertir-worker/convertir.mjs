// Servicio de Estradox en el VPS: convierte a PDF los Word que suben los
// abogados en Firma Electrónica, con LibreOffice (mismo formato que el Word).
//
// Cola en la base de datos (tabla "FirmaConversion"), sin puertos abiertos:
//   1. La app (Hostinger) inserta el archivo con estado 'pendiente'.
//   2. Este servicio lo toma, lo convierte y guarda el PDF ('listo' o 'error').
//   3. La app lee el PDF y borra el renglón.
//
// pm2: estradox-convertir. Necesita DATABASE_URL en .env.
import "dotenv/config";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "") ? false : { rejectUnauthorized: false },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

const TABLA = `
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
  )`;

function soffice(dir, archivo) {
  return new Promise((resolve, reject) => {
    execFile(
      "soffice",
      [
        `-env:UserInstallation=file://${dir}/perfil`,
        "--headless",
        "--norestore",
        "--convert-to",
        "pdf",
        "--outdir",
        dir,
        path.join(dir, archivo),
      ],
      { timeout: 90_000 },
      (err, _out, stderr) => (err ? reject(new Error(String(stderr || err.message).slice(0, 300))) : resolve()),
    );
  });
}

async function convertir(job) {
  const dir = await mkdtemp(path.join(tmpdir(), "conv-"));
  try {
    const ext = (path.extname(job.nombre).toLowerCase().match(/^\.(docx|doc|odt|rtf)$/) ?? [".docx"])[0];
    const archivo = `documento${ext}`;
    await writeFile(path.join(dir, archivo), job.entrada);
    await soffice(dir, archivo);
    return await readFile(path.join(dir, "documento.pdf"));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function tomar() {
  const r = await pool.query(
    `UPDATE "FirmaConversion" SET estado = 'convirtiendo'
     WHERE id = (SELECT id FROM "FirmaConversion" WHERE estado = 'pendiente'
                 ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING id, nombre, entrada`,
  );
  return r.rows[0] ?? null;
}

let ultimaLimpieza = 0;
async function limpiar() {
  if (Date.now() - ultimaLimpieza < 10 * 60_000) return;
  ultimaLimpieza = Date.now();
  // Lo que la app no recogió (o quedó a medias) se borra a la hora.
  await pool.query(`DELETE FROM "FirmaConversion" WHERE "createdAt" < now() - interval '1 hour'`);
}

async function main() {
  await pool.query(TABLA);
  log("[convertir] listo, esperando archivos");
  for (;;) {
    let espera = 1_000;
    try {
      await limpiar();
      const job = await tomar();
      if (job) {
        espera = 0;
        const t = Date.now();
        try {
          const pdf = await convertir(job);
          await pool.query(
            `UPDATE "FirmaConversion" SET salida = $2, entrada = NULL, estado = 'listo', "listoAt" = now() WHERE id = $1`,
            [job.id, pdf],
          );
          log(`[convertir] ${job.id} listo en ${Date.now() - t} ms (${pdf.length} bytes)`);
        } catch (e) {
          await pool.query(`UPDATE "FirmaConversion" SET estado = 'error', error = $2, entrada = NULL WHERE id = $1`, [
            job.id,
            String(e?.message ?? e).slice(0, 300),
          ]);
          log(`[convertir] ${job.id} error:`, e?.message ?? e);
        }
      }
    } catch (e) {
      log("[convertir] ciclo:", e?.message ?? e);
      espera = 5_000;
    }
    if (espera) await sleep(espera);
  }
}

main();
