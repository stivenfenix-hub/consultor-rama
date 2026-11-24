import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { Icon } from "@/components/icon";
import {
  ESTADOS_DOC,
  ESTADOS_FIRMANTE,
  EVENTOS,
  auditoriaDe,
  documentoPorId,
  firmantesDe,
  nombreAbogado,
  ocultarDoc,
  resumenIdentidad,
} from "@/lib/firmas";
import { ejemploVerificacion } from "@/lib/firma-ejemplo";
import { Comparar } from "./comparar";

export const metadata = { title: "Verificar documento · Estradox", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const fechaHora = (d: Date | null) =>
  d
    ? new Date(d).toLocaleString("es-CO", {
        timeZone: "America/Bogota",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

/**
 * Página pública del QR del certificado: cualquier juez o contraparte comprueba
 * aquí que el documento existe, quién lo firmó y cuál es su huella SHA-256.
 * No muestra el contenido del documento ni los datos completos de los firmantes.
 */
export default async function Verificar({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // El PDF de muestra de la Firma Electrónica trae un id fijo con datos de ejemplo.
  const ejemplo = ejemploVerificacion(id);
  const doc = ejemplo ? ejemplo.doc : await documentoPorId(id).catch(() => null);
  const visible = doc && doc.estado !== "DRAFT" ? doc : null;

  return (
    <div className="firmar-pagina">
      <header className="firmar-cabecera">
        <BrandLogo />
        <span className="muted small">Verificación de documentos</span>
      </header>
      <main className="firmar-cuerpo ancho">
        {!visible ? (
          <div className="card firma-veredicto no" style={{ display: "flex" }}>
            <div className="firma-veredicto-icon">
              <Icon name="alert" size={22} />
            </div>
            <div>
              <b>No encontramos este documento</b>
              <p className="small" style={{ margin: "4px 0 0" }}>
                El identificador <code>{id.slice(0, 60)}</code> no corresponde a ningún documento firmado con Estradox.
                Si el PDF trae un código QR de Estradox que lleva aquí, puede haber sido alterado.
              </p>
            </div>
          </div>
        ) : (
          await (async () => {
            const [firmantes, auditoria, abogado] = ejemplo
              ? [ejemplo.firmantes, ejemplo.auditoria, ejemplo.abogado]
              : await Promise.all([firmantesDe(visible.id), auditoriaDe(visible.id), nombreAbogado(visible.userId)]);
            const nombreDe = new Map(firmantes.map((f) => [f.id, f.nombre]));
            const completo = visible.estado === "COMPLETED";
            const sello = (visible.sello ?? {}) as { modo?: string; certificado?: string | null; tsa?: { url?: string; token?: string; huella?: string } | null };
            // En público solo los hechos principales de la bitácora (sin IP).
            const hitos = auditoria.filter((a) =>
              ["CREATED", "OTP_VERIFIED", "IDENTITY_VERIFIED", "IDENTITY_INCONCLUSIVE", "SIGNED", "REJECTED", "SEALED_PDF_GENERATED"].includes(a.evento),
            );
            return (
              <>
                <div className={`card firma-veredicto ${completo ? "si" : "no"}`} style={{ display: "flex" }}>
                  <div className="firma-veredicto-icon">
                    <Icon name={completo ? "check" : "alert"} size={22} />
                  </div>
                  <div>
                    <b>
                      {completo
                        ? "Documento auténtico: firmado electrónicamente con Estradox"
                        : `Este documento aún no está completo (${ESTADOS_DOC[visible.estado].toLowerCase()})`}
                    </b>
                    <p className="small" style={{ margin: "4px 0 0" }}>
                      {completo
                        ? `Todas las partes lo firmaron y quedó sellado el ${fechaHora(visible.completedAt)} (hora de Colombia).`
                        : "Mientras no firmen todas las partes no existe un PDF sellado que verificar."}
                    </p>
                  </div>
                </div>

                <div className="card">
                  <h1 style={{ fontSize: 20, marginTop: 0 }}>{visible.titulo}</h1>
                  <div className="verificar-datos">
                    <div>
                      <span className="muted small">ID único</span>
                      <code>{visible.id}</code>
                    </div>
                    {visible.radicado && (
                      <div>
                        <span className="muted small">Radicado</span>
                        <code>{visible.radicado}</code>
                      </div>
                    )}
                    <div>
                      <span className="muted small">Enviado a firmar por</span>
                      <b>{abogado}</b>
                    </div>
                    <div>
                      <span className="muted small">Creado</span>
                      <span>{fechaHora(visible.createdAt)}</span>
                    </div>
                  </div>
                </div>

                <div className="card">
                  <h2 style={{ marginTop: 0 }}>Huellas SHA-256</h2>
                  <div className="firma-huella">
                    <span className="muted small">Documento original</span>
                    <code>{visible.originalSha256}</code>
                  </div>
                  {visible.firmadoSha256 && (
                    <div className="firma-huella">
                      <span className="muted small">PDF sellado (el que se entrega)</span>
                      <code>{visible.firmadoSha256}</code>
                    </div>
                  )}
                  <Comparar original={visible.originalSha256} firmado={visible.firmadoSha256} />
                </div>

                <div className="card">
                  <h2 style={{ marginTop: 0 }}>Firmantes ({firmantes.length})</h2>
                  {firmantes.map((f) => (
                    <div key={f.id} className="firma-persona">
                      <div className="firma-persona-info">
                        <div className="row wrap" style={{ gap: 8 }}>
                          <b>{f.nombre}</b>
                          <span className={`badge ${f.estado === "SIGNED" ? "new" : f.estado === "REJECTED" ? "rojo" : ""}`}>
                            {ESTADOS_FIRMANTE[f.estado]}
                          </span>
                        </div>
                        <div className="muted small">
                          {f.tipoDoc} {ocultarDoc(f.numDoc.replace(/\W/g, ""))}
                          {f.firmadoAt ? ` · firmó el ${fechaHora(f.firmadoAt)}` : ""}
                        </div>
                        {f.otpVerificadoAt && (
                          <div className="muted small">Identidad confirmada con código de un solo uso (OTP).</div>
                        )}
                        {f.identidad && <div className="muted small">{resumenIdentidad(f.identidad)}.</div>}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="card">
                  <h2 style={{ marginTop: 0 }}>Hechos principales</h2>
                  <ol className="firma-linea">
                    {hitos.map((a) => (
                      <li key={a.id} className={a.evento === "SIGNED" || a.evento === "SEALED_PDF_GENERATED" ? "fuerte" : ""}>
                        <span className="firma-linea-icono">
                          <Icon name={a.evento === "SIGNED" ? "firma" : a.evento === "SEALED_PDF_GENERATED" ? "sello" : "clock"} size={15} />
                        </span>
                        <div>
                          <b>{EVENTOS[a.evento] ?? a.evento}</b>
                          <div className="muted small">
                            {a.firmanteId ? `${nombreDe.get(a.firmanteId) ?? "Firmante"} · ` : ""}
                            {fechaHora(a.createdAt)}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <p className="muted small" style={{ marginBottom: 0 }}>
                    La bitácora completa, con las direcciones IP, está en el certificado anexo al PDF sellado.
                  </p>
                </div>

                {completo && (
                  <div className="card">
                    <h2 style={{ marginTop: 0 }}>Sello</h2>
                    <p className="small" style={{ margin: 0 }}>
                      {sello.modo === "p12"
                        ? `El PDF lleva la firma digital del certificado «${sello.certificado ?? "Estradox"}»: un lector de PDF (como Adobe Acrobat) avisa si fue modificado después de sellarlo.`
                        : "Firma electrónica conforme a la Ley 527 de 1999 y el Decreto 2364 de 2012: cada firmante confirmó su identidad con un código de un solo uso, y las huellas SHA-256 permiten detectar cualquier cambio en el documento."}
                    </p>
                    {sello.tsa?.token && (
                      <details className="acordeon" style={{ marginTop: 10 }}>
                        <summary>Estampa cronológica (RFC 3161)</summary>
                        <p className="muted small">Emitida por {sello.tsa.url} sobre la huella {sello.tsa.huella}.</p>
                        <code className="verificar-token">{sello.tsa.token}</code>
                      </details>
                    )}
                  </div>
                )}

                {ejemplo && (
                  <p className="muted small" style={{ textAlign: "center", marginBottom: 0 }}>
                    Documento de muestra de Estradox con datos ficticios.
                  </p>
                )}
                <p className="muted small" style={{ textAlign: "center" }}>
                  Firma electrónica conforme a la Ley 527 de 1999, el Decreto 2364 de 2012 y el artículo 5 de la Ley 2213
                  de 2022. <Link prefetch={false} href="/firma-electronica">Conozca la Firma Electrónica de Estradox</Link>
                </p>
              </>
            );
          })()
        )}
      </main>
    </div>
  );
}
