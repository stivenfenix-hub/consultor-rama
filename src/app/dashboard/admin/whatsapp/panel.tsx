"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  controlWhatsappAction,
  estadoWhatsappAction,
  maxDiaWhatsappAction,
  pruebaWhatsappAction,
} from "@/app/actions";
import type { CuentaWa, EstadoWa, MensajeWa } from "@/lib/whatsapp";

const NOMBRE: Record<CuentaWa, { titulo: string; para: string }> = {
  avisos: { titulo: "WhatsApp de avisos", para: "Actuaciones nuevas y avisos de pago" },
  comercial: { titulo: "WhatsApp comercial", para: "Quienes no han cargado procesos y promociones" },
};

const ESTADO: Record<string, string> = {
  conectado: "Conectado",
  qr: "Esperando que escanees el QR",
  reconectando: "Reconectando…",
  iniciando: "Iniciando…",
  desvinculado: "Desvinculado: generando un QR nuevo…",
  apagado: "Servicio apagado",
};

const fmt = (d: Date | string | null) =>
  d
    ? new Date(d).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" })
    : "—";

export function PanelWhatsapp() {
  const [datos, setDatos] = useState<{ cuentas: EstadoWa[]; mensajes: MensajeWa[] } | null>(null);

  const cargar = useCallback(() => {
    estadoWhatsappAction().then(setDatos).catch(() => {});
  }, []);
  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 4_000); // el QR cambia cada ~20 s
    return () => clearInterval(t);
  }, [cargar]);

  if (!datos) return <p className="muted">Cargando…</p>;

  return (
    <>
      <div className="wa-grid">
        {datos.cuentas.map((c) => (
          <TarjetaCuenta key={c.cuenta} c={c} onCambio={cargar} />
        ))}
      </div>

      <div className="card">
        <h2>Últimos mensajes</h2>
        {datos.mensajes.length === 0 ? (
          <p className="muted small">Aún no hay mensajes en la cola.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>WhatsApp</th>
                  <th>Tipo</th>
                  <th>Teléfono</th>
                  <th>Estado</th>
                  <th>Mensaje</th>
                  <th>Creado</th>
                  <th>Enviado</th>
                </tr>
              </thead>
              <tbody>
                {datos.mensajes.map((m) => (
                  <tr key={m.id}>
                    <td className="small">{m.cuenta === "avisos" ? "Avisos" : "Comercial"}</td>
                    <td className="small">{m.tipo}</td>
                    <td className="small">{m.telefono}</td>
                    <td className="small">
                      <span className={`badge ${m.estado === "enviado" ? "new" : ""}`}>{m.estado}</span>
                      {m.error && <div className="error small">{m.error}</div>}
                    </td>
                    <td className="small muted" style={{ maxWidth: 320 }}>
                      {m.mensaje.length > 120 ? `${m.mensaje.slice(0, 120)}…` : m.mensaje}
                    </td>
                    <td className="muted small" style={{ whiteSpace: "nowrap" }}>{fmt(m.createdAt)}</td>
                    <td className="muted small" style={{ whiteSpace: "nowrap" }}>{fmt(m.enviadoAt)}</td>
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

function TarjetaCuenta({ c, onCambio }: { c: EstadoWa; onCambio: () => void }) {
  const [qrImg, setQrImg] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [maxDia, setMaxDia] = useState(String(c.maxDia));
  const [tel, setTel] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!c.qr) return setQrImg(null);
    QRCode.toDataURL(c.qr, { margin: 1, width: 240 })
      .then(setQrImg)
      .catch(() => setQrImg(null));
  }, [c.qr]);

  const correr = async (fn: () => Promise<{ ok?: string; error?: string }>) => {
    setBusy(true);
    setMsg(await fn().catch(() => ({ error: "No se pudo." })));
    setBusy(false);
    onCambio();
  };

  const estado = !c.servicioActivo ? "apagado" : c.estado;
  const conectado = c.servicioActivo && c.estado === "conectado";

  return (
    <div className="card">
      <h2 style={{ marginBottom: 4 }}>{NOMBRE[c.cuenta].titulo}</h2>
      <div className="muted small">{NOMBRE[c.cuenta].para}</div>

      <div className="row wrap" style={{ gap: 8, margin: "12px 0" }}>
        <span className={`badge ${conectado ? "new" : ""}`}>{ESTADO[estado] ?? estado}</span>
        {conectado && c.numero && <span className="badge">+{c.numero}</span>}
        {c.pausado && <span className="badge">En pausa</span>}
      </div>

      {!c.servicioActivo && (
        <p className="muted small">
          El servicio de WhatsApp no está respondiendo. Revisa que el servidor aparte esté encendido.
        </p>
      )}

      {c.servicioActivo && c.estado === "qr" && qrImg && (
        <div className="wa-qr">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrImg} alt="Código QR para vincular WhatsApp" width={240} height={240} />
          <ol className="small muted">
            <li>Abre WhatsApp en el celular de este número.</li>
            <li>
              Toca <b>⋮ o Configuración → Dispositivos vinculados → Vincular un dispositivo</b>.
            </li>
            <li>Escanea este código. Se actualiza solo cada pocos segundos.</li>
          </ol>
        </div>
      )}

      <div className="wa-stats">
        <div>
          <b>{c.enviadosHoy}</b>
          <span className="muted small">enviados hoy (máx. {c.maxDia})</span>
        </div>
        <div>
          <b>{c.pendientes}</b>
          <span className="muted small">en cola</span>
        </div>
        <div>
          <b>{c.fallidos}</b>
          <span className="muted small">fallidos</span>
        </div>
      </div>

      <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
        <button
          className="btn secondary small"
          disabled={busy}
          onClick={() => correr(() => controlWhatsappAction(c.cuenta, c.pausado ? "reanudar" : "pausar"))}
        >
          {c.pausado ? "Reanudar envíos" : "Pausar envíos"}
        </button>
        {c.fallidos > 0 && (
          <button
            className="btn secondary small"
            disabled={busy}
            onClick={() => correr(() => controlWhatsappAction(c.cuenta, "reintentar"))}
          >
            Reintentar fallidos
          </button>
        )}
        {c.pendientes > 0 && (
          <button
            className="btn secondary small"
            disabled={busy}
            onClick={() => {
              if (confirm(`¿Borrar los ${c.pendientes} mensaje(s) en cola sin enviar?`)) {
                void correr(() => controlWhatsappAction(c.cuenta, "vaciar"));
              }
            }}
          >
            Vaciar cola
          </button>
        )}
        {conectado && (
          <button
            className="btn danger small"
            disabled={busy}
            onClick={() => {
              if (confirm("¿Desvincular este WhatsApp? Tendrás que escanear el QR otra vez.")) {
                void correr(() => controlWhatsappAction(c.cuenta, "desvincular"));
              }
            }}
          >
            Desvincular
          </button>
        )}
      </div>

      <div className="row wrap" style={{ gap: 8, marginTop: 12, alignItems: "center" }}>
        <label className="small muted" htmlFor={`max-${c.cuenta}`}>
          Máximo por día
        </label>
        <input
          id={`max-${c.cuenta}`}
          type="number"
          min={1}
          max={1000}
          value={maxDia}
          onChange={(e) => setMaxDia(e.target.value)}
          style={{ width: 90 }}
        />
        <button
          className="btn secondary small"
          disabled={busy}
          onClick={() => correr(() => maxDiaWhatsappAction(c.cuenta, Number(maxDia)))}
        >
          Guardar
        </button>
      </div>

      <div className="row wrap" style={{ gap: 8, marginTop: 12, alignItems: "center" }}>
        <input
          type="tel"
          placeholder="Tu número para probar"
          value={tel}
          onChange={(e) => setTel(e.target.value)}
          style={{ flex: 1, minWidth: 160 }}
        />
        <button
          className="btn small"
          disabled={busy || !tel}
          onClick={() => correr(() => pruebaWhatsappAction(c.cuenta, tel))}
        >
          Enviar prueba
        </button>
      </div>

      {msg?.ok && <div className="ok small">{msg.ok}</div>}
      {msg?.error && <div className="error small">{msg.error}</div>}
      {c.ultimoError && c.estado !== "conectado" && (
        <div className="muted small" style={{ marginTop: 8 }}>
          Último error: {c.ultimoError}
        </div>
      )}
    </div>
  );
}
