import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { Icon, type IconName } from "@/components/icon";
import { getCurrentUser } from "@/lib/auth";

export const metadata = {
  title: "Firma Electrónica para abogados · Estradox",
  description:
    "Firme poderes y contratos sin reunirse con su cliente. Firma electrónica con validez legal en Colombia: Ley 527 de 1999, Decreto 2364 de 2012 y Ley 2213 de 2022.",
};

const PASOS: { icon: IconName; t: string; d: string }[] = [
  {
    icon: "file",
    t: "Sube el PDF o elige una plantilla",
    d: "Un poder especial o un contrato de honorarios ya redactado: llena los datos y Estradox arma el documento.",
  },
  {
    icon: "send",
    t: "Envía por correo o WhatsApp con código OTP",
    d: "Su cliente abre el enlace en el celular, confirma su identidad con un código de 6 dígitos y firma en segundos.",
  },
  {
    icon: "sello",
    t: "Descarga el PDF blindado",
    d: "Con las firmas estampadas y un certificado probatorio: quién firmó, cuándo, desde dónde y la huella SHA-256.",
  },
];

const DOCUMENTOS: { icon: IconName; t: string; d: string }[] = [
  { icon: "scale", t: "Poderes especiales", d: "Art. 5, Ley 2213 de 2022: como mensaje de datos, sin presentación personal ni notaría." },
  { icon: "card", t: "Contratos de honorarios", d: "Prestación de servicios profesionales: honorarios fijos, por etapas o cuota litis." },
  { icon: "users", t: "Sustituciones de poder", d: "Delegue la audiencia o el proceso en un colega y reasuma cuando quiera." },
  { icon: "file", t: "Pagarés", d: "Con carta de instrucciones, válidos para iniciar procesos ejecutivos." },
  { icon: "shield", t: "Acuerdos NDA", d: "Confidencialidad antes de recibir información sensible de su cliente." },
  { icon: "check", t: "Habeas Data", d: "Autorización de tratamiento de datos personales (Ley 1581 de 2012)." },
];

const RESPALDO: { icon: IconName; t: string; d: string }[] = [
  {
    icon: "eye",
    t: "Trazabilidad Estradox",
    d: "Cada paso queda en la bitácora con fecha, hora de Colombia e IP: envío, apertura, código verificado, lectura y firma.",
  },
  {
    icon: "shield",
    t: "Identidad con código OTP",
    d: "Solo firma quien recibe el código en su correo o WhatsApp. Es lo que vincula la firma con la persona (Decreto 2364 de 2012).",
  },
  {
    icon: "sello",
    t: "Huella SHA-256 y código QR",
    d: "Si al PDF le cambian una sola letra, la huella deja de coincidir. Cualquier juez lo comprueba escaneando el QR.",
  },
  {
    icon: "certificado",
    t: "Firma digital y estampado cronológico (TSA)",
    d: "El PDF final se sella con firma digital y estampa cronológica RFC 3161 de una entidad de certificación acreditada por la ONAC.",
  },
];

/** Página pública de presentación de la Firma Electrónica. */
export default async function FirmaElectronicaLanding() {
  const user = await getCurrentUser().catch(() => null);
  const cta = user ? "/dashboard/firmas" : "/register";

  return (
    <div className="landing">
      <header className="landing-nav">
        <Link prefetch={false} href="/" aria-label="Estradox">
          <BrandLogo />
        </Link>
        <nav>
          <a href="#como-funciona">Cómo funciona</a>
          <a href="#documentos">Documentos</a>
          <a href="#respaldo">Respaldo</a>
          <span className="landing-actual">
            Firma Electrónica <i className="nav-nuevo">Nuevo</i>
          </span>
        </nav>
        <Link prefetch={false} href={user ? "/dashboard" : "/login"} className="btn secondary small">
          {user ? "Ir a mi cuenta" : "Ingresar"}
        </Link>
      </header>

      <section className="cert-hero landing-hero">
        <span className="cert-pronto">Nuevo en Estradox</span>
        <h1>Firme poderes y contratos sin reunirse con su cliente</h1>
        <p>
          Su cliente firma desde el celular en minutos, con plena validez jurídica en Colombia: los poderes se confieren
          como mensaje de datos (<b>art. 5, Ley 2213 de 2022</b>) y la firma electrónica tiene los mismos efectos que la
          manuscrita (<b>Ley 527 de 1999</b> y <b>Decreto 2364 de 2012</b>).
        </p>
        <div className="row wrap" style={{ gap: 10, justifyContent: "center", marginTop: 20 }}>
          <Link prefetch={false} href={cta} className="btn btn-pulse">
            {user ? "Enviar un documento a firmar" : "Probar gratis"}
          </Link>
          <a href="#como-funciona" className="btn secondary">Ver cómo funciona</a>
        </div>
        <div className="cert-chips">
          {["Sin notaría", "Sin imprimir", "Desde el celular", "Certificado probatorio", "Verificable con QR"].map((t) => (
            <span key={t} className="cert-chip">
              <Icon name="check" size={14} /> {t}
            </span>
          ))}
        </div>
      </section>

      <section id="como-funciona">
        <h2 className="landing-titulo">Tres pasos y queda firmado</h2>
        <div className="cert-steps">
          {PASOS.map((s, i) => (
            <div key={s.t} className="cert-step">
              <div className="cert-step-n">{i + 1}</div>
              <div className="cert-step-icon">
                <Icon name={s.icon} size={22} />
              </div>
              <b>{s.t}</b>
              <p className="muted small">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="documentos">
        <h2 className="landing-titulo">Documentos que puede firmar</h2>
        <div className="landing-grid">
          {DOCUMENTOS.map((d) => (
            <div key={d.t} className="card landing-doc">
              <span className="cert-step-icon">
                <Icon name={d.icon} size={20} />
              </span>
              <div>
                <b>{d.t}</b>
                <p className="muted small">{d.d}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="muted small" style={{ textAlign: "center" }}>
          No aplica para lo que la ley exige por escritura pública: compraventa de inmuebles, hipotecas, poderes
          generales y testamentos.
        </p>
      </section>

      <section id="respaldo">
        <h2 className="landing-titulo">Respaldo técnico y probatorio</h2>
        <div className="landing-grid dos">
          {RESPALDO.map((d) => (
            <div key={d.t} className="card landing-doc">
              <span className="cert-step-icon">
                <Icon name={d.icon} size={20} />
              </span>
              <div>
                <b>{d.t}</b>
                <p className="muted small">{d.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="cert-hero landing-cierre">
        <h2>Empiece hoy: su próximo poder, firmado en minutos</h2>
        <Link prefetch={false} href={cta} className="btn" style={{ marginTop: 14 }}>
          {user ? "Ir a Firma Electrónica" : "Crear mi cuenta gratis"}
        </Link>
      </section>

      <footer className="firmar-pie muted small">
        Estradox · Firma electrónica conforme a la Ley 527 de 1999, el Decreto 2364 de 2012 y la Ley 2213 de 2022 ·{" "}
        <Link prefetch={false} href="/terminos">Términos</Link> · <Link prefetch={false} href="/privacidad">Privacidad</Link>
      </footer>
    </div>
  );
}
