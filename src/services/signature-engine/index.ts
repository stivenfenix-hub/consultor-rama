import "server-only";
import {
  EVENTOS,
  auditar,
  auditoriaDe,
  documentoPorId,
  firmantesDe,
  marcarCompletado,
  nombreAbogado,
  soltarSello,
  tomarParaSellar,
} from "@/lib/firmas";
import { guardarArchivo, leerArchivo } from "@/lib/firma-storage";
import { avisarCompletado, enlaceVerificar } from "@/lib/firma-envios";
import { applyDigitalSignatureAndTSA, planSello } from "./firma-digital";
import { anexarCertificado, estamparFirmas, sha256Hex, type FirmaParaSellar } from "./sello";

/**
 * Motor de Firma Electrónica.
 *
 *   sha256Hex                    huella del PDF (al subirlo y al sellarlo)
 *   sellarSiCompleto             cuando firma el último: estampa, certifica, sella
 *   applyDigitalSignatureAndTSA  opcional: firma digital .p12 + estampa cronológica
 */

export { sha256Hex } from "./sello";
export { applyDigitalSignatureAndTSA, configSello, planSello } from "./firma-digital";
export { PLANTILLAS, plantillaPorId, renderizarPlantilla, camposFaltantes } from "./plantillas";

/**
 * Si ya firmaron todos, genera el PDF sellado. Es seguro llamarla varias
 * veces o desde dos firmas simultáneas: solo una la ejecuta.
 */
export async function sellarSiCompleto(documentoId: string): Promise<boolean> {
  if (!(await tomarParaSellar(documentoId))) return false;
  try {
    const doc = await documentoPorId(documentoId);
    if (!doc) throw new Error("documento no encontrado");
    const [firmantes, auditoria, abogado, original] = await Promise.all([
      firmantesDe(documentoId),
      auditoriaDe(documentoId),
      nombreAbogado(doc.userId),
      leerArchivo(doc.originalUrl),
    ]);
    // La huella del original debe seguir siendo la del día en que se subió.
    if (sha256Hex(original) !== doc.originalSha256) throw new Error("el PDF original no coincide con su huella");

    const nombreDe = new Map(firmantes.map((f) => [f.id, f.nombre]));
    const ipFirma = new Map(auditoria.filter((a) => a.evento === "SIGNED").map((a) => [a.firmanteId, a.ip]));
    const firmas: FirmaParaSellar[] = [];
    for (const f of firmantes) {
      if (!f.firmaUrl || !f.posicion || !f.firmadoAt) throw new Error(`falta la firma de ${f.nombre}`);
      firmas.push({
        nombre: f.nombre,
        tipoDoc: f.tipoDoc,
        numDoc: f.numDoc,
        email: f.email,
        telefono: f.telefono,
        imagen: await leerArchivo(f.firmaUrl),
        tipoFirma: f.tipoFirma,
        posicion: f.posicion,
        firmadoAt: f.firmadoAt,
        otpVerificadoAt: f.otpVerificadoAt,
        ip: ipFirma.get(f.id) ?? null,
      });
    }

    // 1) Firmas estampadas -> huella "con firmas".
    const estampado = await estamparFirmas(original, firmas);
    const hashFirmado = sha256Hex(await estampado.save());

    // 2) Certificado de auditoría como última(s) página(s).
    const plan = planSello();
    await anexarCertificado(
      estampado,
      {
        id: doc.id,
        titulo: doc.titulo,
        radicado: doc.radicado,
        abogado,
        creado: doc.createdAt,
        originalSha256: doc.originalSha256,
        urlVerificar: enlaceVerificar(doc.id),
        firmas,
        eventos: [
          ...auditoria.map((a) => ({
            fecha: a.createdAt,
            evento: EVENTOS[a.evento] ?? a.evento,
            quien: a.firmanteId ? (nombreDe.get(a.firmanteId) ?? "Firmante") : abogado,
            ip: a.ip,
          })),
          { fecha: new Date(), evento: EVENTOS.SEALED_PDF_GENERATED, quien: "Estradox (sistema)", ip: null },
        ],
        selloTexto:
          plan.modo === "p12"
            ? [
                "Este archivo lleva la firma digital del certificado de Estradox: cualquier lector de PDF",
                "(Adobe Acrobat, etc.) avisa si fue modificado después de sellarlo.",
                ...(plan.tsa ? ["Estampa cronológica RFC 3161: consulte el token en la página de verificación."] : []),
              ]
            : [
                "Firma electrónica (Ley 527 de 1999 y Decreto 2364 de 2012): la identidad de cada firmante se",
                "confirmó con un código de un solo uso (OTP) enviado a su correo o WhatsApp.",
                "Integridad: huellas SHA-256 del original y del firmado; cualquier cambio posterior se detecta.",
                "Autenticidad: escanee el QR o compare la huella del archivo en la página de verificación.",
              ],
      },
      hashFirmado,
    );
    estampado.setProducer("Estradox - Firma Electrónica");
    estampado.setModificationDate(new Date());

    // 3) Sello Estradox (y, si se configura, firma digital .p12 + TSA) -> huella final.
    const sello = await applyDigitalSignatureAndTSA(await estampado.save({ useObjectStreams: false }));
    const final = Buffer.from(sello.pdf);
    const firmadoSha256 = sha256Hex(final);
    const clave = await guardarArchivo(`${doc.id}/firmado.pdf`, final);

    await marcarCompletado(doc.id, clave, firmadoSha256, {
      modo: sello.modo,
      certificado: sello.certificado,
      tsa: sello.tsa,
      hashConFirmas: hashFirmado,
      avisos: sello.avisos,
    });
    await auditar(doc.id, "SEALED_PDF_GENERATED", {
      metadata: { sha256: firmadoSha256, modo: sello.modo, tsa: !!sello.tsa, avisos: sello.avisos },
    });
    const listo = await documentoPorId(doc.id);
    if (listo) await avisarCompletado(listo, firmantes, final).catch((e) => console.error("[firma] avisos", e));
    return true;
  } catch (e) {
    // Se suelta para poder reintentar (p. ej. al abrir el detalle del documento).
    await soltarSello(documentoId).catch(() => {});
    console.error("[firma] no se pudo sellar", documentoId, e);
    throw e;
  }
}
