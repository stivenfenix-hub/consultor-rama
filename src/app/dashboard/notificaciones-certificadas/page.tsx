import { Icon } from "@/components/icon";

export const metadata = { title: "Notificaciones certificadas" };

const PLANTILLAS = [
  { titulo: "Notificación judicial", norma: "Art. 8, Ley 2213 de 2022" },
  { titulo: "Notificación personal", norma: "Art. 209, Ley 2452 de 2025 (CPT y SS)" },
  { titulo: "Traslado anticipado", norma: "Art. 6, Ley 2213 de 2022" },
  { titulo: "Citación a audiencia de conciliación", norma: "" },
  { titulo: "Correo de redacción libre", norma: "" },
];

const PASOS = [
  {
    t: "Eliges la plantilla y redactas",
    d: "Estradox te guía con el texto según la norma. Adjuntas la demanda, el auto o los anexos.",
  },
  {
    t: "Se envía por correo o WhatsApp certificado",
    d: "El mensaje sale con estampado cronológico y firma digital, que prueban qué se envió y cuándo.",
  },
  {
    t: "Recibes el acuse y el certificado",
    d: "Queda registro de entrega, apertura y lectura. Descargas el certificado en PDF para anexarlo al expediente.",
  },
];

export default function NotificacionesCertificadas() {
  return (
    <div className="page">
      <div className="page-head">
        <h1>
          Notificaciones certificadas <span className="badge reciente">Próximamente</span>
        </h1>
      </div>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Notifica desde Estradox, con validez probatoria</h2>
        <p>
          Muy pronto podrás enviar notificaciones judiciales por <b>correo electrónico certificado</b> y{" "}
          <b>WhatsApp certificado</b> sin salir de Estradox, con constancia de envío, entrega y lectura
          lista para anexar al proceso.
        </p>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Funcionará con el respaldo de <b>Olimpia IT</b> (olimpiait.com), entidad de certificación digital
          acreditada en Colombia. Solo las entidades acreditadas pueden poner el <b>estampado cronológico</b>{" "}
          y la <b>firma digital</b> que le dan validez jurídica a cada envío.
        </p>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Cómo va a funcionar</h2>
        <ol style={{ paddingLeft: 20, margin: 0, display: "grid", gap: 10 }}>
          {PASOS.map((p) => (
            <li key={p.t}>
              <b>{p.t}.</b> <span className="muted">{p.d}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Plantillas que tendrás</h2>
        <div style={{ display: "grid", gap: 8 }}>
          {PLANTILLAS.map((p) => (
            <div key={p.titulo} className="row" style={{ gap: 10, alignItems: "center" }}>
              <Icon name="certificado" size={18} />
              <div>
                <div>{p.titulo}</div>
                {p.norma && <div className="muted small">{p.norma}</div>}
              </div>
            </div>
          ))}
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Te avisaremos por la campana y por correo apenas esté disponible.
        </p>
      </section>
    </div>
  );
}
