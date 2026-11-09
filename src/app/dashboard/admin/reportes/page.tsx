import { fechaBogotaHace, filasSinProcesosDelDia } from "@/lib/reporte-whatsapp";
import { EnviarWhatsapp } from "./enviar-whatsapp";

function fechaLarga(f: string) {
  const t = new Date(`${f}T12:00:00-05:00`).toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Bogota",
  });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default async function ReportesAdmin({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string }>;
}) {
  const { fecha: f } = await searchParams;
  // Últimos 7 días (ayer primero); la fecha de la notificación queda resaltada.
  const dias = Array.from({ length: 7 }, (_, i) => fechaBogotaHace(i + 1));
  const conteos = await Promise.all(
    dias.map(async (d) => ({ fecha: d, n: (await filasSinProcesosDelDia(d)).length })),
  );

  return (
    <div className="page">
      <div className="page-head">
        <h1>Reportes</h1>
      </div>
      <div className="card">
        <h2>Registrados sin procesos</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Quienes se registraron ese día y no han ingresado ningún radicado. Cada mañana a las
          7:20 a.m. los del día anterior se envían solos por WhatsApp y te llega la notificación.
          Esta misma lista es la del Excel (A: mensaje, B: teléfono).
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Día de registro</th>
                <th>Sin procesos</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {conteos.map((c) => (
                <tr key={c.fecha} style={c.fecha === f ? { background: "rgba(139, 61, 255, 0.1)" } : undefined}>
                  <td>{fechaLarga(c.fecha)}</td>
                  <td>{c.n}</td>
                  <td>
                    {c.n > 0 ? (
                      <div className="row wrap" style={{ gap: 8 }}>
                        <a className="btn small" href={`/api/admin/reporte-sin-procesos?fecha=${c.fecha}`} download>
                          Descargar Excel
                        </a>
                        <EnviarWhatsapp fecha={c.fecha} n={c.n} />
                      </div>
                    ) : (
                      <span className="muted small">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
