/**
 * Busca en el texto de un documento a las personas que aparecen con su
 * documento de identidad (y su correo o celular, si están cerca), para
 * proponerlas como firmantes. Sin dependencias del navegador.
 */

export type Persona = { nombre: string; tipoDoc: "CC" | "CE" | "NIT" | "PAS"; numDoc: string; email: string; telefono: string };

const DOC_RE =
  /(c[ée]dula\s+de\s+ciudadan[íi]a|c[ée]dula\s+de\s+extranjer[íi]a|c\.\s?c\.?|\bc\.?c\b|c\.\s?e\.?|\bc\.?e\b|pasaporte|n\.?\s?i\.?\s?t\.?)\s*(?:n[úu]mero|n[o°º]\.?|#|:)?\s*(?:n[o°º]\.?\s*)?(\d[\d.,\s]{4,16}\d)/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TEL_RE = /(?:\+?57[\s-]?)?\b3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

const MAY = "A-ZÁÉÍÓÚÑÜ";
const MIN = "a-záéíóúñü";
const PALABRA = `(?:[${MAY}][${MIN}]+|[${MAY}]{2,})`;
// Hasta dos conectores seguidos: "Martínez de la Cruz".
const NOMBRE_RE = new RegExp(`${PALABRA}(?:[ \\t]+(?:(?:de|del|la|las|los|y|DE|DEL|LA|LAS|LOS)[ \\t]+){0,2}${PALABRA}){1,5}`, "g");
/** Sin tildes y en minúscula, conservando la longitud (para comparar posiciones). */
const plano = (s: string) =>
  Array.from(s.normalize("NFC"), (c) => (c.normalize("NFD")[0] ?? c).toLowerCase()).join("");
const CONECTOR = /^(de|del|la|las|los|y)$/i;

/** Palabras que no son parte de un nombre de persona. */
const NO_NOMBRE = new Set(
  (
    "señor señora señores doctor doctora dr dra juez jueza juzgado tribunal corte sala circuito civil penal laboral familia " +
    "municipal reparto ciudad yo el la los las de del referencia asunto proceso demandante demandado poder especial amplio " +
    "suficiente abogado abogada apoderado apoderada poderdante cédula cedula ciudadanía ciudadania extranjería extranjeria nit " +
    "pasaporte república republica colombia medellín medellin bogotá bogota cali barranquilla cartagena antioquia cundinamarca " +
    "valle atlántico atlantico santander bolívar bolivar dc distrito capital tarjeta profesional consejo superior judicatura " +
    "contrato prestación prestacion servicios profesionales honorarios cláusula clausula primera segunda tercera cuarta " +
    "quinta parte partes firma firmas nombre identificación identificacion correo electrónico electronico teléfono telefono " +
    "celular dirección direccion notaría notaria escritura pública publica sas ltda ley decreto artículo articulo mandante " +
    "mandatario contratante contratista arrendador arrendatario vendedor comprador deudor acreedor otorgante"
  ).split(/\s+/),
);

function limpiarNombre(n: string) {
  const palabras = n.split(/\s+/);
  // Quita palabras genéricas del principio y del final ("Señora María ..." -> "María ...").
  while (palabras.length && (NO_NOMBRE.has(palabras[0].toLowerCase()) || CONECTOR.test(palabras[0]))) palabras.shift();
  while (palabras.length && (NO_NOMBRE.has(palabras[palabras.length - 1].toLowerCase()) || CONECTOR.test(palabras[palabras.length - 1])))
    palabras.pop();
  const utiles = palabras.filter((p) => !CONECTOR.test(p));
  if (utiles.length < 2 || utiles.length > 6 || utiles.some((p) => NO_NOMBRE.has(p.toLowerCase()))) return null;
  return palabras
    .map((p) => (CONECTOR.test(p) ? p.toLowerCase() : p.charAt(0) + p.slice(1).toLowerCase()))
    .join(" ");
}

/** El nombre más cercano antes del número de documento. */
function nombreAntes(texto: string, fin: number): string | null {
  const ventana = texto.slice(Math.max(0, fin - 260), fin);
  let mejor: { n: string; pos: number; fuerte: boolean } | null = null;
  for (const m of ventana.matchAll(NOMBRE_RE)) {
    const n = limpiarNombre(m[0]);
    if (!n) continue;
    const pos = m.index ?? 0;
    const despues = ventana.slice(pos + m[0].length, pos + m[0].length + 90).toLowerCase();
    // Un nombre seguido de "mayor de edad", "identificado"... es casi seguro la persona.
    const fuerte = /^\s*[,\n]?\s*(mayor|identificad|domiciliad|vecin|quien|portador|con\s+c|c\.?\s?c|en\s+calidad|actuando|en\s+nombre)/.test(
      despues,
    );
    if (!mejor || (fuerte && (!mejor.fuerte || pos >= mejor.pos)) || (!mejor.fuerte && pos >= mejor.pos)) {
      mejor = { n, pos, fuerte };
    }
  }
  return mejor?.n ?? null;
}

function tipoDe(etiqueta: string): Persona["tipoDoc"] {
  const e = etiqueta.toLowerCase().replace(/[\s.]/g, "");
  if (e.includes("extranj") || e === "ce") return "CE";
  if (e.startsWith("pasaporte")) return "PAS";
  if (e === "nit") return "NIT";
  return "CC";
}

/** Personas con documento de identidad, en el orden en que aparecen. */
export function buscarPersonas(texto: string): Persona[] {
  const t = texto.normalize("NFC").replace(/ /g, " ").replace(/[ \t]+/g, " ");
  const hallados: (Persona & { pos: number; menciones: number[] })[] = [];
  for (const m of t.matchAll(DOC_RE)) {
    const numDoc = m[2].replace(/\D/g, "");
    if (numDoc.length < 5 || numDoc.length > 12) continue;
    // Tarjeta profesional del abogado: "T.P. No. 123.456" no es un documento de identidad.
    const antes = t.slice(Math.max(0, (m.index ?? 0) - 25), m.index ?? 0).toLowerCase();
    if (/t\.?\s?p\.?\s*$|tarjeta\s+profesional\s*$/.test(antes)) continue;
    const ya = hallados.find((h) => h.numDoc === numDoc);
    const nombre = nombreAntes(t, m.index ?? 0);
    if (ya) {
      if (!ya.nombre && nombre) ya.nombre = nombre;
      ya.menciones.push(m.index ?? 0);
      continue;
    }
    hallados.push({
      nombre: nombre ?? "",
      tipoDoc: tipoDe(m[1]),
      numDoc,
      email: "",
      telefono: "",
      pos: m.index ?? 0,
      menciones: [m.index ?? 0],
    });
  }
  const personas = hallados.filter((h) => h.nombre);
  if (!personas.length) return [];

  // Dónde se menciona a cada persona (su nombre o su documento).
  const tp = plano(t);
  for (const p of personas) {
    const n = plano(p.nombre);
    for (let i = tp.indexOf(n); i >= 0; i = tp.indexOf(n, i + 1)) p.menciones.push(i);
  }
  // El dato es de quien se mencionó justo antes ("Juan…, C.C. …, teléfono …");
  // si nadie se mencionó antes, de quien aparece muy poco después.
  const masCercana = (pos: number) => {
    let antes: (typeof personas)[number] | null = null;
    let despues: (typeof personas)[number] | null = null;
    let dAntes = 260;
    let dDespues = 60;
    for (const p of personas)
      for (const m of p.menciones) {
        if (m <= pos && pos - m < dAntes) {
          dAntes = pos - m;
          antes = p;
        } else if (m > pos && m - pos < dDespues) {
          dDespues = m - pos;
          despues = p;
        }
      }
    return antes ?? despues;
  };

  // Correos: primero por el nombre ("maria@..." es de María); si no, el más cercano.
  const lineaDeCorreo = new Map<number, (typeof personas)[number]>();
  for (const m of t.matchAll(EMAIL_RE)) {
    const correo = m[0].toLowerCase();
    const usuario = plano(correo.split("@")[0]);
    const porNombre = personas.find(
      (p) => !p.email && plano(p.nombre).split(" ").some((w) => w.length >= 4 && usuario.includes(w)),
    );
    const d = porNombre ?? masCercana(m.index ?? 0);
    if (d && !d.email) {
      d.email = correo;
      lineaDeCorreo.set(t.lastIndexOf("\n", m.index ?? 0), d);
    }
  }
  // Celulares: de quien tiene un correo en esa misma línea; si no, el más cercano.
  for (const m of t.matchAll(TEL_RE)) {
    const tel = m[0].replace(/\D/g, "").replace(/^57(?=3\d{9}$)/, "");
    if (tel.length !== 10) continue;
    const d = lineaDeCorreo.get(t.lastIndexOf("\n", m.index ?? 0)) ?? masCercana(m.index ?? 0);
    if (d && !d.telefono) d.telefono = tel;
  }
  return personas.map(({ pos: _pos, menciones: _m, ...p }) => p);
}
