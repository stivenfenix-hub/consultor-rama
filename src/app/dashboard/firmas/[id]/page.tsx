import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  DIAS_VIGENCIA,
  ESTADOS_DOC,
  ESTADOS_FIRMANTE,
  NIVELES,
  resumenIdentidad,
  EVENTOS,
  auditoriaDe,
  documentoDe,
  firmantesDe,
  type EstadoFirmante,
  type EventoFirma,
} from "@/lib/firmas";
import { enlaceFirma, enlaceVerificar } from "@/lib/firma-envios";
import { sellarSiCompleto } from "@/services/signature-engine";
import { Icon, type IconName } from "@/components/icon";
import { CopiarEnlace, EnVivo, Recordar } from "../piezas";

export const metadata = { title: "Documento para firmar" };

const fechaHora = (d: Date | null) =>
  d
    ? new Date(d).toLocaleString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", second: "2-digit" })
    : "—";

const ICONO_EVENTO: Record<EventoFirma, IconName> = {
  CREATED: "file",
  SENT_EMAIL: "mail",
  SENT_WHATSAPP: "chat",
  LINK_OPENED: "eye",
  OTP_SENT: "phone",
  OTP_VERIFIED: "shield",
  OTP_FAILED: "alert",
  DOCUMENT_VIEWED: "eye",
  SIGNED: "firma",
  REJECTED: "alert",
  REMINDER_SENT: "bell",
  SEALED_PDF_GENERATED: "sello",
  IDENTITY_VERIFIED: "users",
  IDENTITY_INCONCLUSIVE: "alert",
};
const CLASE_FIRMANTE: Record<EstadoFirmante, string> = { PENDING: "", VIEWED: "reciente", SIGNED: "new", REJECTED: "rojo" };
const CLASE_DOC = { DRAFT: "", PENDING: "reciente", PARTIALLY_SIGNED: "warn", COMPLETED: "new", REJECTED: "rojo", EXPIRED: "" } as const;

export default async function DetalleFirma({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  let doc = await documentoDe(user.id, id);
  if (!doc) notFound();
  if (doc.estado === "DRAFT") redirect(`/dashboard/firmas/nuevo?id=${doc.id}`);

  // Si todos firmaron pero el sellado falló en su momento, se reintenta aquí.
  let errorSello: string | null = null;
  if (doc.estado === "PENDING" || doc.estado === "PARTIALLY_SIGNED") {
    try {
      if (await sellarSiCompleto(doc.id)) doc = (await documentoDe(user.id, id)) ?? doc;
    } catch {
      errorSello = "Todos firmaron, pero no pudimos generar el PDF sellado. Vuelve a abrir esta página en un momento.";
    }
  }

  const [firmantes, auditoria] = await Promise.all([firmantesDe(doc.id), auditoriaDe(doc.id)]);
  const nombreDe = new Map(firmantes.map((f) => [f.id, f.nombre]));
  const firmados = firmantes.filter((f) => f.estado === "SIGNED").length;
  const abierto = doc.estado === "PENDING" || doc.estado === "PARTIALLY_SIGNED";
  const sello = (doc.sello ?? {}) as { modo?: string; certificado?: string | null; tsa?: unknown };

  return (
    <div className="page">
      <div className="page-head wrap">
        <div>
          <Link prefetch={false} href="/dashboard/firmas" className="small muted">← Firma electrónica</Link>
          <h1 style={{ marginTop: 4 }}>{doc.titulo}</h1>
          <div className="row wrap" style={{ gap: 8, marginTop: 4 }}>
            <span className={`badge ${CLASE_DOC[doc.estado]}`}>{ESTADOS_DOC[doc.estado]}</span>
            <span className="badge" title={NIVELES[doc.verificacion].d}>
              {NIVELES[doc.verificacion].t}
            </span>
            {doc.radicado && <span className="radicado small">{doc.radicado}</span>}
            {abierto && <EnVivo />}
          </div>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <a className="btn secondary" href={`/api/firmas/${doc.id}/pdf`}>
            <Icon name="download" size={16} /> Original
          </a>
          {doc.estado === "COMPLETED" && (
            <a className="btn" href={`/api/firmas/${doc.id}/pdf?tipo=firmado`}>
              <Icon name="sello" size={16} /> Descargar PDF sellado
            </a>
          )}
        </div>
      </div>

      {errorSello && <div className="error" style={{ marginBottom: 12 }}>{errorSello}</div>}

      {doc.estado === "COMPLETED" && (
        <div className="card firma-listo">
          <div className="firma-veredicto-icon">
            <Icon name="check" size={22} />
          </div>
          <div>
            <b>Firmado por todos el {fechaHora(doc.completedAt)}</b>
            <p className="small" style={{ margin: "4px 0 0" }}>
              El PDF sellado lleva al final el Certificado de Auditoría y Evidencia Digital, con un código QR que
              cualquier juez o contraparte puede escanear para comprobarlo.{" "}
              <a href={enlaceVerificar(doc.id)} target="_blank" rel="noopener noreferrer">Ver la página de verificación</a>
            </p>
            <p className="muted small" style={{ margin: "6px 0 0" }}>
              {sello.modo === "p12"
                ? `Sellado con la firma digital de ${sello.certificado ?? "Estradox"}${sello.tsa ? " y estampa cronológica" : ""}.`
                : "Sellado por Estradox: identidad de cada firmante confirmada con código OTP, huellas SHA-256 y bitácora completa. Tiene plena validez como firma electrónica (Ley 527 de 1999 y Decreto 2364 de 2012)."}
            </p>
          </div>
        </div>
      )}
      {doc.estado === "REJECTED" && (
        <div className="card firma-excepciones">
          <b>Un firmante rechazó el documento.</b>
          {firmantes.filter((f) => f.estado === "REJECTED").map((f) => (
            <p key={f.id} className="small" style={{ margin: "6px 0 0" }}>
              {f.nombre}: «{f.motivo}»
            </p>
          ))}
          <p className="muted small" style={{ marginBottom: 0 }}>Corrige lo que haga falta y envía un documento nuevo.</p>
        </div>
      )}
      {doc.estado === "EXPIRED" && (
        <div className="card">
          <b>El enlace venció.</b>
          <p className="muted small" style={{ marginBottom: 0 }}>
            Pasaron {DIAS_VIGENCIA} días sin que firmaran todos. Envía un documento nuevo.
          </p>
        </div>
      )}

      <div className="card">
        <div className="row wrap" style={{ gap: 10 }}>
          <h2 style={{ margin: 0 }}>
            Firmantes · {firmados} de {firmantes.length}
          </h2>
          <div className="spacer" />
          {abierto && <Recordar id={doc.id} />}
        </div>
        <div className="firma-barra" style={{ margin: "10px 0 14px" }}>
          <div style={{ width: `${firmantes.length ? (firmados / firmantes.length) * 100 : 0}%` }} className={firmados === firmantes.length ? "lleno" : ""} />
        </div>
        {firmantes.map((f) => (
          <div key={f.id} className="firma-persona">
            <div className="firma-persona-info">
              <div className="row wrap" style={{ gap: 8 }}>
                <b>{f.nombre}</b>
                <span className={`badge ${CLASE_FIRMANTE[f.estado]}`}>{ESTADOS_FIRMANTE[f.estado]}</span>
              </div>
              <div className="muted small">
                {f.tipoDoc} {f.numDoc} · {[f.email, f.telefono].filter(Boolean).join(" · ")}
              </div>
              <div className="muted small">
                {f.estado === "SIGNED"
                  ? `Firmó el ${fechaHora(f.firmadoAt)}`
                  : f.otpVerificadoAt
                    ? `Confirmó su identidad el ${fechaHora(f.otpVerificadoAt)}; aún no firma`
                    : f.estado === "VIEWED"
                      ? "Abrió el enlace; aún no confirma su identidad"
                      : f.estado === "REJECTED"
                        ? `No firmó: «${f.motivo}»`
                        : "Aún no abre el enlace"}
              </div>
              {f.identidad && (
                <>
                  <div className={`small ${f.identidad.estado === "verificada" ? "ok" : "error"}`} style={{ marginTop: 4 }}>
                    {f.identidad.estado === "verificada" ? "✓ " : "⚠ "}
                    {resumenIdentidad(f.identidad)}
                  </div>
                  <div className="identidad-miniaturas">
                    {(["frente", "reverso", "selfie"] as const)
                      .filter((t) => (t === "frente" ? f.cedulaFrenteUrl : t === "reverso" ? f.cedulaReversoUrl : f.selfieUrl))
                      .map((t) => {
                        const src = `/api/firmas/${doc.id}/identidad?f=${f.id}&tipo=${t}`;
                        return (
                          <a key={t} href={src} target="_blank" rel="noopener noreferrer" title={t === "selfie" ? "Selfie" : `Cédula: ${t}`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={src} alt={t} />
                          </a>
                        );
                      })}
                  </div>
                </>
              )}
              {!f.identidad && doc.verificacion !== "otp" && f.estado !== "REJECTED" && (
                <div className="muted small">Aún no verifica su identidad ({NIVELES[doc.verificacion].t.toLowerCase()}).</div>
              )}
            </div>
            {abierto && f.estado !== "SIGNED" && <CopiarEnlace url={enlaceFirma(f.token)} />}
          </div>
        ))}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Trazabilidad</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Cada paso queda registrado con fecha, hora de Colombia e IP. Es la evidencia que va en el certificado.
        </p>
        <ol className="firma-linea">
          {auditoria.map((a) => (
            <li key={a.id} className={a.evento === "SIGNED" || a.evento === "SEALED_PDF_GENERATED" ? "fuerte" : ""}>
              <span className="firma-linea-icono">
                <Icon name={ICONO_EVENTO[a.evento] ?? "clock"} size={15} />
              </span>
              <div>
                <b>{EVENTOS[a.evento] ?? a.evento}</b>
                <div className="muted small">
                  {a.firmanteId ? (nombreDe.get(a.firmanteId) ?? "Firmante") : a.evento === "SEALED_PDF_GENERATED" ? "Estradox" : "Tú"}
                  {" · "}
                  {fechaHora(a.createdAt)}
                  {a.ip ? ` · IP ${a.ip}` : ""}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Huellas del documento (SHA-256)</h2>
        <div className="firma-huella">
          <span className="muted small">Original</span>
          <code>{doc.originalSha256}</code>
        </div>
        {doc.firmadoSha256 && (
          <div className="firma-huella">
            <span className="muted small">PDF sellado</span>
            <code>{doc.firmadoSha256}</code>
          </div>
        )}
        <p className="muted small" style={{ marginBottom: 0 }}>
          La huella es como la cédula del archivo: si alguien le cambia una sola letra, ya no coincide.
        </p>
      </div>
    </div>
  );
}
