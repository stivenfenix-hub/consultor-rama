// Días hábiles de Colombia (lunes a viernes, sin festivos), en hora de Bogotá.
// Los juzgados no publican actuaciones ni estados en días no hábiles, así que
// las revisiones nocturnas automáticas solo corren las noches que siguen a un
// día hábil (la noche del viernes sí: recoge lo publicado el viernes).

const DIA = 86_400_000;
const BOGOTA = -5 * 3_600_000; // sin horario de verano

/** Fecha UTC a medianoche (solo se usa año/mes/día). */
const fecha = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const clave = (d: Date) => d.toISOString().slice(0, 10);

/** Domingo de Pascua (algoritmo de Meeus/Jones/Butcher). */
function pascua(y: number) {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return fecha(y, mes, dia);
}

/** Ley Emiliani: si no cae lunes, el festivo pasa al lunes siguiente. */
function alLunes(d: Date) {
  const dow = d.getUTCDay(); // 0 domingo … 6 sábado
  return dow === 1 ? d : new Date(d.getTime() + (((8 - dow) % 7) || 7) * DIA);
}

const cache = new Map<number, Set<string>>();

/** Festivos nacionales de Colombia del año. */
export function festivos(y: number): Set<string> {
  const hit = cache.get(y);
  if (hit) return hit;
  const p = pascua(y);
  const masDias = (n: number) => new Date(p.getTime() + n * DIA);
  const lista = [
    // Fijos
    fecha(y, 1, 1), // Año Nuevo
    fecha(y, 5, 1), // Día del Trabajo
    fecha(y, 7, 20), // Independencia
    fecha(y, 8, 7), // Batalla de Boyacá
    fecha(y, 12, 8), // Inmaculada Concepción
    fecha(y, 12, 25), // Navidad
    // Semana Santa (no se trasladan)
    masDias(-3), // Jueves Santo
    masDias(-2), // Viernes Santo
    // Trasladables al lunes (Ley Emiliani)
    alLunes(fecha(y, 1, 6)), // Reyes Magos
    alLunes(fecha(y, 3, 19)), // San José
    alLunes(fecha(y, 6, 29)), // San Pedro y San Pablo
    alLunes(fecha(y, 8, 15)), // Asunción
    alLunes(fecha(y, 10, 12)), // Día de la Raza
    alLunes(fecha(y, 11, 1)), // Todos los Santos
    alLunes(fecha(y, 11, 11)), // Independencia de Cartagena
    masDias(43), // Ascensión (lunes)
    masDias(64), // Corpus Christi (lunes)
    masDias(71), // Sagrado Corazón (lunes)
  ];
  const s = new Set(lista.map(clave));
  cache.set(y, s);
  return s;
}

/** ¿El día (año/mes/día en Bogotá) es hábil? */
export function esDiaHabil(d: Date): boolean {
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !festivos(d.getUTCFullYear()).has(clave(d));
}

/** Día (en Bogotá) en que empezó la noche en curso: antes del mediodía, la noche empezó ayer. */
function diaDeLaNoche(ahora = new Date()) {
  const b = new Date(ahora.getTime() + BOGOTA);
  const hoy = fecha(b.getUTCFullYear(), b.getUTCMonth() + 1, b.getUTCDate());
  return b.getUTCHours() < 12 ? new Date(hoy.getTime() - DIA) : hoy;
}

/**
 * ¿Toca la revisión nocturna automática? Solo las noches que siguen a un día
 * hábil: lunes a viernes por la noche, menos las noches de festivo.
 */
export function nocheHabil(ahora = new Date()): boolean {
  return esDiaHabil(diaDeLaNoche(ahora));
}
