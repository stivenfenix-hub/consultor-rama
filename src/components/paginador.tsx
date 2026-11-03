import Link from "next/link";

/** Listas largas de a 20: se pide al servidor solo la página que se ve. */
export const POR_PAGINA = 20;

/** Página pedida en la URL (?pagina=N), dentro de 1..paginas. */
export function paginaDe(valor: string | undefined, total: number, porPagina = POR_PAGINA) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const pagina = Math.min(paginas, Math.max(1, Number(valor) || 1));
  return { pagina, paginas, desde: (pagina - 1) * porPagina };
}

/** "← Anterior · Página X de Y · Siguiente →" (no se muestra si cabe en una página). */
export function Paginador({
  pagina,
  paginas,
  hrefDe,
}: {
  pagina: number;
  paginas: number;
  hrefDe: (p: number) => string;
}) {
  if (paginas <= 1) return null;
  const boton = (p: number, texto: string, activo: boolean) =>
    activo ? (
      <Link className="btn secondary small" href={hrefDe(p)} scroll={false}>
        {texto}
      </Link>
    ) : (
      <span className="btn secondary small" aria-disabled style={{ opacity: 0.4 }}>
        {texto}
      </span>
    );
  return (
    <nav
      className="row wrap"
      aria-label="Paginación"
      style={{ gap: 8, margin: "12px 0", justifyContent: "center", alignItems: "center" }}
    >
      {boton(pagina - 1, "← Anterior", pagina > 1)}
      <span className="muted small">
        Página {pagina} de {paginas}
      </span>
      {boton(pagina + 1, "Siguiente →", pagina < paginas)}
    </nav>
  );
}
