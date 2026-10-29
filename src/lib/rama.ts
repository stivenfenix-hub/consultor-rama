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

/**
 * Proxy opcional (apagado por defecto). Si algún día la Rama bloquea la IP del
 * servidor, se activa solo con variables de entorno:
 *   USE_PROXY=true
 *   PROXY_URL=http://usuario:clave@proxy:puerto      (proxy HTTP normal), o
 *   PROXY_URL=https://api.scraperapi.com/?api_key=XXX&url={url}  (servicio que
 *             recibe la URL destino: {url} se reemplaza por la URL de la Rama)
 */
const USE_PROXY = process.env.USE_PROXY === "true" && !!process.env.PROXY_URL;
type Fetcher = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;
let proxyFetcher: Promise<Fetcher> | null = null;
function getFetcher(): Promise<Fetcher> {
  if (!USE_PROXY) {
    return Promise.resolve((url, init) => fetch(url, { ...init, cache: "no-store" }));
  }
  proxyFetcher ??= (async () => {
    const proxyUrl = process.env.PROXY_URL!;
    if (proxyUrl.includes("{url}")) {
      return (url, init) =>
        fetch(proxyUrl.replace("{url}", encodeURIComponent(url)), { ...init, cache: "no-store" });
    }
    const { fetch: undiciFetch, ProxyAgent } = await import("undici");
    const dispatcher = new ProxyAgent(proxyUrl);
    return (url, init) =>
      undiciFetch(url, { ...init, dispatcher }) as unknown as Promise<Response>;
  })();
  return proxyFetcher;
}

/**
 * Límite general de consultas a la Rama para TODA la plataforma (refresco
 * manual, "Actualizar todos", cola nocturna y procesos nuevos): como máximo
 * RAMA_MAX_CONCURRENT consultas a la vez y RAMA_MIN_GAP_MS entre el inicio de
 * una y otra. Si muchos abogados actualizan a la vez, esperan su turno en
 * lugar de disparar ráfagas que harían que la Rama bloquee la IP.
 */
const MAX_SIMULTANEAS = Math.max(1, Number(process.env.RAMA_MAX_CONCURRENT ?? 4) || 4);
const ESPACIO_MS = Math.max(0, Number(process.env.RAMA_MIN_GAP_MS ?? 250) || 0);
const FRENO_MS = 5 * 60_000;
let frenoHasta = 0; // tras un 429/403, nadie consulta la Rama por 5 minutos
let enCurso = 0;
let ultimoInicio = 0;
const enEspera: (() => void)[] = [];

async function turno() {
  if (enCurso >= MAX_SIMULTANEAS) {
    await new Promise<void>((resolve) => enEspera.push(resolve));
  } else {
    enCurso++;
  }
  // Espacio mínimo entre consultas (se reserva el horario antes de esperar).
  const ahora = Date.now();
  const inicio = Math.max(ahora, ultimoInicio + ESPACIO_MS);
  ultimoInicio = inicio;
  if (inicio > ahora) await sleep(inicio - ahora);
}
function liberar() {
  const siguiente = enEspera.shift();
  if (siguiente) siguiente(); // el cupo pasa directo al siguiente en la fila
  else enCurso--;
}

/** Cuántas consultas hay en curso y en espera (monitoreo). */
export function cargaRama() {
  return {
    enCurso,
    enEspera: enEspera.length,
    maximo: MAX_SIMULTANEAS,
    frenoHasta: frenoHasta > Date.now() ? new Date(frenoHasta) : null,
  };
}

/**
 * GET con timeout + reintentos con backoff exponencial.
 * 429 (o 403 del firewall, que no responde JSON) es bloqueo por exceso de
 * consultas: no se reintenta y se marca isRateLimit para frenar la cola.
 */
async function ramaGet<T>(
  path: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRetries = MAX_RETRIES,
): Promise<T> {
  const doFetch = await getFetcher();
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (Date.now() < frenoHasta) {
      throw new RamaError("La Rama Judicial pidió pausar las consultas.", 429, true);
    }
    await turno();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let text: string;
    let res: Response;
    try {
      res = await doFetch(BASE + path, {
        signal: ctrl.signal,
        headers: { Accept: "application/json" },
      });
      text = await res.text();
    } catch (err) {
      clearTimeout(timer);
      liberar();
      lastErr = err;
      if (attempt === maxRetries) break;
      await sleep(1500 * attempt);
      continue;
    }
    clearTimeout(timer);
    liberar();
    try {
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
        const rateLimit = res.status === 429 || (res.status === 403 && body === null);
        // 400 (criterios), 404 (no encontrado) y bloqueos no se reintentan.
        const noReintentar = res.status === 400 || res.status === 404 || rateLimit;
        if (rateLimit) frenoHasta = Date.now() + FRENO_MS;
        if (noReintentar || attempt === maxRetries) {
          throw new RamaError(msg, res.status, rateLimit);
        }
        lastErr = new RamaError(msg, res.status);
      } else {
        return body as T;
      }
    } catch (err) {
      clearTimeout(timer);
      if (
        err instanceof RamaError &&
        (err.status === 400 || err.status === 404 || err.isRateLimit)
      ) {
        throw err;
      }
      lastErr = err;
      if (attempt === maxRetries) break;
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
  // La búsqueda es la consulta más lenta de la Rama (15-20 s cuando está
  // cargada): más margen que el resto. Ya no hace esperar al abogado (va en
  // segundo plano), y si igual falla, se reintenta solo.
  const data = await ramaGet<{ procesos?: ProcesoResumen[] }>(
    `/Procesos/Consulta/NumeroRadicacion?numero=${numero}&SoloActivos=${soloActivos}&pagina=1`,
    40_000,
    2,
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
export async function obtenerDetalle(
  idProceso: string | number,
  maxRetries = MAX_RETRIES,
): Promise<ProcesoDetalle> {
  return ramaGet<ProcesoDetalle>(`/Proceso/Detalle/${idProceso}`, DEFAULT_TIMEOUT_MS, maxRetries);
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

/**
 * Fecha de la Rama ("2026-10-28T00:00:00", sin zona horaria) en hora de
 * Colombia. Antes se leía con la zona del servidor (UTC) y, mostrada en hora
 * de Bogotá, caía un día antes: el 28 de octubre salía como 27.
 */
export function fechaRama(f?: string | null): Date | null {
  if (!f) return null;
  const conZona = /(Z|[+-]\d\d:?\d\d)$/.test(f) ? f : `${f}-05:00`;
  const d = new Date(conZona);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * La actuación con la fecha más reciente. No sirve tomar la primera: algunos
 * sistemas (p. ej. SIUGJ) no entregan las actuaciones ordenadas por fecha.
 */
export function laMasReciente(lista: Actuacion[], actual: Actuacion | null = null): Actuacion | null {
  const t = (a: Actuacion | null) => (fechaRama(a?.fechaActuacion)?.getTime() ?? 0);
  let mejor = actual;
  for (const a of lista) if (!mejor || t(a) > t(mejor)) mejor = a;
  return mejor;
}

/**
 * Revisión liviana para la cola nocturna: pide la página 1 de actuaciones y
 * solo sigue con las siguientes si encuentra actuaciones desconocidas o si el
 * total de la Rama no cuadra con lo que ya se conoce. Sin novedades = 1 consulta.
 */
export async function obtenerActuacionesNuevas(
  idProceso: string | number,
  conocidas: Set<string>,
): Promise<{ nuevas: Actuacion[]; masReciente: Actuacion | null; consultas: number }> {
  const nuevas: Actuacion[] = [];
  let masReciente: Actuacion | null = null;
  let vistas = 0;
  let total = Infinity;
  let pagina = 1;

  while (pagina <= 100) {
    // 1 solo intento: si falla, la cola lo reprograma.
    const data = await ramaGet<{
      actuaciones?: Actuacion[];
      paginacion?: Paginacion;
    }>(`/Proceso/Actuaciones/${idProceso}?pagina=${pagina}`, DEFAULT_TIMEOUT_MS, 1);

    const lote = data.actuaciones ?? [];
    if (data.paginacion?.cantidadRegistros != null) {
      total = data.paginacion.cantidadRegistros;
    }
    if (lote.length === 0) break;
    masReciente = laMasReciente(lote, masReciente);
    vistas += lote.length;
    const desconocidas = lote.filter((a) => !conocidas.has(String(a.idRegActuacion)));
    nuevas.push(...desconocidas);

    if (vistas >= total) break;
    // Página toda conocida y las cuentas cuadran: no hay más novedades.
    if (desconocidas.length === 0 && (total === Infinity || conocidas.size + nuevas.length >= total)) break;
    pagina++;
  }
  return { nuevas, masReciente, consultas: pagina };
}
