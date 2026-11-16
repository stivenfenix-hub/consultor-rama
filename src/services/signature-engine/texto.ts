import type { PDFFont } from "pdf-lib";

/**
 * Las fuentes estándar de PDF (Helvetica, Times) solo dibujan WinAnsi: sirven
 * las tildes y la ñ, pero un emoji o una comilla rara rompe el PDF. Aquí se
 * cambian los signos comunes y se quita lo que no se puede dibujar.
 */
export function limpiar(s: string): string {
  return s
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[  -​ ]/g, " ")
    .replace(/\t/g, "    ")
    .replace(/[^\x20-\x7E¡-ÿ\n]/g, "");
}

/** Parte un párrafo en renglones que quepan en `ancho` puntos. */
export function partir(texto: string, font: PDFFont, size: number, ancho: number): string[] {
  const lineas: string[] = [];
  for (const parrafo of limpiar(texto).split("\n")) {
    let linea = "";
    for (const palabra of parrafo.split(/ +/)) {
      const prueba = linea ? `${linea} ${palabra}` : palabra;
      if (font.widthOfTextAtSize(prueba, size) <= ancho || !linea) {
        linea = prueba;
      } else {
        lineas.push(linea);
        linea = palabra;
      }
      // Una sola "palabra" más ancha que el renglón (un hash, una URL): se corta.
      while (font.widthOfTextAtSize(linea, size) > ancho && linea.length > 1) {
        let n = linea.length - 1;
        while (n > 1 && font.widthOfTextAtSize(linea.slice(0, n), size) > ancho) n--;
        lineas.push(linea.slice(0, n));
        linea = linea.slice(n);
      }
    }
    lineas.push(linea);
  }
  return lineas;
}

const TZ = "America/Bogota";
/** 16/11/2026, 3:14:09 p. m. (hora de Colombia). */
export function fechaHoraCo(d: Date | string | null | undefined): string {
  if (!d) return "-";
  return limpiar(
    new Date(d).toLocaleString("es-CO", {
      timeZone: TZ,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }),
  );
}

/** "16 de noviembre de 2026" (hora de Colombia). */
export function fechaLargaCo(d: Date = new Date()): string {
  return new Date(d).toLocaleDateString("es-CO", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" });
}
