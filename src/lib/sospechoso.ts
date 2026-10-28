/**
 * Detecta registros con datos de relleno (p. ej. nombre "ass", apellido
 * "asss", correo asasasass@gmail.com). Solo marca: el usuario ve un aviso y el
 * root decide si lo elimina; nunca se borra nada automáticamente.
 *
 * Señales fuertes (basta una): sin vocales, 3+ letras iguales seguidas, letras
 * seguidas del teclado (asdf, qwer). Débiles (hacen falta dos): palabra de una
 * letra, o de 3+ letras con solo 1-2 letras distintas ("ass"; ojo con "Ana" o
 * "Lee", por eso es débil). Nombre y apellido casi iguales también es fuerte.
 */

// Nombres y apellidos reales con solo 1-2 letras distintas.
const NOMBRES_CORTOS = new Set(["ana", "ada", "lee", "otto", "nana", "lili", "lulu", "dodo", "abab", "assa", "anna", "emme"]);

const FILAS_TECLADO =["qwertyuiop", "asdfghjklñ", "zxcvbnm", "abcdefghijklmnopqrstuvwxyz"];

function letras(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zñ]/g, "");
}

function deTeclado(t: string, largo: number) {
  for (let i = 0; i + largo <= t.length; i++) {
    const trozo = t.slice(i, i + largo);
    const reves = [...trozo].reverse().join("");
    if (FILAS_TECLADO.some((f) => f.includes(trozo) || f.includes(reves))) return true;
  }
  return false;
}

type Senal = { fuerte: boolean; motivo: string };

function revisarPalabra(p: string): Senal | null {
  const t = letras(p);
  if (!t) return null;
  if (t.length >= 2 && !/[aeiouy]/.test(t)) return { fuerte: true, motivo: `"${p}" no tiene vocales` };
  if (/(.)\1\1/.test(t)) return { fuerte: true, motivo: `"${p}" repite letras` };
  if (t.length >= 4 && deTeclado(t, 4)) return { fuerte: true, motivo: `"${p}" son letras seguidas del teclado` };
  if (t.length === 1) return { fuerte: false, motivo: `"${p}" tiene una sola letra` };
  if (t.length >= 3 && new Set(t).size <= 2 && !NOMBRES_CORTOS.has(t)) return { fuerte: false, motivo: `"${p}" usa solo ${new Set(t).size} letra(s) distinta(s)` };
  return null;
}

function revisarCorreo(email: string): string | null {
  const local = letras(email.split("@")[0] ?? "");
  if (local.length < 5) return null;
  if (new Set(local).size <= 3) return `el correo "${email}" usa muy pocas letras distintas`;
  if (/(.)\1\1\1/.test(local)) return `el correo "${email}" repite letras`;
  if (!/[aeiouy]/.test(local)) return `el correo "${email}" no tiene vocales`;
  if (deTeclado(local, 5)) return `el correo "${email}" son letras seguidas del teclado`;
  return null;
}

/** Devuelve los motivos por los que el registro parece falso (vacío si se ve bien). */
export function motivosSospecha(u: {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  email: string;
}): string[] {
  const motivos: string[] = [];
  const nombre = u.firstName || u.lastName ? [u.firstName ?? "", u.lastName ?? ""] : [u.name ?? ""];
  const palabras = nombre.join(" ").split(/\s+/).filter(Boolean);

  const senales = palabras.map(revisarPalabra).filter((s): s is Senal => !!s);
  const fuertes = senales.filter((s) => s.fuerte);
  if (fuertes.length > 0) motivos.push(...fuertes.map((s) => s.motivo));
  else if (senales.length >= 2) motivos.push(...senales.map((s) => s.motivo));

  // "ass" / "asss": nombre y apellido cortos y casi iguales.
  const [a, b] = [letras(u.firstName ?? ""), letras(u.lastName ?? "")];
  if (a && b && a.length <= 6 && b.length <= 6 && (a.startsWith(b) || b.startsWith(a))) {
    motivos.push("nombre y apellido casi iguales");
  }

  const correo = revisarCorreo(u.email);
  if (correo) motivos.push(correo);
  return motivos;
}
