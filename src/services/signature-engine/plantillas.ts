import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { fechaLargaCo, limpiar, partir } from "./texto";

/**
 * Plantillas legales pre-redactadas. Cada una define sus campos (lo que el
 * abogado llena) y su texto con {{variables}}; se dibujan a PDF tamaño carta.
 * Los campos se le pasan al asistente desde la página (este archivo no se
 * importa en el navegador, para no cargar pdf-lib allá).
 */

export type CampoPlantilla = {
  clave: string;
  etiqueta: string;
  /** Texto de ejemplo dentro del campo. */
  ejemplo?: string;
  tipo?: "texto" | "largo" | "opcion";
  opciones?: string[];
  opcional?: boolean;
  /** Mitad del ancho en pantallas grandes. */
  medio?: boolean;
};

export type Plantilla = {
  id: string;
  nombre: string;
  descripcion: string;
  norma: string;
  /** Título del documento (también con {{variables}}). */
  titulo: string;
  campos: CampoPlantilla[];
  /** Párrafos. "## " = subtítulo centrado; "" = espacio. */
  cuerpo: string;
  /** Quiénes firman, en orden (para sugerir los firmantes). */
  firmas: { rol: string; nombre: string; doc: string }[];
};

const TIPOS_DOC = ["cédula de ciudadanía", "cédula de extranjería", "NIT", "pasaporte"];

export const PLANTILLAS: Plantilla[] = [
  {
    id: "poder-especial",
    nombre: "Poder especial",
    descripcion: "Poder para actuar en un proceso, otorgado como mensaje de datos: sin presentación personal ni notaría.",
    norma: "Art. 5, Ley 2213 de 2022",
    titulo: "Poder especial - {{poderdante_nombre}}",
    campos: [
      { clave: "ciudad", etiqueta: "Ciudad", ejemplo: "Medellín", medio: true },
      { clave: "despacho", etiqueta: "Dirigido a (juzgado o autoridad)", ejemplo: "Juez Civil del Circuito de Medellín (Reparto)", medio: true },
      { clave: "poderdante_nombre", etiqueta: "Nombre del poderdante (su cliente)", ejemplo: "María Fernanda Gómez Ríos", medio: true },
      { clave: "poderdante_tipo_doc", etiqueta: "Tipo de documento", tipo: "opcion", opciones: TIPOS_DOC, medio: true },
      { clave: "poderdante_doc", etiqueta: "Número de documento del poderdante", ejemplo: "43.123.456", medio: true },
      { clave: "poderdante_ciudad_doc", etiqueta: "Expedida en", ejemplo: "Medellín", medio: true },
      { clave: "poderdante_domicilio", etiqueta: "Domicilio del poderdante", ejemplo: "Medellín, Antioquia", medio: true },
      { clave: "poderdante_email", etiqueta: "Correo del poderdante", ejemplo: "maria@correo.com", medio: true },
      { clave: "abogado_nombre", etiqueta: "Nombre del abogado (apoderado)", ejemplo: "Carlos Andrés Pérez Mejía", medio: true },
      { clave: "abogado_doc", etiqueta: "Cédula del abogado", ejemplo: "71.234.567", medio: true },
      { clave: "abogado_tp", etiqueta: "Tarjeta profesional", ejemplo: "123.456 del C. S. de la J.", medio: true },
      { clave: "abogado_email", etiqueta: "Correo del abogado (el del Registro Nacional de Abogados)", ejemplo: "carlos@bufete.com", medio: true },
      { clave: "clase_proceso", etiqueta: "Clase de proceso", ejemplo: "proceso verbal de responsabilidad civil extracontractual" },
      { clave: "contraparte", etiqueta: "Contra / demandado", ejemplo: "Seguros del Estado S.A." },
      { clave: "radicado", etiqueta: "Radicado (si ya existe)", ejemplo: "05001310302120240028100", opcional: true },
      { clave: "objeto", etiqueta: "Objeto del poder (qué debe hacer el abogado)", tipo: "largo", ejemplo: "inicie y lleve hasta su terminación el proceso, en defensa de mis intereses" },
    ],
    cuerpo: `Señor(a)
{{despacho}}
E. S. D.

Referencia: {{clase_proceso}} contra {{contraparte}}.{{radicado_linea}}
Asunto: Otorgamiento de poder especial.

{{poderdante_nombre}}, mayor de edad, con domicilio en {{poderdante_domicilio}}, identificado(a) con {{poderdante_tipo_doc}} No. {{poderdante_doc}} expedida en {{poderdante_ciudad_doc}}, obrando en nombre propio, por medio del presente escrito manifiesto que confiero PODER ESPECIAL, amplio y suficiente, al doctor(a) {{abogado_nombre}}, mayor de edad, identificado(a) con cédula de ciudadanía No. {{abogado_doc}}, abogado(a) en ejercicio, portador(a) de la tarjeta profesional No. {{abogado_tp}}, para que en mi nombre y representación {{objeto}}.

Mi apoderado(a) queda facultado(a) para ejercer todas las atribuciones del artículo 77 del Código General del Proceso, y en especial para notificarse, presentar la demanda o contestarla, proponer excepciones, pedir y aportar pruebas, conciliar, transigir, desistir, recibir, sustituir y reasumir este poder, interponer los recursos de ley y, en general, para adelantar todas las actuaciones necesarias para la defensa de mis derechos e intereses.

De conformidad con el artículo 5 de la Ley 2213 de 2022, este poder se confiere mediante mensaje de datos, con la sola antefirma, se presume auténtico y no requiere presentación personal ni reconocimiento. La dirección de correo electrónico de mi apoderado(a), que coincide con la inscrita en el Registro Nacional de Abogados, es {{abogado_email}}. Mi dirección de correo electrónico para notificaciones es {{poderdante_email}}.

Sírvase, señor(a) Juez, reconocerle personería a mi apoderado(a) en los términos y para los efectos del presente poder.

Dado en {{ciudad}}, a los {{fecha}}.

Atentamente,`,
    firmas: [
      { rol: "Poderdante", nombre: "poderdante_nombre", doc: "poderdante_doc" },
      { rol: "Acepto: apoderado(a)", nombre: "abogado_nombre", doc: "abogado_doc" },
    ],
  },
  {
    id: "contrato-servicios",
    nombre: "Contrato de prestación de servicios profesionales",
    descripcion: "Contrato de honorarios entre abogado y cliente: objeto, valor, forma de pago, obligaciones y terminación.",
    norma: "Ley 527 de 1999 · Decreto 2364 de 2012",
    titulo: "Contrato de servicios profesionales - {{cliente_nombre}}",
    campos: [
      { clave: "ciudad", etiqueta: "Ciudad", ejemplo: "Medellín", medio: true },
      { clave: "cliente_nombre", etiqueta: "Nombre del cliente (contratante)", ejemplo: "María Fernanda Gómez Ríos", medio: true },
      { clave: "cliente_tipo_doc", etiqueta: "Tipo de documento del cliente", tipo: "opcion", opciones: TIPOS_DOC, medio: true },
      { clave: "cliente_doc", etiqueta: "Número de documento del cliente", ejemplo: "43.123.456", medio: true },
      { clave: "cliente_domicilio", etiqueta: "Domicilio del cliente", ejemplo: "Medellín, Antioquia", medio: true },
      { clave: "cliente_email", etiqueta: "Correo del cliente", ejemplo: "maria@correo.com", medio: true },
      { clave: "abogado_nombre", etiqueta: "Nombre del abogado (contratista)", ejemplo: "Carlos Andrés Pérez Mejía", medio: true },
      { clave: "abogado_doc", etiqueta: "Cédula del abogado", ejemplo: "71.234.567", medio: true },
      { clave: "abogado_tp", etiqueta: "Tarjeta profesional", ejemplo: "123.456 del C. S. de la J.", medio: true },
      { clave: "abogado_email", etiqueta: "Correo del abogado", ejemplo: "carlos@bufete.com", medio: true },
      { clave: "objeto", etiqueta: "Objeto del contrato (el encargo)", tipo: "largo", ejemplo: "representar judicialmente al CONTRATANTE en el proceso verbal de responsabilidad civil contra Seguros del Estado S.A., en todas sus instancias" },
      { clave: "honorarios", etiqueta: "Valor de los honorarios", ejemplo: "CINCO MILLONES DE PESOS ($5.000.000)" },
      { clave: "forma_pago", etiqueta: "Forma de pago", tipo: "largo", ejemplo: "el cincuenta por ciento (50 %) a la firma de este contrato y el cincuenta por ciento (50 %) restante con la sentencia de primera instancia" },
      { clave: "cuota_litis", etiqueta: "Cuota litis o prima de éxito (opcional)", ejemplo: "el veinte por ciento (20 %) de lo que efectivamente se recupere", opcional: true },
      { clave: "duracion", etiqueta: "Duración", ejemplo: "hasta la terminación del proceso en todas sus instancias" },
    ],
    cuerpo: `## CONTRATO DE PRESTACIÓN DE SERVICIOS PROFESIONALES DE ABOGADO

Entre los suscritos, a saber: de una parte, {{cliente_nombre}}, mayor de edad, con domicilio en {{cliente_domicilio}}, identificado(a) con {{cliente_tipo_doc}} No. {{cliente_doc}}, quien en adelante se denominará EL CONTRATANTE; y de la otra, {{abogado_nombre}}, mayor de edad, identificado(a) con cédula de ciudadanía No. {{abogado_doc}}, abogado(a) en ejercicio, portador(a) de la tarjeta profesional No. {{abogado_tp}}, quien en adelante se denominará EL ABOGADO, hemos convenido celebrar el presente contrato de prestación de servicios profesionales, que se regirá por las siguientes cláusulas:

PRIMERA. OBJETO. EL ABOGADO se obliga, de manera independiente y con plena autonomía técnica y profesional, a {{objeto}}.

SEGUNDA. HONORARIOS. EL CONTRATANTE pagará a EL ABOGADO, a título de honorarios profesionales, la suma de {{honorarios}}.{{cuota_litis_linea}}

TERCERA. FORMA DE PAGO. Los honorarios se pagarán así: {{forma_pago}}. El retardo en el pago causará intereses de mora a la tasa máxima legal permitida.

CUARTA. GASTOS. Los gastos del proceso, como notificaciones, pólizas, honorarios de peritos, copias, registros, desplazamientos y demás expensas necesarias, corren por cuenta de EL CONTRATANTE y no están incluidos en los honorarios.

QUINTA. OBLIGACIONES DE EL ABOGADO. (a) Atender el encargo con diligencia, lealtad y cuidado profesional, conforme a la Ley 1123 de 2007; (b) informar oportunamente a EL CONTRATANTE sobre el estado y avance del asunto; (c) guardar el secreto profesional; (d) rendir cuentas de los dineros que reciba por cuenta de EL CONTRATANTE.

SEXTA. OBLIGACIONES DE EL CONTRATANTE. (a) Pagar los honorarios y gastos en la forma pactada; (b) entregar de manera oportuna y veraz la información, los documentos y las pruebas que EL ABOGADO requiera; (c) otorgar los poderes necesarios; (d) informar cualquier hecho nuevo relacionado con el asunto.

SÉPTIMA. NATURALEZA DE LA OBLIGACIÓN. La obligación de EL ABOGADO es de medio y no de resultado: se compromete a poner toda su diligencia y conocimiento, sin garantizar el sentido de las decisiones de las autoridades.

OCTAVA. DURACIÓN. Este contrato estará vigente {{duracion}}.

NOVENA. TERMINACIÓN. El contrato termina por el cumplimiento del encargo, por mutuo acuerdo, o por revocatoria del poder o renuncia. Si EL CONTRATANTE revoca el poder sin justa causa, o si el asunto termina por conciliación, transacción o desistimiento, deberá pagar los honorarios causados en proporción a la gestión adelantada.

DÉCIMA. CONFIDENCIALIDAD Y DATOS PERSONALES. Las partes mantendrán en reserva la información que conozcan por razón de este contrato. EL CONTRATANTE autoriza a EL ABOGADO a tratar sus datos personales para la ejecución del encargo, de acuerdo con la Ley 1581 de 2012.

UNDÉCIMA. MÉRITO EJECUTIVO. Este contrato presta mérito ejecutivo para el cobro de los honorarios y gastos pactados, sin necesidad de requerimiento previo.

DUODÉCIMA. FIRMA ELECTRÓNICA Y NOTIFICACIONES. Las partes aceptan que este contrato se firme electrónicamente y reconocen su plena validez y fuerza probatoria, de acuerdo con la Ley 527 de 1999 y el Decreto 2364 de 2012. Recibirán notificaciones en los correos {{cliente_email}} (EL CONTRATANTE) y {{abogado_email}} (EL ABOGADO).

En constancia, se firma en {{ciudad}}, a los {{fecha}}.`,
    firmas: [
      { rol: "EL CONTRATANTE", nombre: "cliente_nombre", doc: "cliente_doc" },
      { rol: "EL ABOGADO", nombre: "abogado_nombre", doc: "abogado_doc" },
    ],
  },
];

export const plantillaPorId = (id: string) => PLANTILLAS.find((p) => p.id === id) ?? null;

/** Campos obligatorios que faltan (etiquetas). */
export function camposFaltantes(p: Plantilla, valores: Record<string, string>): string[] {
  return p.campos.filter((c) => !c.opcional && !valores[c.clave]?.trim()).map((c) => c.etiqueta);
}

/** Reemplaza las {{variables}} (más las calculadas: fecha y líneas opcionales). */
export function rellenar(texto: string, valores: Record<string, string>): string {
  const v: Record<string, string> = { ...valores, fecha: fechaLargaCo() };
  v.radicado_linea = v.radicado?.trim() ? `\nRadicado: ${v.radicado.trim()}.` : "";
  v.cuota_litis_linea = v.cuota_litis?.trim()
    ? ` Adicionalmente, a título de cuota litis o prima de éxito, EL CONTRATANTE pagará ${v.cuota_litis.trim()}.`
    : "";
  // Las líneas calculadas conservan su salto de línea; un valor que ya termina en punto no lo duplica.
  const calculadas = new Set(["radicado_linea", "cuota_litis_linea"]);
  return texto
    .replace(/\{\{(\w+)\}\}/g, (_, k: string) => (calculadas.has(k) ? (v[k] ?? "") : (v[k] ?? "").trim()))
    .replace(/([^.])\.\.(?!\.)/g, "$1.");
}

/** Posición relativa (0-1) de cada bloque de firma, para proponerla en el editor. */
export type FirmaSugerida = { rol: string; nombre: string; doc: string; page: number; x: number; y: number; width: number; height: number };

/**
 * Dibuja la plantilla a un PDF tamaño carta: texto justificado a la izquierda,
 * numeración de páginas y, al final, un bloque de firma por cada firmante.
 */
export async function renderizarPlantilla(
  p: Plantilla,
  valores: Record<string, string>,
): Promise<{ pdf: Uint8Array; titulo: string; firmas: FirmaSugerida[]; paginas: number }> {
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.TimesRoman);
  const negrita = await doc.embedFont(StandardFonts.TimesRomanBold);
  const ANCHO = 612;
  const ALTO = 792;
  const MARGEN = 72;
  const TAM = 11.5;
  const SALTO = 16;
  const util = ANCHO - MARGEN * 2;
  const titulo = limpiar(rellenar(p.titulo, valores)).slice(0, 160);
  doc.setTitle(titulo);
  doc.setCreator("Estradox - Firma Electrónica");

  let pagina = doc.addPage([ANCHO, ALTO]);
  let y = ALTO - MARGEN;
  const nueva = () => {
    pagina = doc.addPage([ANCHO, ALTO]);
    y = ALTO - MARGEN;
  };

  for (const parrafo of rellenar(p.cuerpo, valores).split("\n")) {
    if (!parrafo.trim()) {
      y -= SALTO * 0.6;
      continue;
    }
    const esTitulo = parrafo.startsWith("## ");
    const font = esTitulo ? negrita : normal;
    const tam = esTitulo ? 12.5 : TAM;
    for (const linea of partir(esTitulo ? parrafo.slice(3) : parrafo, font, tam, util)) {
      if (y < MARGEN + SALTO) nueva();
      const x = esTitulo ? MARGEN + (util - font.widthOfTextAtSize(linea, tam)) / 2 : MARGEN;
      pagina.drawText(linea, { x, y, size: tam, font, color: rgb(0.07, 0.07, 0.1) });
      y -= SALTO;
    }
    y -= esTitulo ? SALTO * 0.5 : SALTO * 0.25;
  }

  // Bloques de firma: dos por fila; el recuadro de la firma va encima de la raya.
  const firmas: FirmaSugerida[] = [];
  const ALTO_FIRMA = 62;
  const ANCHO_FIRMA = 200;
  const ALTO_BLOQUE = ALTO_FIRMA + 54;
  for (let i = 0; i < p.firmas.length; i += 2) {
    if (y - ALTO_BLOQUE < 56) nueva();
    y -= 14;
    const fila = p.firmas.slice(i, i + 2);
    fila.forEach((f, j) => {
      const x = MARGEN + j * (util - ANCHO_FIRMA);
      const arriba = y;
      const raya = arriba - ALTO_FIRMA - 4;
      pagina.drawLine({ start: { x, y: raya }, end: { x: x + ANCHO_FIRMA, y: raya }, thickness: 0.8, color: rgb(0.1, 0.1, 0.15) });
      const nombre = limpiar((valores[f.nombre] ?? "").trim());
      const docNum = limpiar((valores[f.doc] ?? "").trim());
      pagina.drawText(partir(nombre, negrita, 10, ANCHO_FIRMA)[0] ?? "", { x, y: raya - 13, size: 10, font: negrita });
      pagina.drawText(`Documento No. ${docNum}`, { x, y: raya - 25, size: 9, font: normal });
      pagina.drawText(limpiar(f.rol), { x, y: raya - 37, size: 9, font: normal, color: rgb(0.35, 0.35, 0.4) });
      firmas.push({
        rol: f.rol,
        nombre,
        doc: docNum,
        page: doc.getPageCount(),
        x: x / ANCHO,
        y: (ALTO - arriba) / ALTO,
        width: ANCHO_FIRMA / ANCHO,
        height: ALTO_FIRMA / ALTO,
      });
    });
    y -= ALTO_BLOQUE;
  }

  // Numeración.
  const total = doc.getPageCount();
  doc.getPages().forEach((pg, i) => {
    const t = `Página ${i + 1} de ${total}`;
    pg.drawText(t, { x: (ANCHO - normal.widthOfTextAtSize(t, 8.5)) / 2, y: 40, size: 8.5, font: normal, color: rgb(0.45, 0.45, 0.5) });
  });

  return { pdf: await doc.save(), titulo, firmas, paginas: total };
}
