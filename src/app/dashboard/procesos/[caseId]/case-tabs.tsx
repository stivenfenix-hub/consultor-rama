"use client";

import { useState } from "react";

export type Datos = { label: string; value: string }[];
export type Act = {
  id: string;
  fecha: string;
  nombre: string;
  anotacion: string | null;
  seen: boolean;
  conDocumentos: boolean;
  docs: { idRegDocumento: string; nombre: string; tipo: string | null }[];
};
export type Parte = {
  rol: string;
  nombre: string;
  identificacion: string | null;
};
export type Doc = {
  idRegDocumento: string;
  nombre: string;
  descripcion: string | null;
  tipo: string | null;
  fecha: string;
};
export type Grabacion = { fecha: string; actuacion: string; url: string };
export type Sync = {
  inicio: string;
  origen: string;
  operacion: string;
  resultado: string;
  duracion: number | null;
  elementos: number;
  error: string | null;
};

type TabKey =
  | "resumen"
  | "actuaciones"
  | "documentos"
  | "partes"
  | "grabaciones"
  | "sincronizacion";

export function CaseTabs({
  datos,
  actuaciones,
  partes,
  documentos,
  grabaciones,
  syncLogs,
}: {
  datos: Datos;
  actuaciones: Act[];
  partes: Parte[];
  documentos: Doc[];
  grabaciones: Grabacion[];
  syncLogs: Sync[];
}) {
  const [tab, setTab] = useState<TabKey>("resumen");

  const tabs: { key: TabKey; label: string }[] = [
    { key: "resumen", label: "Resumen" },
    { key: "actuaciones", label: `Actuaciones (${actuaciones.length})` },
    { key: "documentos", label: "Documentos" },
    { key: "partes", label: "Partes" },
    { key: "grabaciones", label: "Grabaciones" },
    { key: "sincronizacion", label: "Sincronización" },
  ];

  return (
    <div>
      <div className="tabbar">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`tab ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="card">
        {tab === "resumen" && (
          <>
            <h2>Datos del proceso</h2>
            <dl className="small" style={{ margin: 0 }}>
              {datos.map((d) => (
                <div
                  key={d.label}
                  style={{ display: "flex", gap: 8, padding: "4px 0" }}
                >
                  <dt className="muted" style={{ minWidth: 160 }}>
                    {d.label}
                  </dt>
                  <dd style={{ margin: 0 }}>{d.value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}

        {tab === "actuaciones" && (
          <>
            <h2>Actuaciones ({actuaciones.length})</h2>
            {actuaciones.length === 0 && (
              <p className="muted small">Sin actuaciones registradas.</p>
            )}
            {actuaciones.map((a) => (
              <div key={a.id} className={`event ${a.seen ? "" : "unseen"}`}>
                <div className="date">
                  {a.fecha}
                  {!a.seen && (
                    <span className="badge new" style={{ marginLeft: 8 }}>
                      nueva
                    </span>
                  )}
                  {a.conDocumentos && (
                    <span className="badge" style={{ marginLeft: 8 }}>
                      con documentos
                    </span>
                  )}
                </div>
                <div className="name">{a.nombre}</div>
                {a.anotacion && <div className="note">{a.anotacion}</div>}
                {a.docs.length > 0 && (
                  <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
                    {a.docs.map((d) => (
                      <a
                        key={d.idRegDocumento}
                        className="btn secondary small"
                        href={`/api/documento/${d.idRegDocumento}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={d.nombre}
                      >
                        ⬇ Descargar{d.tipo ? ` ${d.tipo.toUpperCase()}` : ""}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {tab === "documentos" && (
          <>
            <h2>Documentos ({documentos.length})</h2>
            {documentos.length === 0 ? (
              <p className="muted small">
                Este proceso no tiene documentos en la Rama Judicial.
              </p>
            ) : (
              documentos.map((d) => (
                <div key={d.idRegDocumento} className="doc-row">
                  <div style={{ minWidth: 0 }}>
                    <div className="name">📄 {d.nombre}</div>
                    <div className="muted small">
                      {d.fecha}
                      {d.tipo ? ` · ${d.tipo.toUpperCase()}` : ""}
                      {d.descripcion ? ` · ${d.descripcion}` : ""}
                    </div>
                  </div>
                  <a
                    className="btn secondary small"
                    href={`/api/documento/${d.idRegDocumento}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    ⬇ Descargar
                  </a>
                </div>
              ))
            )}
          </>
        )}

        {tab === "partes" && (
          <>
            <h2>Partes ({partes.length})</h2>
            {partes.length === 0 ? (
              <p className="muted small">Sin partes registradas.</p>
            ) : (
              <dl className="small" style={{ margin: 0 }}>
                {partes.map((p, i) => (
                  <div
                    key={i}
                    style={{ display: "flex", gap: 8, padding: "6px 0" }}
                  >
                    <dt className="muted" style={{ minWidth: 170 }}>
                      {p.rol}
                    </dt>
                    <dd style={{ margin: 0 }}>
                      {p.nombre}
                      {p.identificacion ? (
                        <span className="muted"> · {p.identificacion}</span>
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </>
        )}

        {tab === "grabaciones" && (
          <>
            <h2>Grabaciones ({grabaciones.length})</h2>
            {grabaciones.length === 0 ? (
              <p className="muted small">
                No se encontraron enlaces a grabaciones en las actuaciones de
                este proceso. (El juzgado suele pegar el enlace de la audiencia
                dentro de una actuación cuando la publica.)
              </p>
            ) : (
              grabaciones.map((g, i) => (
                <div key={i} className="doc-row">
                  <div style={{ minWidth: 0 }}>
                    <div className="name">🎙️ {g.actuacion}</div>
                    <div className="muted small" style={{ wordBreak: "break-all" }}>
                      {g.fecha} · {g.url}
                    </div>
                  </div>
                  <a
                    className="btn secondary small"
                    href={g.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Abrir
                  </a>
                </div>
              ))
            )}
          </>
        )}

        {tab === "sincronizacion" && (
          <>
            <h2>Sincronización</h2>
            {syncLogs.length === 0 ? (
              <p className="muted small">Aún no hay sincronizaciones registradas.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Inicio</th>
                      <th>Origen</th>
                      <th>Operación</th>
                      <th>Resultado</th>
                      <th>Duración</th>
                      <th>Elementos</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncLogs.map((l, i) => (
                      <tr key={i}>
                        <td className="muted">{l.inicio}</td>
                        <td className="muted">{l.origen}</td>
                        <td>{l.operacion}</td>
                        <td>
                          {l.resultado === "exito" ? (
                            <span style={{ color: "var(--green)" }}>✓ Éxito</span>
                          ) : (
                            <span style={{ color: "var(--amber)" }}>
                              ⚠ Fallo
                            </span>
                          )}
                        </td>
                        <td className="muted">
                          {l.duracion != null
                            ? `${(l.duracion / 1000).toFixed(1)} s`
                            : "—"}
                        </td>
                        <td>{l.elementos}</td>
                        <td className="error small" style={{ maxWidth: 260 }}>
                          {l.error ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
