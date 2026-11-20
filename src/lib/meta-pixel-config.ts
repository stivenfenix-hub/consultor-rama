// Compartido entre servidor (crea la cookie) y cliente (dispara el evento).
export const META_PIXEL_ID = "1676523124263823";
/** Cookie corta que marca "cuenta recién creada" para CompleteRegistration. */
export const COOKIE_REGISTRO = "estradox_nuevo_registro";

/** Nombre del producto comprado (el mismo en el píxel y en el servidor). */
export function nombreCompra(tipo: string) {
  return tipo === "firma" ? "Firma electrónica" : tipo === "adicionales" ? "Procesos adicionales" : "Plan Estradox";
}
