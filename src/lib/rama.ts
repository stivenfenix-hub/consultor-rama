/**
 * Cliente del API publico de la Rama Judicial (Consulta de Procesos Nacional
 * Unificada - CPNU).
 *
 * Rutas (GET, base https://consultaprocesos.ramajudicial.gov.co:448/api/v2):
 *   - /Procesos/Consulta/NumeroRadicacion?numero={23}&SoloActivos=false&pagina=1
 *   - /Procesos/Consulta/NombreRazonSocial?nombre={t}&tipoPersona={nat|jur}&SoloActivos=false&pagina=1
 *   - /Proceso/Detalle/{idProceso}
 *   - /Proceso/Actuaciones/{idProceso}?pagina={n}
 *
 * Notas del comportamiento real observado:
 *   - El servidor es LENTO (respuestas de 8-11 s son normales).
 *   - La busqueda por nombre falla con 400 si hay > 1000 resultados.
 *   - NO existe consulta por cedula/documento.
 *
 * IMPORTANTE: llamar esto SOLO desde el servidor. Desde el navegador falla por
 * CORS y por el puerto :448.
 */

const BASE =
  process.env.RAMA_API_BASE ??
  "https://consultaprocesos.ramajudicial.gov.co:448/api/v2";

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;

export type TipoPersona = "nat" | "jur";

export interface ProcesoResumen {
  idProceso: number;
  idConexion?: number;
  llaveProceso: string;
  fechaProceso?: string;
  fechaUltimaActuacion?: string;
  despacho?: string;
  departamento?: string;
  sujetosProcesales?: string;
  esPrivado?: boolean;
  cantFilas?: number;
}

export interface ProcesoDetalle {
  idRegProceso?: number;
  llaveProceso: string;
  idConexion?: number;
  esPrivado?: boolean;
  fechaProceso?: string;
  codDespachoCompleto?: string;
  despacho?: string;
  ponente?: string;
  tipoProceso?: string;
  claseProceso?: string;
  subclaseProceso?: string;
  recurso?: string;
  ubicacion?: string;
  contenidoRadicacion?: string;
  fechaConsulta?: string;
  ultimaActualizacion?: string;
}

export interface Actuacion {
  idRegActuacion: number;
  llaveProceso?: string;
  consActuacion?: number;
  actuacion?: string;
  anotacion?: string;
  fechaActuacion?: string;
  fechaRegistro?: string;
  fechaInicial?: string | null;
  fechaFinal?: string | null;
  conDocumentos?: boolean;
  cant?: number;
}

interface Paginacion {
  cantidadRegistros?: number;
  registrosPagina?: number;
  cantidadPaginas?: number;
  pagina?: number;
}

export class RamaError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly isRateLimit = false,
  ) {
    super(message);
    this.name = "RamaError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET con timeout + reintentos con backoff exponencial. */
async function ramaGet<T>(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(BASE + path, {
        signal: ctrl.signal,
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      clearTimeout(timer);

      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        // respuesta no-JSON
      }

      if (!res.ok) {
        const msg =
          (body as { Message?: string } | null)?.Message ??
          `HTTP ${res.status}`;
        // 400 (criterios) y 404 (no encontrado) no se reintentan.
        const businessError = res.status === 400 || res.status === 404;
        if (businessError || attempt === MAX_RETRIES) {
          throw new RamaError(msg, res.status, res.status === 429);
        }
        lastErr = new RamaError(msg, res.status);
      } else {
        return body as T;
      }
    } catch (err) {
      clearTimeout(timer);
      // Errores de negocio (400/404): no reintentar.
      if (
        err instanceof RamaError &&
        (err.status === 400 || err.status === 404)
      ) {
        throw err;
      }
      lastErr = err;
    }
    // backoff: 1.5s, 3s, ...
    await sleep(1500 * attempt);
  }
  throw lastErr instanceof Error
    ? lastErr
    : new RamaError("Fallo al consultar la Rama Judicial");
}

/** Busca procesos por numero de radicacion (23 digitos). */
export async function buscarPorRadicado(
  radicado: string,
  soloActivos = false,
): Promise<ProcesoResumen[]> {
  const numero = radicado.replace(/\D/g, "");
  if (numero.length !== 23) {
    throw new RamaError("El radicado debe tener 23 digitos.", 400);
  }
  const data = await ramaGet<{ procesos?: ProcesoResumen[] }>(
    `/Procesos/Consulta/NumeroRadicacion?numero=${numero}&SoloActivos=${soloActivos}&pagina=1`,
  );
  return data.procesos ?? [];
}

/** Busca procesos por nombre o razon social. Puede fallar si hay > 1000. */
export async function buscarPorNombre(
  nombre: string,
  tipoPersona: TipoPersona,
  soloActivos = false,
): Promise<ProcesoResumen[]> {
  const q = encodeURIComponent(nombre.trim());
  const data = await ramaGet<{ procesos?: ProcesoResumen[] }>(
    `/Procesos/Consulta/NombreRazonSocial?nombre=${q}&tipoPersona=${tipoPersona}&SoloActivos=${soloActivos}&pagina=1`,
  );
  return data.procesos ?? [];
}

/** Trae el detalle de un proceso por su idProceso. */
export async function obtenerDetalle(idProceso: string | number): Promise<ProcesoDetalle> {
  return ramaGet<ProcesoDetalle>(`/Proceso/Detalle/${idProceso}`);
}

export interface Documento {
  idRegDocumento: number;
  nombre?: string;
  descripcion?: string;
  tipo?: string;
  fechaCarga?: string;
  consActuacion?: number | null;
}

export interface Sujeto {
  idRegSujeto: number;
  nombreRazonSocial?: string;
  tipoSujeto?: string;
  identificacion?: string | null;
}

/** Documentos del proceso. Devuelve [] si el proceso no tiene (404). */
export async function obtenerDocumentos(
  idProceso: string | number,
): Promise<Documento[]> {
  try {
    const data = await ramaGet<Documento[]>(`/Proceso/Documentos/${idProceso}`);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err instanceof RamaError && err.status === 404) return [];
    throw err;
  }
}

/** Documentos de una actuación concreta (suelen ser los descargables). */
export async function obtenerDocumentosActuacion(
  idRegActuacion: string | number,
): Promise<Documento[]> {
  try {
    const data = await ramaGet<Documento[]>(
      `/Proceso/DocumentosActuacion/${idRegActuacion}`,
    );
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err instanceof RamaError && err.status === 404) return [];
    throw err;
  }
}

/** Sujetos procesales (partes) estructurados. */
export async function obtenerSujetos(
  idProceso: string | number,
): Promise<Sujeto[]> {
  try {
    const data = await ramaGet<{ sujetos?: Sujeto[] }>(
      `/Proceso/Sujetos/${idProceso}?pagina=1`,
    );
    return data.sujetos ?? [];
  } catch (err) {
    if (err instanceof RamaError && err.status === 404) return [];
    throw err;
  }
}

/**
 * Trae TODAS las actuaciones de un proceso, recorriendo la paginacion.
 * La Rama devuelve las mas recientes primero.
 */
export async function obtenerActuaciones(
  idProceso: string | number,
): Promise<Actuacion[]> {
  const todas: Actuacion[] = [];
  let pagina = 1;
  let total = Infinity;

  // Tope de seguridad por si la paginacion no reporta bien el total.
  while (todas.length < total && pagina <= 100) {
    const data = await ramaGet<{
      actuaciones?: Actuacion[];
      paginacion?: Paginacion;
    }>(`/Proceso/Actuaciones/${idProceso}?pagina=${pagina}`);

    const lote = data.actuaciones ?? [];
    if (data.paginacion?.cantidadRegistros != null) {
      total = data.paginacion.cantidadRegistros;
    }
    if (lote.length === 0) break;
    todas.push(...lote);
    pagina++;
  }
  return todas;
}
