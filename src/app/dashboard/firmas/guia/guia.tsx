"use client";

import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/icon";

const CHIPS: { icon: IconName; t: string }[] = [
  { icon: "firma", t: "Firma desde el celular" },
  { icon: "phone", t: "Código por SMS, WhatsApp o correo" },
  { icon: "clock", t: "Fecha y hora exactas" },
  { icon: "sello", t: "Documento sellado" },
  { icon: "file", t: "Certificado de firma en PDF" },
];

// Recorrido de una firma (demostración animada).
const ETAPAS: { icon: IconName; t: string; hora: string }[] = [
  { icon: "send", t: "Enviado al cliente", hora: "3:10:05 p. m." },
  { icon: "eye", t: "Abierto", hora: "3:12:41 p. m." },
  { icon: "firma", t: "Firmado", hora: "3:14:09 p. m." },
  { icon: "sello", t: "Sellado", hora: "3:14:10 p. m." },
];

const PASOS: { icon: IconName; t: string; d: string }[] = [
  {
    icon: "file",
    t: "Subes el documento o usas una plantilla",
    d: "Un poder, un contrato de honorarios o un pagaré. Marcas dónde firma cada persona.",
  },
  {
    icon: "send",
    t: "Tu cliente firma desde el celular",
    d: "Le llega el enlace por correo o WhatsApp. Confirma su identidad con un código (por SMS, WhatsApp o correo) y firma en segundos, sin imprimir ni ir a notaría.",
  },
  {
    icon: "sello",
    t: "Recibes el documento firmado",
    d: "Queda sellado (no se puede alterar) con el registro de quién firmó, cuándo y desde dónde, listo para radicar o archivar.",
  },
];

type Doc = { t: string; d: string };
const CATEGORIAS: { icon: IconName; t: string; norma: string; docs: Doc[] }[] = [
  {
    icon: "scale",
    t: "Judiciales y procesales",
    norma: "Ley 2213 de 2022",
    docs: [
      {
        t: "Poderes especiales",
        d: "Para procesos civiles, laborales, de familia, administrativos, penales (representación de víctimas) y constitucionales (tutelas, desacatos). Enviados como mensaje de datos no necesitan presentación personal en notaría.",
      },
      { t: "Sustituciones y reasunciones de poder", d: "Cuando el abogado principal delega la audiencia o el proceso en otro colega." },
      { t: "Revocatorias y paz y salvos", d: "Para terminar formalmente la relación abogado-cliente." },
      { t: "Demandas, contestaciones, recursos y memoriales", d: "Los documentos que radicas ante los despachos judiciales." },
      { t: "Conciliaciones y transacciones", d: "Actas de conciliación extrajudicial y acuerdos privados para terminar un litigio." },
    ],
  },
  {
    icon: "users",
    t: "Abogado y cliente",
    norma: "Ley 527 de 1999 · Decreto 2364 de 2012",
    docs: [
      { t: "Contrato de honorarios", d: "Prestación de servicios profesionales: honorarios fijos, por etapas o por cuota litis." },
      { t: "Otrosíes", d: "Cambios en tarifas, alcance del servicio o plazos." },
      { t: "Acuerdos de confidencialidad (NDA)", d: "Cuando el cliente entrega información sensible antes de contratar." },
      { t: "Autorización de datos personales", d: "Habeas Data, para cumplir la Ley 1581 de 2012." },
      { t: "Actas de entrega de documentos", d: "Constancia de que el cliente entregó pruebas o de que se las devolviste." },
    ],
  },
  {
    icon: "card",
    t: "Cobro y garantías",
    norma: "Cartera y procesos ejecutivos",
    docs: [
      { t: "Pagarés y cartas de instrucciones", d: "Válidos para iniciar procesos ejecutivos, siempre que se garantice su integridad e inalterabilidad." },
      { t: "Arrendamientos", d: "De vivienda urbana o local comercial, incluida la firma de los codeudores." },
      { t: "Compraventa de bienes muebles", d: "Vehículos, maquinaria, mercancía o cesión de derechos económicos." },
      {
        t: "Promesa de compraventa de inmuebles",
        d: "Lotes, casas, fincas o apartamentos, también cuando se pagan a cuotas: la promesa es un contrato privado y se firma electrónicamente. Solo la escritura pública que transfiere la propiedad se hace después en notaría.",
      },
      { t: "Contratos laborales", d: "Para las empresas que asesoras." },
    ],
  },
];

// "¿Se puede firmar electrónicamente?": lo que sí y lo que no.
const VERIFICADOR: { t: string; ok: boolean; d: string }[] = [
  { t: "Poder especial para un proceso", ok: true, d: "Sí. Ley 2213 de 2022: sin presentación personal si se envía como mensaje de datos." },
  { t: "Contrato de honorarios", ok: true, d: "Sí. Ley 527 de 1999 y Decreto 2364 de 2012 (equivalencia funcional)." },
  { t: "Pagaré", ok: true, d: "Sí, para iniciar un ejecutivo, si se garantiza que no fue alterado. Para negociarlo en el mercado de valores necesita anotación en cuenta (p. ej. Deceval)." },
  { t: "Contrato de arrendamiento", ok: true, d: "Sí, de vivienda urbana o local comercial, también para los codeudores." },
  {
    t: "Promesa de compraventa de lote, casa o finca",
    ok: true,
    d: "Sí. La promesa (aunque sea a cuotas) es un contrato privado. La escritura pública que transfiere la propiedad se firma después en notaría.",
  },
  { t: "Escritura de compraventa de una casa o lote", ok: false, d: "No. La transferencia del inmueble exige escritura pública ante notario, igual que las hipotecas y las sucesiones por notaría." },
  { t: "Poder general", ok: false, d: "No. Un poder amplio para administrar todos los negocios de una persona sigue exigiendo escritura pública." },
  { t: "Testamento", ok: false, d: "No. Requiere solemnidades notariales estrictas, igual que las capitulaciones matrimoniales." },
  { t: "Constitución de sociedad con inmuebles", ok: false, d: "No. Si se aportan inmuebles, exige escritura pública." },
];

const EXCEPCIONES: { t: string; d: string }[] = [
  { t: "Lo que exige escritura pública", d: "La escritura de compraventa de inmuebles (la promesa sí se firma electrónicamente), hipotecas, sociedades que aportan inmuebles y sucesiones por notaría." },
  { t: "Poderes generales", d: "Para administrar todos los negocios de una persona." },
  { t: "Testamentos y capitulaciones matrimoniales", d: "Requieren solemnidades notariales estrictas." },
  { t: "Títulos para el mercado de valores", d: "Un pagaré electrónico es válido, pero para negociarlo requiere anotación en cuenta (p. ej. Deceval)." },
];

export function GuiaFirma() {
  const [etapa, setEtapa] = useState(0);
  const [cat, setCat] = useState(0);
  const [doc, setDoc] = useState(0);
  const [pregunta, setPregunta] = useState<number | null>(null);

  useEffect(() => {
    const t = setInterval(() => setEtapa((e) => (e + 1) % (ETAPAS.length + 1)), 1400);
    return () => clearInterval(t);
  }, []);

  const c = CATEGORIAS[cat];
  const d = c.docs[doc] ?? c.docs[0];
  const r = pregunta === null ? null : VERIFICADOR[pregunta];

  return (
    <>
      <section className="cert-hero">
        <div className="cert-hero-icon">
          <Icon name="firma" size={34} />
        </div>
        <h1>Qué puedes firmar electrónicamente</h1>
        <p>
          Haz que tus clientes firmen poderes, contratos de honorarios y pagarés <b>desde el celular</b>, con
          validez jurídica (Ley 527 de 1999 y Ley 2213 de 2022), sin imprimir ni ir a notaría.
        </p>
        <div className="cert-chips">
          {CHIPS.map((x) => (
            <span key={x.t} className="cert-chip">
              <Icon name={x.icon} size={15} /> {x.t}
            </span>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Así verás cada firma</h2>
        <div className="cert-track">
          {ETAPAS.map((e, i) => {
            const hecho = i < etapa;
            return (
              <div key={e.t} className={`cert-stage ${hecho ? "on" : ""} ${i === etapa - 1 ? "now" : ""}`}>
                <div className="cert-dot">
                  <Icon name={e.icon} size={18} />
                </div>
                <div className="cert-stage-t">{e.t}</div>
                <div className="cert-stage-h">{hecho ? e.hora : "—"}</div>
              </div>
            );
          })}
          <div className="cert-line">
            <div
              className="cert-line-fill"
              style={{ width: `${(Math.max(etapa - 1, 0) / (ETAPAS.length - 1)) * 100}%` }}
            />
          </div>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Cada paso queda con fecha y hora exactas, y el documento firmado se sella para que nadie lo pueda alterar.
        </p>
      </section>

      <section className="cert-steps">
        {PASOS.map((s, i) => (
          <div key={s.t} className="cert-step">
            <div className="cert-step-n">{i + 1}</div>
            <div className="cert-step-icon">
              <Icon name={s.icon} size={22} />
            </div>
            <b>{s.t}</b>
            <p className="muted small">{s.d}</p>
          </div>
        ))}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Qué puedes firmar</h2>
        <p className="muted small" style={{ marginTop: 0 }}>Elige un tipo y toca un documento para ver para qué sirve.</p>
        <div className="cert-plantillas">
          {CATEGORIAS.map((x, i) => (
            <button
              key={x.t}
              type="button"
              className={`cert-plantilla ${i === cat ? "sel" : ""}`}
              onClick={() => {
                setCat(i);
                setDoc(0);
              }}
            >
              <Icon name={x.icon} size={20} />
              <span>{x.t}</span>
            </button>
          ))}
        </div>
        <div className="firma-docs">
          {c.docs.map((x, i) => (
            <button
              key={x.t}
              type="button"
              className={`firma-doc ${i === doc ? "sel" : ""}`}
              onClick={() => setDoc(i)}
            >
              {x.t}
            </button>
          ))}
        </div>
        <div className="cert-detalle" key={`${cat}-${doc}`}>
          <div className="cert-detalle-icon">
            <Icon name={c.icon} size={22} />
          </div>
          <div>
            <b>{d.t}</b>
            <div className="cert-norma">{c.norma}</div>
            <p className="small" style={{ margin: "6px 0 0" }}>{d.d}</p>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>¿Se puede firmar electrónicamente?</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Toca un documento y te decimos si sirve con firma electrónica o si necesita notaría.
        </p>
        <div className="firma-docs">
          {VERIFICADOR.map((x, i) => (
            <button
              key={x.t}
              type="button"
              className={`firma-doc ${i === pregunta ? "sel" : ""}`}
              onClick={() => setPregunta(i)}
            >
              {x.t}
            </button>
          ))}
        </div>
        {r ? (
          <div className={`firma-veredicto ${r.ok ? "si" : "no"}`} key={pregunta}>
            <div className="firma-veredicto-icon">
              <Icon name={r.ok ? "check" : "alert"} size={22} />
            </div>
            <div>
              <b>{r.ok ? "Sí se puede" : "No: necesita notaría"}</b>
              <p className="small" style={{ margin: "4px 0 0" }}>{r.d}</p>
            </div>
          </div>
        ) : (
          <p className="muted small" style={{ marginBottom: 0 }}>👆 Elige uno.</p>
        )}
      </section>

      <section className="card firma-excepciones">
        <h2 style={{ marginTop: 0 }}>
          <Icon name="alert" size={18} /> Lo que NO se puede firmar solo electrónicamente
        </h2>
        <p className="small" style={{ marginTop: 0 }}>
          Tenlo presente antes de enviar, para evitar nulidades o rechazos:
        </p>
        <ol>
          {EXCEPCIONES.map((x) => (
            <li key={x.t}>
              <b>{x.t}:</b> {x.d}
            </li>
          ))}
        </ol>
      </section>

    </>
  );
}
