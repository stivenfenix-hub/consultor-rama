import { z } from "zod";
import { normalizarWhatsapp } from "./accounts";

// Validaciones compartidas por los formularios web y el API de la app móvil.

export const passwordSchema = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres")
  .regex(/[A-Za-z]/, "Debe incluir al menos una letra")
  .regex(/[0-9]/, "Debe incluir al menos un número");

export const registerSchema = z.object({
  firstName: z.string().min(1, "Ingresa tu nombre"),
  lastName: z.string().min(1, "Ingresa tu apellido"),
  email: z.string().email("Correo inválido"),
  whatsapp: z
    .string()
    .transform((v, ctx) => {
      const n = normalizarWhatsapp(v);
      if (!n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Ingresa un número de WhatsApp válido (ej. 300 123 4567).",
        });
        return z.NEVER;
      }
      return n;
    }),
  password: passwordSchema,
});

/** Cada radicado tarda varios segundos en la Rama: más que esto se vuelve una espera eterna. */
export const MAX_RADICADOS_POR_ENVIO = 5;

/** Radicados de 23 dígitos (sin repetir) separados por coma, espacio, punto y coma o salto. */
export function parseRadicados(input: string): string[] {
  return analizarRadicados(input).validos;
}

/**
 * Como parseRadicados, pero también acepta un radicado escrito por partes
 * ("76001 41 89 002 2019 00628 00", con guiones o puntos) y devuelve lo que no
 * se pudo leer para avisarle al usuario.
 */
export function analizarRadicados(input: string): { validos: string[]; invalidos: string[] } {
  const validos: string[] = [];
  const invalidos: string[] = [];
  for (const trozo of input.split(/[\n,;]+/)) {
    const texto = trozo.trim();
    if (!texto) continue;
    const tokens = texto.split(/\s+/).map((t) => t.replace(/\D/g, "")).filter(Boolean);
    if (tokens.length === 0) {
      invalidos.push(texto);
      continue;
    }
    if (tokens.every((t) => t.length === 23)) {
      validos.push(...tokens);
      continue;
    }
    // Escrito por partes: se juntan los dígitos de la línea.
    const digitos = tokens.join("");
    if (digitos.length % 23 === 0) {
      for (let i = 0; i < digitos.length; i += 23) validos.push(digitos.slice(i, i + 23));
      continue;
    }
    for (const t of tokens) {
      if (t.length === 23) validos.push(t);
      else invalidos.push(t);
    }
  }
  return { validos: [...new Set(validos)], invalidos: [...new Set(invalidos)] };
}
