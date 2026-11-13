"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { estadoCargaAction } from "@/app/actions";
import { Icon } from "./icon";
import { separarEstados, separarSegundoPlano } from "@/lib/textos-estados";

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
    // Una consulta a la vez y solo con la pestaña visible: no se acumulan y
    // no hacen esperar la navegación.
    let enCurso = false;
    const t = setInterval(async () => {
      if (enCurso || document.visibilityState !== "visible") return;
      enCurso = true;
      const c = await estadoCargaAction(carga.id).catch(() => null);
      enCurso = false;
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

  // Nunca se muestra una falla de la Rama: lo que no cargó se sigue cargando solo.
  const bien = !!carga.ok;
  const { radicados: enEstados, resto: r1 } = separarEstados(carga.error);
  const { radicados: enProceso, resto: errorPropio } = separarSegundoPlano(r1);
  const [titulo, texto] = bien
    ? ["¡Tus procesos ya están cargados!", "Ya puedes revisarlos."]
    : errorPropio
      ? ["Revisa tus radicados", "Algunos números no son válidos. Míralos en Procesos."]
      : enProceso.length
        ? ["Estamos terminando de cargar tus procesos", "En unos momentos te notificamos cuando estén listos."]
        : enEstados.length
          ? ["Lo vigilamos con Publicaciones Procesales", "Revisamos las publicaciones del juzgado y te avisamos."]
          : ["Estamos terminando de cargar tus procesos", "En unos momentos te notificamos cuando estén listos."];
  return (
    <div className={`carga-toast ${bien ? "listo" : errorPropio ? "falla" : "listo"}`} role="status">
      <Icon name={bien ? "check" : errorPropio ? "alert" : "bell"} size={22} />
      <div className="carga-toast-texto">
        <b>{titulo}</b>
        <span className="small">{texto}</span>
      </div>
      <Link prefetch={false} href="/dashboard/procesos" className="btn small" onClick={cerrar}>
        Ver procesos
      </Link>
      <button className="carga-toast-x" onClick={cerrar} aria-label="Cerrar">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
