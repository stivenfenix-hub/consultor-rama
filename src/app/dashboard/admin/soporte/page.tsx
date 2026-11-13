import Link from "next/link";
import { casosSoporte, conteosSoporte, type EstadoSoporte } from "@/lib/soporte";
import { Paginador, paginaDe, POR_PAGINA } from "@/components/paginador";
import { FilaCaso } from "../../soporte/piezas";

export const dynamic = "force-dynamic";

type Filtro = EstadoSoporte | "todos" | "sinLeer";
const FILTROS: { id: Filtro; label: string; n: (c: Awaited<ReturnType<typeof conteosSoporte>>) => number }[] = [
  { id: "abierto", label: "Por responder", n: (c) => c.abiertos },
  { id: "sinLeer", label: "Sin leer", n: (c) => c.sinLeer },
  { id: "respondido", label: "Respondidos", n: (c) => c.respondidos },
  { id: "cerrado", label: "Resueltos", n: (c) => c.cerrados },
  { id: "todos", label: "Todos", n: (c) => c.todos },
];

export default async function AdminSoportePage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; pagina?: string }>;
}) {
  const sp = await searchParams;
  const filtro: Filtro = FILTROS.some((f) => f.id === sp.f) ? (sp.f as Filtro) : "abierto";
  const conteos = await conteosSoporte();
  const total = FILTROS.find((f) => f.id === filtro)!.n(conteos);
  const pag = paginaDe(sp.pagina, total);
  const { casos } = await casosSoporte(filtro, pag.desde, POR_PAGINA);
  const href = (f: Filtro, p = 1) => `/dashboard/admin/soporte?f=${f}${p > 1 ? `&pagina=${p}` : ""}`;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Soporte y PQRS</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Mensajes de los abogados. Al responder, les llega notificación y correo, y el caso pasa a «Respondido».
          </p>
        </div>
      </div>

      <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
        {FILTROS.map((f) => (
          <Link
            prefetch={false}
            key={f.id}
            href={href(f.id)}
            className={`btn small ${filtro === f.id ? "" : "secondary"}`}
          >
            {f.label} ({f.n(conteos)})
          </Link>
        ))}
      </div>

      <div className="card">
        {casos.length === 0 ? (
          <p className="muted small">No hay mensajes en esta lista.</p>
        ) : (
          casos.map((c) => <FilaCaso key={c.id} c={c} href={`/dashboard/admin/soporte/${c.id}`} lado="soporte" />)
        )}
        <Paginador pagina={pag.pagina} paginas={pag.paginas} hrefDe={(p) => href(filtro, p)} />
      </div>
    </div>
  );
}
