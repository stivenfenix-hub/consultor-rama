"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  contarAvisosAction,
  listarAvisosAction,
  marcarAvisoLeidoAction,
  marcarTodosLeidosAction,
} from "@/app/actions";
import type { AvisoApp } from "@/lib/push";
import { Icon } from "./icon";

function hace(fecha: Date | string) {
  const min = Math.max(0, Math.round((Date.now() - new Date(fecha).getTime()) / 60_000));
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `hace ${d} día${d === 1 ? "" : "s"}`;
  return new Date(fecha).toLocaleDateString("es-CO", { day: "numeric", month: "short", timeZone: "America/Bogota" });
}

/**
 * Campana de notificaciones (arriba a la derecha): contador de no leídas y
 * panel con los últimos avisos. Cada aviso queda leído al tocarlo, al entrar a
 * su página por otro lado o (actuaciones) al ver esas actuaciones.
 */
export function NotificationBell() {
  const [n, setN] = useState(0);
  const [open, setOpen] = useState(false);
  const [avisos, setAvisos] = useState<AvisoApp[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const contar = useCallback(() => {
    contarAvisosAction().then(setN).catch(() => {});
  }, []);

  // Al abrir una página: sus avisos quedan leídos y se recuenta. Si llegó
  // tocando una notificación push (?aviso=id), ese aviso queda leído.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const avisoId = Number(params.get("aviso"));
    if (avisoId) {
      params.delete("aviso");
      const q = params.toString();
      window.history.replaceState(window.history.state, "", `${pathname}${q ? `?${q}` : ""}`);
    }
    (avisoId ? marcarAvisoLeidoAction(avisoId) : Promise.resolve())
      .then(() => contarAvisosAction(pathname))
      .then(setN)
      .catch(() => {});
  }, [pathname]);
  // Cada minuto y al volver a la pestaña.
  useEffect(() => {
    const t = setInterval(contar, 60_000);
    const vis = () => document.visibilityState === "visible" && contar();
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [contar]);

  // Cerrar al tocar fuera o con Escape.
  useEffect(() => {
    if (!open) return;
    const fuera = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const abrir = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    setAvisos(null);
    setAvisos(await listarAvisosAction().catch(() => []));
  };

  const leer = (a: AvisoApp) => {
    setOpen(false);
    if (a.leido) return;
    setAvisos((l) => l?.map((x) => (x.id === a.id ? { ...x, leido: true } : x)) ?? l);
    setN((v) => Math.max(0, v - 1));
    void marcarAvisoLeidoAction(a.id).then(contar);
  };

  const leerTodas = () => {
    setAvisos((l) => l?.map((x) => ({ ...x, leido: true })) ?? l);
    setN(0);
    void marcarTodosLeidosAction().then(contar);
  };

  return (
    <div className="bell-wrap" ref={ref}>
      <button
        className="bell-btn"
        onClick={abrir}
        aria-label={n > 0 ? `Notificaciones: ${n} sin leer` : "Notificaciones"}
        aria-expanded={open}
      >
        <Icon name="bell" size={21} />
        {n > 0 && <span className="bell-count">{n > 99 ? "99+" : n}</span>}
      </button>

      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notificaciones">
          <div className="bell-head">
            <span>Notificaciones</span>
            {avisos?.some((a) => !a.leido) && (
              <button className="bell-all" onClick={leerTodas}>
                Marcar todas como leídas
              </button>
            )}
          </div>
          <div className="bell-list">
            {avisos === null && <div className="bell-empty muted small">Cargando…</div>}
            {avisos?.length === 0 && (
              <div className="bell-empty muted small">
                Aún no tienes notificaciones. Aquí verás las actuaciones nuevas de tus procesos y
                los avisos de tu cuenta.
              </div>
            )}
            {avisos?.map((a) => {
              const contenido = (
                <>
                  {!a.leido && <span className="bell-dot" aria-label="nueva" />}
                  <div style={{ minWidth: 0 }}>
                    <div className="bell-title">{a.title}</div>
                    <div className="bell-body">{a.body}</div>
                    <div className="bell-time">{hace(a.createdAt)}</div>
                  </div>
                </>
              );
              return a.url ? (
                <Link
                  key={a.id}
                  href={a.url}
                  className={`bell-item ${a.leido ? "" : "unread"}`}
                  onClick={() => leer(a)}
                >
                  {contenido}
                </Link>
              ) : (
                <button
                  key={a.id}
                  className={`bell-item ${a.leido ? "" : "unread"}`}
                  onClick={() => leer(a)}
                >
                  {contenido}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
