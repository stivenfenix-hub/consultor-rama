"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Barra de progreso arriba de la pantalla desde el instante del clic en un
 * enlace interno hasta que llega la nueva página (complementa loading.tsx,
 * que tarda unos cientos de ms en aparecer).
 */
export function NavProgress() {
  const pathname = usePathname();
  const [activo, setActivo] = useState(false);

  useEffect(() => setActivo(false), [pathname]);

  useEffect(() => {
    // En fase de captura: <Link> cancela el clic nativo (preventDefault) antes de que llegue a document.
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      setActivo(true);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Por si la navegación no ocurre (error, enlace cancelado): se apaga sola.
  useEffect(() => {
    if (!activo) return;
    const t = setTimeout(() => setActivo(false), 15_000);
    return () => clearTimeout(t);
  }, [activo]);

  return activo ? <div className="carga-pagina" aria-hidden /> : null;
}
