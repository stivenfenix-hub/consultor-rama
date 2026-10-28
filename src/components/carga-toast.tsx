"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { estadoCargaAction } from "@/app/actions";
import { Icon } from "./icon";

type Carga = { id: number; estado: "cargando" | "listo"; ok: string | null; error: string | null };

const visto = (id: number) => `estradox_toast_carga_${id}`;

/**
 * Solo escritorio (el celular ya recibe la notificación): si el abogado está
 * en otra parte de la plataforma cuando terminan de cargar sus procesos, le
 * sale arriba un aviso flotante. Solo consulta mientras hay una carga en curso.
 */
export function CargaToast({ inicial }: { inicial: Carga | null }) {
  const pathname = usePathname();
  const [carga, setCarga] = useState<Carga | null>(inicial);
  const [cerrado, setCerrado] = useState(false);
  // Hasta leer localStorage (solo en el navegador) se asume ya visto.
  const [yaVisto, setYaVisto] = useState(true);

  useEffect(() => setCarga(inicial), [inicial]);

  useEffect(() => {
    if (!carga) return;
    try {
      setYaVisto(!!localStorage.getItem(visto(carga.id)));
    } catch {
      setYaVisto(false);
    }
  }, [carga]);

  useEffect(() => {
    if (!carga || carga.estado !== "cargando") return;
    const t = setInterval(async () => {
      const c = await estadoCargaAction(carga.id).catch(() => null);
      if (c && c.estado !== "cargando") setCarga(c);
    }, 6_000);
    return () => clearInterval(t);
  }, [carga]);

  if (!carga || carga.estado !== "listo" || cerrado || yaVisto) return null;
  // En Procesos ya se ve el resultado; y cada aviso sale una sola vez.
  if (pathname.startsWith("/dashboard/procesos")) return null;

  const cerrar = () => {
    try {
      localStorage.setItem(visto(carga.id), "1");
    } catch {
      // ignore
    }
    setCerrado(true);
  };

  const bien = !!carga.ok;
  return (
    <div className={`carga-toast ${bien ? "listo" : "falla"}`} role="status">
      <Icon name={bien ? "check" : "alert"} size={22} />
      <div className="carga-toast-texto">
        <b>{bien ? "¡Tus procesos ya están cargados!" : "Aún no pudimos cargar tus procesos"}</b>
        <span className="small">
          {bien ? "Ya puedes revisarlos." : "La Rama no respondió; lo seguimos intentando solos."}
        </span>
      </div>
      <Link href="/dashboard/procesos" className="btn small" onClick={cerrar}>
        Ver procesos
      </Link>
      <button className="carga-toast-x" onClick={cerrar} aria-label="Cerrar">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
