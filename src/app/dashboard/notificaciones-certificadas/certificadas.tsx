"use client";

import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/icon";

const CHIPS: { icon: IconName; t: string }[] = [
  { icon: "mail", t: "Correo certificado" },
  { icon: "chat", t: "WhatsApp certificado" },
  { icon: "clock", t: "Estampado cronológico" },
  { icon: "firma", t: "Firma digital" },
  { icon: "file", t: "Certificado en PDF" },
];

// Recorrido de un envío (demostración animada).
const ETAPAS: { icon: IconName; t: string; hora: string }[] = [
  { icon: "send", t: "Enviado", hora: "9:02:14 a. m." },
  { icon: "check", t: "Entregado", hora: "9:02:16 a. m." },
  { icon: "eye", t: "Leído", hora: "10:47:03 a. m." },
  { icon: "sello", t: "Certificado", hora: "10:47:05 a. m." },
];

const PASOS: { icon: IconName; t: string; d: string }[] = [
  {
    icon: "firma",
    t: "Eliges la plantilla y redactas",
    d: "Estradox te guía con el texto según la norma. Adjuntas la demanda, el auto o los anexos.",
  },
  {
    icon: "send",
    t: "Se envía certificado",
    d: "Por correo o WhatsApp, con estampado cronológico y firma digital que prueban qué se envió y cuándo.",
  },
  {
    icon: "sello",
    t: "Recibes acuse y certificado",
    d: "Registro de entrega, apertura y lectura. Descargas el certificado en PDF para el expediente.",
  },
];

const PLANTILLAS: { icon: IconName; t: string; norma: string; d: string }[] = [
  {
    icon: "scale",
    t: "Notificación judicial",
    norma: "Art. 8, Ley 2213 de 2022",
    d: "Notifica la providencia al demandado por mensaje de datos. Se entiende surtida dos días hábiles después de que el sistema confirma el recibo.",
  },
  {
    icon: "users",
    t: "Notificación personal",
    norma: "Art. 209, Ley 2452 de 2025 (CPT y SS)",
    d: "Para procesos laborales y de seguridad social: notifica personalmente al demandado con constancia de entrega.",
  },
  {
    icon: "file",
    t: "Traslado anticipado",
    norma: "Art. 6, Ley 2213 de 2022",
    d: "Envía la demanda y sus anexos al demandado al mismo tiempo que la radicas, como exige la norma.",
  },
  {
    icon: "clock",
    t: "Citación a conciliación",
    norma: "Audiencia de conciliación",
    d: "Cita a las partes a la audiencia de conciliación con prueba de que recibieron la citación.",
  },
  {
    icon: "mail",
    t: "Redacción libre",
    norma: "Correo certificado",
    d: "Cualquier comunicación que necesites probar: requerimientos, derechos de petición, avisos.",
  },
];

export function Certificadas() {
  const [etapa, setEtapa] = useState(0);
  const [plantilla, setPlantilla] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setEtapa((e) => (e + 1) % (ETAPAS.length + 1)), 1400);
    return () => clearInterval(t);
  }, []);

  const p = PLANTILLAS[plantilla];

  return (
    <>
      <section className="cert-hero">
        <div className="cert-hero-icon">
          <Icon name="certificado" size={34} />
        </div>
        <span className="cert-pronto">Próximamente</span>
        <h1>Notificaciones certificadas</h1>
        <p>
          Notifica desde Estradox por correo y WhatsApp, con <b>validez probatoria</b> y constancia de
          envío, entrega y lectura lista para anexar al proceso.
        </p>
        <div className="cert-chips">
          {CHIPS.map((c) => (
            <span key={c.t} className="cert-chip">
              <Icon name={c.icon} size={15} /> {c.t}
            </span>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Así verás cada envío</h2>
        <div className="cert-track">
          {ETAPAS.map((e, i) => {
            const hecho = i < etapa;
            return (
              <div key={e.t} className={`cert-stage ${hecho ? "on" : ""} ${i === etapa - 1 ? "now" : ""}`}>
                <div className="cert-dot">
                  <Icon name={e.icon} size={18} />
                </div>
                <div className="cert-stage-t">{e.t}</div>
                <div className="cert-stage-h">{hecho ? e.hora : "—"}</div>
              </div>
            );
          })}
          <div className="cert-line">
            <div className="cert-line-fill" style={{ width: `${(Math.max(etapa - 1, 0) / (ETAPAS.length - 1)) * 100}%` }} />
          </div>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Cada etapa queda con hora exacta (estampado cronológico) y el certificado final va firmado digitalmente.
        </p>
      </section>

      <section className="cert-steps">
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
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Plantillas que tendrás</h2>
        <p className="muted small" style={{ marginTop: 0 }}>Toca una para ver para qué sirve.</p>
        <div className="cert-plantillas">
          {PLANTILLAS.map((x, i) => (
            <button
              key={x.t}
              type="button"
              className={`cert-plantilla ${i === plantilla ? "sel" : ""}`}
              onClick={() => setPlantilla(i)}
            >
              <Icon name={x.icon} size={20} />
              <span>{x.t}</span>
            </button>
          ))}
        </div>
        <div className="cert-detalle" key={plantilla}>
          <div className="cert-detalle-icon">
            <Icon name={p.icon} size={22} />
          </div>
          <div>
            <b>{p.t}</b>
            <div className="cert-norma">{p.norma}</div>
            <p className="small" style={{ margin: "6px 0 0" }}>{p.d}</p>
          </div>
        </div>
      </section>

      <section className="card cert-respaldo">
        <div className="cert-respaldo-icon">
          <Icon name="shield" size={26} />
        </div>
        <div>
          <b>Con el respaldo de Olimpia IT</b>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            Funcionará bajo la firma de <b>Olimpia IT</b> (olimpiait.com), entidad de certificación digital
            acreditada en Colombia. Solo las entidades acreditadas pueden poner el <b>estampado cronológico</b>{" "}
            y la <b>firma digital</b> que le dan validez jurídica a cada envío.
          </p>
        </div>
      </section>

      <p className="muted small" style={{ textAlign: "center" }}>
        <Icon name="bell" size={14} /> Te avisaremos por la campana y por correo apenas esté disponible.
      </p>
    </>
  );
}
