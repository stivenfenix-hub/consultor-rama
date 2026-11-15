"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { enviarWaSinRadicadosAction } from "@/app/actions";

type Fila = {
  id: string;
  nombre: string;
  email: string;
  telefono: string;
  registro: string;
  intentoCarga: boolean;
  ultimoWa: string | null;
};

const DIA = 24 * 60 * 60 * 1000;
const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "America/Bogota",
  });

/** Lista con casillas + mensaje editable + envío (pide confirmar). */
export function EnviarSinRadicados({
  usuarios,
  plantilla,
  maxDia,
}: {
  usuarios: Fila[];
  plantilla: string;
  maxDia: number;
}) {
  // Por defecto: los que tienen número y no recibieron este aviso en los últimos 3 días.
  const [elegidos, setElegidos] = useState<Set<string>>(
    () =>
      new Set(
        usuarios
          .filter((u) => u.telefono && (!u.ultimoWa || Date.now() - new Date(u.ultimoWa).getTime() > 3 * DIA))
          .map((u) => u.id),
      ),
  );
  const [mensaje, setMensaje] = useState(plantilla);
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const conNumero = useMemo(() => usuarios.filter((u) => u.telefono), [usuarios]);
  const n = elegidos.size;

  const cambiar = (s: Set<string>) => {
    setConfirmando(false);
    setElegidos(s);
  };
  const marcar = (id: string, si: boolean) => {
    const t = new Set(elegidos);
    if (si) t.add(id);
    else t.delete(id);
    cambiar(t);
  };

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Mensaje</h2>
        <textarea
          rows={12}
          value={mensaje}
          onChange={(e) => {
            setMensaje(e.target.value);
            setConfirmando(false);
          }}
        />
        <div className="muted small" style={{ marginTop: 4 }}>
          Donde dice <code>{"{apellido}"}</code> va el primer apellido de cada abogado (si no lo tiene, se quita).{" "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setMensaje(plantilla);
              setConfirmando(false);
            }}
          >
            Volver al mensaje de siempre
          </a>
        </div>
        <div className="row wrap" style={{ gap: 10, marginTop: 12, alignItems: "center" }}>
          <button
            type="button"
            className={`btn ${confirmando ? "" : "secondary"}`}
            disabled={pending || n === 0}
            onClick={() => {
              if (!confirmando) {
                setConfirmando(true);
                setResultado(null);
                return;
              }
              start(async () => {
                setResultado(await enviarWaSinRadicadosAction([...elegidos], mensaje));
                setConfirmando(false);
              });
            }}
          >
            {pending ? "Enviando…" : confirmando ? `Confirmar envío a ${n}` : `Enviar por WhatsApp a ${n}`}
          </button>
          <span className="muted small">Salen despacio desde el WhatsApp comercial (máximo {maxDia} al día).</span>
        </div>
        {resultado && (
          <div className={`small ${resultado.error ? "error" : "ok"}`} style={{ marginTop: 8 }}>
            {resultado.error ?? resultado.ok}
          </div>
        )}
      </div>

      <div className="card">
        <div className="row wrap" style={{ gap: 8, alignItems: "center", marginBottom: 8 }}>
          <strong>
            {n} de {conNumero.length} con WhatsApp elegidos
          </strong>
          <button type="button" className="btn small secondary" onClick={() => cambiar(new Set(conNumero.map((u) => u.id)))}>
            Todos
          </button>
          <button type="button" className="btn small secondary" onClick={() => cambiar(new Set())}>
            Ninguno
          </button>
        </div>
        {usuarios.length === 0 ? (
          <p className="muted small">Todos los usuarios ya tienen radicados. 🎉</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th></th>
                  <th>Nombre</th>
                  <th>WhatsApp</th>
                  <th>Registro</th>
                  <th>Último mensaje</th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Elegir a ${u.nombre}`}
                        disabled={!u.telefono}
                        checked={elegidos.has(u.id)}
                        onChange={(e) => marcar(u.id, e.target.checked)}
                      />
                    </td>
                    <td>
                      <Link prefetch={false} href={`/dashboard/admin/usuarios/${u.id}`}>
                        {u.nombre}
                      </Link>
                      <div className="small muted">{u.email}</div>
                      {u.intentoCarga && (
                        <div className="small" style={{ color: "var(--accent)" }}>
                          Intentó cargar, pero no quedó ninguno
                        </div>
                      )}
                    </td>
                    <td className="small">{u.telefono || <span className="muted">Sin número</span>}</td>
                    <td className="small muted">{fecha(u.registro)}</td>
                    <td className="small muted">{u.ultimoWa ? fecha(u.ultimoWa) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
