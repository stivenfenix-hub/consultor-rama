import Link from "next/link";
import { redirect } from "next/navigation";
import { usuarioSocio } from "@/lib/socios-acceso";
import { vencimientosDePrueba } from "@/lib/subscription";
import { Paginador, POR_PAGINA, paginaDe } from "@/components/paginador";

const fecha = (d: Date) =>
  new Date(d).toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "numeric", timeZone: "America/Bogota" });

/** Portal socios → Usuarios: solo el nombre y cuándo les vence la prueba gratis. */
export default async function UsuariosSocios({ searchParams }: { searchParams: Promise<{ pagina?: string }> }) {
  const user = await usuarioSocio();
  if (!user) redirect("/dashboard");
  const sp = await searchParams;

  const todos = await vencimientosDePrueba();
  const pag = paginaDe(sp.pagina, todos.length);
  const lista = todos.slice(pag.desde, pag.desde + POR_PAGINA);
  const ahora = Date.now();

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Usuarios</h1>
          <p className="muted small" style={{ margin: 0 }}>
            {todos.length.toLocaleString("es-CO")} usuario(s). Arriba los que siguen en prueba (el que vence antes
            primero) y después los que ya vencieron.
          </p>
        </div>
        <Link prefetch={false} href="/dashboard/socios" className="btn secondary">
          ← Portal socios
        </Link>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Vence la prueba</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((u) => {
                const vencida = u.vence.getTime() <= ahora;
                return (
                  <tr key={u.id}>
                    <td>{u.nombre}</td>
                    <td className={vencida ? "muted" : undefined}>
                      {fecha(u.vence)}
                      {vencida && " (vencida)"}
                    </td>
                  </tr>
                );
              })}
              {lista.length === 0 && (
                <tr>
                  <td colSpan={2} className="muted">
                    Aún no hay usuarios.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Paginador
          pagina={pag.pagina}
          paginas={pag.paginas}
          hrefDe={(p) => `/dashboard/socios/usuarios${p > 1 ? `?pagina=${p}` : ""}`}
        />
      </div>
    </div>
  );
}
