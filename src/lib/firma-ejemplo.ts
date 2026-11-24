import type { Auditoria, Documento, Firmante } from "./firmas";

/**
 * Documento de EJEMPLO de la Firma Electrónica (24 nov 2026): el PDF de muestra
 * que se le enseña al abogado ("Poder especial - María Fernanda Gómez Ríos") trae
 * en su QR este id. Para que al escanearlo se vea la verificación real, la página
 * /verificar lo resuelve con estos datos fijos, sin tocar la base.
 * Datos ficticios. Si se regenera el PDF de muestra, actualizar FIRMADO_SHA256.
 */
export const ID_EJEMPLO = "7c41e9a2-58d3-4b6f-9e0a-2d81f4c6b3a5";

const ORIGINAL_SHA256 = "f5030374e0973f12f1dfdbddc7a0a7be3da78ca464b26377eeb5208cb759f551";
const FIRMADO_SHA256 = "72cccd4d8c3196f20662e67f82316f48d0c806773be0012589f9f2c2193346f4";

const t0 = Date.parse("2026-11-17T15:29:26Z"); // 10:29 a. m. Colombia
const m = (min: number, s = 0) => new Date(t0 + (min * 60 + s) * 1000);

export function ejemploVerificacion(id: string) {
  if (id !== ID_EJEMPLO) return null;
  const doc: Documento = {
    id: ID_EJEMPLO,
    userId: "ejemplo",
    radicado: "05001310302120240028100",
    titulo: "Poder especial - María Fernanda Gómez Ríos",
    estado: "COMPLETED",
    paginas: 3,
    originalUrl: "",
    originalSha256: ORIGINAL_SHA256,
    firmadoUrl: null,
    firmadoSha256: FIRMADO_SHA256,
    otpCorreo: true,
    otpWhatsapp: true,
    verificacion: "biometrica",
    sello: { modo: "desarrollo" },
    precio: null,
    pagoId: null,
    pagadoAt: null,
    gratis: true,
    createdAt: m(0),
    enviadoAt: m(0, 40),
    completedAt: m(22, 8),
  };
  const base = {
    documentoId: ID_EJEMPLO,
    token: "",
    otpHash: null,
    otpExpira: null,
    otpIntentos: 0,
    posicion: null,
    estado: "SIGNED" as const,
    motivo: null,
    firmaUrl: null,
    cedulaFrenteUrl: null,
    cedulaReversoUrl: null,
    selfieUrl: null,
  };
  const firmantes: Firmante[] = [
    {
      ...base,
      id: "ej-maria",
      nombre: "María Fernanda Gómez Ríos",
      tipoDoc: "CC",
      numDoc: "43123456",
      email: "maria@correo.com",
      telefono: "573001234567",
      orden: 1,
      otpVerificadoAt: m(9, 40),
      tipoFirma: "dibujada",
      firmadoAt: m(14, 12),
      identidad: {
        nivel: "biometrica",
        estado: "verificada",
        motor: "estradox",
        numeroLeido: "43123456",
        numeroCoincide: true,
        similitud: 0.94,
        rostroCoincide: true,
        vida: { parpadeo: true, giro: true },
        intentos: 1,
        huellas: {},
      },
      identidadAt: m(12, 48),
    },
    {
      ...base,
      id: "ej-carlos",
      nombre: "Carlos Andrés Pérez Mejía",
      tipoDoc: "CC",
      numDoc: "71234567",
      email: "carlos@bufete.com",
      telefono: null,
      orden: 2,
      otpVerificadoAt: m(21, 20),
      tipoFirma: "tipografica",
      firmadoAt: m(22, 5),
      identidad: null,
      identidadAt: null,
    },
  ];
  const ev = (n: number, evento: Auditoria["evento"], firmanteId: string | null, fecha: Date): Auditoria => ({
    id: `ej-${n}`,
    documentoId: ID_EJEMPLO,
    firmanteId,
    evento,
    ip: null,
    userAgent: null,
    metadata: null,
    createdAt: fecha,
  });
  const auditoria: Auditoria[] = [
    ev(1, "CREATED", null, m(0)),
    ev(2, "OTP_VERIFIED", "ej-maria", m(9, 40)),
    ev(3, "IDENTITY_VERIFIED", "ej-maria", m(12, 48)),
    ev(4, "SIGNED", "ej-maria", m(14, 12)),
    ev(5, "OTP_VERIFIED", "ej-carlos", m(21, 20)),
    ev(6, "SIGNED", "ej-carlos", m(22, 5)),
    ev(7, "SEALED_PDF_GENERATED", null, m(22, 8)),
  ];
  return { doc, firmantes, auditoria, abogado: "Carlos Andrés Pérez Mejía" };
}
