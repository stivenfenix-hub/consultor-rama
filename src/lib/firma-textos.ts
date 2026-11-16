/** Texto que el firmante acepta antes de firmar (queda en la bitácora tal cual). */
export const ACEPTACION =
  "Acepto firmar este documento electrónicamente. Entiendo que mi firma electrónica tiene la misma validez y efectos jurídicos que mi firma manuscrita, de acuerdo con la Ley 527 de 1999 y el Decreto 2364 de 2012.";

/** Distancia de edición entre dos cadenas (cuántos caracteres hay que cambiar). */
function distancia(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/**
 * ¿El número leído de la cédula corresponde al del firmante? Tolera errores
 * de lectura: hasta 2 dígitos distintos en cédulas de 8 o más dígitos y 1 en
 * las más cortas. Lo usan el portal (al leer) y el servidor (al guardar).
 */
export function numeroParecido(leido: string | null | undefined, esperado: string): boolean {
  const e = esperado.replace(/\D/g, "");
  const l = (leido ?? "").replace(/\D/g, "");
  if (e.length < 5 || l.length < 5) return false;
  if (l.includes(e)) return true;
  const tolerancia = e.length >= 8 ? 2 : 1;
  // Se compara contra cada tramo del número leído del mismo largo (± 1).
  for (let largo = e.length - 1; largo <= e.length + 1; largo++) {
    for (let i = 0; i + largo <= l.length; i++) {
      if (distancia(l.slice(i, i + largo), e) <= tolerancia) return true;
    }
  }
  return false;
}
