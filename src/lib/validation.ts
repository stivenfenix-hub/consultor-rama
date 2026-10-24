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

/** Radicados de 23 dígitos (sin repetir) separados por coma, espacio, punto y coma o salto. */
export function parseRadicados(input: string): string[] {
  return [
    ...new Set(
      input
        .split(/[\s,;]+/)
        .map((s) => s.replace(/\D/g, ""))
        .filter((s) => s.length === 23),
    ),
  ];
}
