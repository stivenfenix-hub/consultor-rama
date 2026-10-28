import { PanelWhatsapp } from "./panel";

export default function WhatsappAdmin() {
  return (
    <div className="page">
      <div className="page-head">
        <h1>WhatsApp</h1>
      </div>
      <p className="muted small" style={{ marginTop: -8, marginBottom: 16 }}>
        Dos WhatsApp de Estradox vinculados por QR, como WhatsApp Web. El servicio de WhatsApp
        envía solo, aunque no tengas esta página abierta: un mensaje cada 25 a 70 segundos, de
        8:00 a.m. a 8:00 p.m. y hasta el máximo diario de cada número.
      </p>
      <PanelWhatsapp />
    </div>
  );
}
