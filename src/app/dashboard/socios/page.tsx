import Link from "next/link";
import { redirect } from "next/navigation";
import { usuarioSocio } from "@/lib/socios-acceso";
import { listaSocios } from "@/lib/subscription";
import {
  CARPETA_ARCHIVOS,
  iaConfigurada,
  listarMovimientos,
  resumenSociedad,
  TIPOS,
  type TipoMov,
} from "@/lib/socios";
import { driveDisponible, estadoDrive } from "@/lib/drive";
import { usuariosRegistrados } from "@/lib/admin";
import { StatTile } from "@/components/charts";
import { Paginador, POR_PAGINA, paginaDe } from "@/components/paginador";
import { BorrarMovimiento, FormMovimiento, RefrescoMientrasLee, SubirComprobantes } from "./piezas";

const pesos = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString("es-CO")}`;
const fecha = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : "—";
const iso = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

/** Portal socios: lo que ha puesto cada socio en Estradox, ingresos y balance 50/50. */
export default async function PortalSocios({
  searchParams,
}: {
  searchParams: Promise<{ pagina?: string; drive?: string }>;
}) {
  const user = await usuarioSocio();
  if (!user) redirect("/dashboard");
  const esRoot = user.role === "admin";
  const sp = await searchParams;

  const [resumen, socios, drive, usuarios] = await Promise.all([
    resumenSociedad(),
    listaSocios(),
    estadoDrive(),
    usuariosRegistrados(),
  ]);
  const { total } = await listarMovimientos(0, 0);
  const pag = paginaDe(sp.pagina, total);
  const { movimientos } = await listarMovimientos(pag.desde, POR_PAGINA);
  const leyendo = movimientos.some((m) => m.estado === "procesando");
  const listaSoc = socios.map((s) => ({ id: s.id, nombre: s.nombre }));

  return (
    <div className="page">
      <RefrescoMientrasLee activo={leyendo} />
      <div className="page-head">
        <div>
          <h1>Portal socios</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Contabilidad de la sociedad: lo que cada socio ha invertido en Estradox, lo que ha entrado y el balance
            50/50. Solo lo ve el root y los socios.
          </p>
        </div>
      </div>

      {sp.drive === "ok" && <div className="ok" style={{ marginBottom: 12 }}>Google Drive conectado.</div>}
      {sp.drive === "error" && (
        <div className="error" style={{ marginBottom: 12 }}>No se pudo conectar Google Drive. Intenta de nuevo.</div>
      )}

      <section className="stat-grid">
        <StatTile
          label="Usuarios registrados"
          value={usuarios.total.toLocaleString("es-CO")}
          hint={`${usuarios.nuevosMes} nuevos este mes`}
        />
        <StatTile label="Total invertido" value={pesos(resumen.invertido)} />
        {/* Ingresos y ganancia / por recuperar: solo los ve el root, no los socios. */}
        {esRoot && (
          <>
            <StatTile label="Ingresos (Bold + otros)" value={pesos(resumen.ingresos)} accent="var(--green)" />
            <StatTile
              label={resumen.resultado >= 0 ? "Ganancia" : "Por recuperar"}
              value={pesos(Math.abs(resumen.resultado))}
              accent={resumen.resultado >= 0 ? "var(--green)" : "var(--amber)"}
            />
          </>
        )}
        <StatTile label="Por revisar" value={resumen.porRevisar} />
      </section>

      <div className="card">
        <h2>Cuánto ha puesto cada socio</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Socio</th>
                <th>Gastos pagados</th>
                <th>Aportes</th>
                <th>Total invertido</th>
                <th>% del total</th>
                <th>Le corresponde (50%)</th>
                <th>Pagos entre socios</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {resumen.porSocio.map((s) => (
                <tr key={s.id}>
                  <td>{s.nombre}</td>
                  <td>{pesos(s.gastos)}</td>
                  <td>{pesos(s.aportes)}</td>
                  <td>
                    <b>{pesos(s.invertido)}</b>
                  </td>
                  <td>{resumen.invertido ? `${Math.round((s.invertido / resumen.invertido) * 100)}%` : "—"}</td>
                  <td>{pesos(s.parte)}</td>
                  <td className="small">
                    {s.liquidado === 0 ? "—" : s.liquidado > 0 ? `Pagó ${pesos(s.liquidado)}` : `Recibió ${pesos(-s.liquidado)}`}
                  </td>
                  <td className="small">
                    {s.diferencia === 0
                      ? "Parejo"
                      : s.diferencia > 0
                        ? `Ha puesto ${pesos(s.diferencia)} más que su parte`
                        : `Ha puesto ${pesos(-s.diferencia)} menos que su parte`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {resumen.transferencias.length > 0 ? (
          <div className="small" style={{ marginTop: 10 }}>
            <b>Para quedar 50/50:</b>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {resumen.transferencias.map((t, i) => (
                <li key={i}>
                  {t.de} le transfiere <b>{pesos(t.valor)}</b> a {t.a}
                  {resumen.porSocio.length === 2 && (
                    <span className="muted"> — o {t.de} paga {pesos(resumen.brecha)} en gastos de Estradox</span>
                  )}
                  .
                </li>
              ))}
            </ul>
          </div>
        ) : (
          resumen.invertido > 0 && <div className="small" style={{ marginTop: 10 }}>✓ Están parejos: cada uno ha puesto su 50%.</div>
        )}
        <p className="muted small" style={{ marginBottom: 0 }}>
          {esRoot && (
            <>
              Ingresos de la plataforma (pagos aprobados en Bold): {pesos(resumen.ingresosBold)}
              {resumen.ingresosManuales ? ` · otros ingresos registrados: ${pesos(resumen.ingresosManuales)}` : ""}.{" "}
            </>
          )}
          Solo suman los movimientos confirmados.
        </p>
      </div>

      <div className="card">
        <h2>Subir comprobantes</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Transferencias, tiquetes, facturas, pagos de servicios… La IA lee el valor, la fecha, a quién se pagó y el
          concepto; tú lo revisas y lo confirmas. El archivo queda guardado en Google Drive.
        </p>
        {!iaConfigurada() && (
          <div className="aviso-rama small" style={{ marginBottom: 10 }}>
            ℹ️ La lectura con IA aún no está activa (falta la llave de Gemini en el servidor). Puedes subir el
            comprobante igual y llenar los datos a mano.
          </div>
        )}
        <SubirComprobantes socios={listaSoc} esRoot={esRoot} yo={user.id} />
        <details style={{ marginTop: 14 }}>
          <summary className="small">Agregar un movimiento sin comprobante (efectivo, etc.)</summary>
          <FormMovimiento
            datos={{ tipo: "gasto", fecha: "", monto: null, concepto: "", proveedor: "", medio: "", socioId: user.id }}
            socios={listaSoc}
            esRoot={esRoot}
            boton="Agregar movimiento"
          />
        </details>
      </div>

      <div className="card">
        <h2>Movimientos ({total})</h2>
        {movimientos.length === 0 && <p className="muted small">Todavía no hay movimientos.</p>}
        {movimientos.map((m) => {
          const propio = esRoot || m.socioId === user.id;
          return (
            <div key={m.id} className="case" style={{ cursor: "default" }}>
              <div className="row wrap">
                <b>{m.monto != null ? pesos(m.monto) : "Sin valor"}</b>
                <span className="badge">{TIPOS[m.tipo as TipoMov] ?? m.tipo}</span>
                {m.estado === "procesando" && <span className="badge reciente">leyendo con IA…</span>}
                {m.estado === "revisar" && <span className="badge warn">por revisar</span>}
                {m.estado === "confirmado" && <span className="badge new">confirmado</span>}
                <div className="spacer" />
                <span className="muted small">
                  {fecha(m.fecha)} · {m.socio}
                </span>
              </div>
              <div className="small" style={{ marginTop: 4 }}>
                {m.tipo === "liquidacion" && m.receptor && <b>Pagado a {m.receptor} · </b>}
                {m.concepto ?? m.archivoNombre ?? "—"}
                {m.proveedor ? ` · ${m.proveedor}` : ""}
                {m.medio ? ` · ${m.medio}` : ""}
                {m.referencia ? ` · Ref. ${m.referencia}` : ""}
              </div>
              {m.nota && <div className="muted small">Nota: {m.nota}</div>}
              {m.iaError && (
                <div className="muted small">La IA no pudo leerlo ({m.iaError.slice(0, 120)}); llena los datos a mano.</div>
              )}
              <div className="row wrap" style={{ gap: 8, marginTop: 6 }}>
                {(m.tieneArchivo || m.driveUrl) && (
                  <a className="btn secondary small" href={`/api/socios/archivo/${m.id}`} target="_blank" rel="noopener noreferrer">
                    Ver comprobante
                  </a>
                )}
                {m.driveUrl ? (
                  <span className="muted small">✓ En Drive</span>
                ) : m.tieneArchivo ? (
                  <span className="muted small">{m.driveError ? "Drive falló; se reintenta" : "Pendiente de subir a Drive"}</span>
                ) : null}
                {propio && m.estado !== "procesando" && <BorrarMovimiento id={m.id} />}
              </div>
              {propio && m.estado !== "procesando" && (
                <details open={m.estado === "revisar"} style={{ marginTop: 6 }}>
                  <summary className="small">{m.estado === "revisar" ? "Revisar y confirmar" : "Editar"}</summary>
                  <FormMovimiento
                    datos={{
                      id: m.id,
                      tipo: m.tipo,
                      fecha: iso(m.fecha),
                      monto: m.monto,
                      concepto: m.concepto ?? "",
                      proveedor: m.proveedor ?? "",
                      medio: m.medio ?? "",
                      socioId: m.socioId,
                      receptorId: m.receptorId,
                    }}
                    socios={listaSoc}
                    esRoot={esRoot}
                    boton={m.estado === "revisar" ? "Confirmar" : "Guardar cambios"}
                  />
                </details>
              )}
            </div>
          );
        })}
        <Paginador
          pagina={pag.pagina}
          paginas={pag.paginas}
          hrefDe={(p) => `/dashboard/socios${p > 1 ? `?pagina=${p}` : ""}`}
        />
      </div>

      {esRoot && (
        <div className="card">
          <h2>Google Drive</h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            Los archivos no se guardan en la base de datos: esperan en el servidor ({CARPETA_ARCHIVOS}; la app está
            en {process.cwd()}) hasta subirlos a Drive, y ahí se borran del servidor.
          </p>
          {!driveDisponible() ? (
            <p className="muted small">Falta configurar Google (GOOGLE_CLIENT_ID) en el servidor.</p>
          ) : drive.conectado ? (
            <p className="small" style={{ margin: 0 }}>
              Conectado{drive.cuenta ? ` con ${drive.cuenta}` : ""}. Los comprobantes van a la carpeta{" "}
              <b>Estradox - Socios</b>.{" "}
              <Link href="/api/socios/drive/conectar" prefetch={false}>Cambiar cuenta</Link>
            </p>
          ) : (
            <>
              <p className="muted small" style={{ marginTop: 0 }}>
                Conecta tu Google Drive para guardar ahí los comprobantes (carpeta &quot;Estradox - Socios&quot;). Mientras
                no esté conectado, quedan guardados en Estradox y se suben solos al conectarlo.
              </p>
              <a className="btn" href="/api/socios/drive/conectar">Conectar Google Drive</a>
            </>
          )}
        </div>
      )}
    </div>
  );
}
